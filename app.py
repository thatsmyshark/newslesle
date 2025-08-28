# app.py
import os
import re
import random
import requests
from datetime import datetime, date, timedelta

from flask import Flask, render_template, jsonify, request, abort
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

# ---------- Basic Flask + DB setup ----------
app = Flask(__name__)

# Use DATABASE_URL if present (Railway provides this). Replace legacy 'postgres://' prefix if needed.
db_url = os.environ.get("DATABASE_URL")
if db_url and db_url.startswith("postgres://"):
    # SQLAlchemy prefers 'postgresql://' scheme for psycopg2
    db_url = db_url.replace("postgres://", "postgresql://", 1)

# Fallback to a local sqlite DB for dev if DATABASE_URL not set
app.config["SQLALCHEMY_DATABASE_URI"] = db_url or "sqlite:///newslesle_dev.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)
migrate = Migrate(app, db)   # exposes `flask db` commands

# ---------- Existing News endpoint (unchanged, but left here) ----------
NEWS_API_KEY = os.environ.get("NEWS_API_KEY", "d29cdda90f014b88bde1bbe8bf1a8e51")
cached_article = None

@app.route('/headline')
def get_headline():
    global cached_article
    url = f"https://newsapi.org/v2/top-headlines?language=en&pageSize=30&apiKey={NEWS_API_KEY}"
    response = requests.get(url)
    data = response.json()

    if "articles" not in data or not data["articles"]:
        headline = "NO HEADLINE AVAILABLE"
        description = ""
        article_url = "#"
        image_url = ""
        source_name = "Unknown Source"
        published_at = ""
    else:
        valid_articles = [a for a in data["articles"] if a.get("title") and a.get("url")]
        article = random.choice(valid_articles)

        headline = article["title"].upper()
        # strip trailing dashes/parentheses
        headline = re.sub(r'(\s*[-:]\s*[\w\s]+|\s*\(.*\))$', '', headline)

        description = article.get("description", "").strip() or "No summary available."
        article_url = article["url"]
        image_url = article.get("urlToImage", "")
        source_name = article.get("source", {}).get("name", "Unknown Source")
        published_at = article.get("publishedAt", "")

    cached_article = {
        'headline': headline,
        'description': description,
        'url': article_url,
        'urlToImage': image_url,
        'sourceName': source_name,
        'publishedAt': published_at
    }

    return jsonify(cached_article)


# ---------- DB models ----------
class Player(db.Model):
    # We will store a generated UUID string from the client as player id
    id = db.Column(db.String(64), primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class History(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    player_id = db.Column(db.String(64), db.ForeignKey('player.id'), nullable=False, index=True)
    headline = db.Column(db.Text, nullable=False)
    article_url = db.Column(db.Text, nullable=True)
    score = db.Column(db.Float, nullable=False)
    time_taken = db.Column(db.Float, nullable=False)
    date = db.Column(db.String(10), nullable=False)   # YYYY-MM-DD (for calendar grouping)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "playerId": self.player_id,
            "headline": self.headline,
            "articleURL": self.article_url,
            "score": self.score,
            "timeTaken": self.time_taken,
            "date": self.date,
            "createdAt": self.created_at.isoformat()
        }

# ---------- API: save history ----------
@app.route('/save', methods=['POST'])
def save_history():
    """
    Expects JSON:
    {
      "playerId": "uuid-string",
      "headline": "THE HEADLINE",
      "score": 123.4,
      "timeTaken": 12.3,
      "date": "YYYY-MM-DD",
      "articleURL": "https://..."
    }
    """
    payload = request.get_json(force=True)
    if not payload:
        return jsonify({"error": "no json body"}), 400

    player_id = payload.get("playerId")
    if not player_id:
        return jsonify({"error": "playerId required"}), 400

    # small validations / length limits to avoid unbounded input
    headline = (payload.get("headline") or "")[:2000]
    try:
        score = float(payload.get("score", 0))
    except (ValueError, TypeError):
        score = 0.0
    try:
        time_taken = float(payload.get("timeTaken", 0))
    except (ValueError, TypeError):
        time_taken = 0.0
    date_str = payload.get("date") or datetime.utcnow().date().isoformat()
    article_url = payload.get("articleURL")

    # ensure player exists
    player = Player.query.get(player_id)
    if not player:
        player = Player(id=player_id)
        db.session.add(player)
        db.session.flush()  # ensure player available for FK use

    entry = History(
        player_id=player_id,
        headline=headline,
        article_url=article_url,
        score=score,
        time_taken=time_taken,
        date=date_str
    )
    db.session.add(entry)
    db.session.commit()

    return jsonify({"status": "ok", "id": entry.id})


# ---------- API: fetch all history for a player ----------
@app.route('/history/<player_id>', methods=['GET'])
def get_history(player_id):
    entries = History.query.filter_by(player_id=player_id).order_by(History.created_at.desc()).all()
    return jsonify([e.to_dict() for e in entries])


# ---------- API: completed headlines (for exclusion when fetching new headline) ----------
@app.route('/completed/<player_id>', methods=['GET'])
def get_completed(player_id):
    # Return a set/list of article URLs (prefer URL if available, otherwise headline text)
    entries = History.query.filter_by(player_id=player_id).all()
    completed = []
    for e in entries:
        completed.append(e.article_url if e.article_url else e.headline)
    return jsonify({"completed": completed})


# ---------- API: compute streak server-side (optional) ----------
@app.route('/streak/<player_id>', methods=['GET'])
def get_streak(player_id):
    rows = History.query.with_entities(History.date).filter_by(player_id=player_id).distinct().all()
    played_dates = set(r[0] for r in rows)  # strings like '2025-08-28'
    # compute streak starting from today
    current = date.today()
    streak = 0
    while True:
        ds = current.isoformat()
        if ds in played_dates:
            streak += 1
            current = current - timedelta(days=1)
        else:
            break
    return jsonify({"streak": streak})


# ---------- Serve UI ----------
@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    app.run(debug=True)
