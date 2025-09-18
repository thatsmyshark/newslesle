# app.py

import os, re, random, requests, uuid
from datetime import datetime, date, timedelta
from flask import Flask, render_template, jsonify, request, make_response
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func, UniqueConstraint
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, template_folder="templates", static_folder="static")

# ---- Database config (Postgres on Railway, SQLite locally) ----
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///app.db")
# Some providers use "postgres://", SQLAlchemy wants "postgresql://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

# ---- Config ----
NEWS_API_KEY = os.getenv("NEWS_API_KEY", "")
MAX_DAILY = int(os.getenv("MAX_DAILY_HEADLINES", "6"))

# ---- Models ----
class User(db.Model):
    id = db.Column(db.String(36), primary_key=True)  # uuid4
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

class Play(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(36), db.ForeignKey("user.id"), nullable=False, index=True)
    headline = db.Column(db.Text, nullable=False)
    score = db.Column(db.Float, nullable=True)
    time_taken = db.Column(db.Float, nullable=True)
    # we store the local date (as sent by server) for easy streak calc
    date_played = db.Column(db.Date, nullable=False, index=True, default=date.today)
    source_name = db.Column(db.String(255))
    url = db.Column(db.Text)
    published_at = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        # one user shouldn’t store the same headline twice
        UniqueConstraint("user_id", "headline", name="uq_user_headline"),
    )

with app.app_context():
    db.create_all()

# ---- Helpers ----
def get_or_create_user_id():
    uid = request.cookies.get("uid")
    is_new = False
    if not uid:
        uid = str(uuid.uuid4())
        user = User(id=uid)
        db.session.add(user)
        db.session.commit()
        is_new = True
    else:
        if not User.query.get(uid):
            db.session.add(User(id=uid))
            db.session.commit()
            is_new = True
    return uid, is_new

def plays_today(uid: str) -> int:
    return db.session.query(func.count(Play.id)).filter(
        Play.user_id == uid,
        Play.date_played == date.today()
    ).scalar()

def compute_streak(uid: str) -> int:
    # get distinct play dates in descending order
    dates = db.session.query(Play.date_played)\
        .filter(Play.user_id == uid)\
        .distinct()\
        .order_by(Play.date_played.desc())\
        .all()
    dates = [d[0] for d in dates]

    streak = 0
    current = date.today()
    s = set(dates)
    while current in s:
        streak += 1
        current = current - timedelta(days=1)
    return streak

def first_play_date(uid: str):
    fp = db.session.query(func.min(Play.date_played)).filter(Play.user_id == uid).scalar()
    return fp.isoformat() if fp else None

def title_cleanup(headline: str) -> str:
    # your existing cleanup (strip trailing dashes/parentheses)
    return re.sub(r'(\s*[-:]\s*[\w\s]+|\s*\(.*\))$', '', headline)

# ---- Routes ----
@app.route("/")
def index():
    # Ensure the user has a uid cookie
    uid, is_new = get_or_create_user_id()
    resp = make_response(render_template("index.html"))
    # Secure cookie flags are good practice; set Secure only when HTTPS
    if is_new:
        resp.set_cookie("uid", uid, httponly=True, samesite="Lax", secure=False, max_age=60*60*24*365)  # 1 year
    return resp

@app.route("/status")
def status():
    uid, is_new = get_or_create_user_id()
    count = plays_today(uid)
    return jsonify({
        "canPlay": count < MAX_DAILY,
        "playsToday": count,
        "maxDaily": MAX_DAILY,
        "streak": compute_streak(uid),
        "firstPlayDate": first_play_date(uid)
    })

@app.route("/headline")
def get_headline():
    """
    Returns a headline the user hasn't completed yet.
    If the user hit the daily cap, return 429 unless ?preview=1 is set.
    """
    uid, is_new = get_or_create_user_id()
    count = plays_today(uid)
    preview = request.args.get("preview") == "1"

    if (count >= MAX_DAILY) and not preview:
        return jsonify({"error": "Daily limit reached", "playsToday": count, "maxDaily": MAX_DAILY}), 429

    # Fetch top headlines
    url = f"https://newsapi.org/v2/top-headlines?language=en&pageSize=30&apiKey={NEWS_API_KEY}"
    r = requests.get(url, timeout=10)
    data = r.json()

    if "articles" not in data or not data["articles"]:
        return jsonify({
            'headline': "NO HEADLINE AVAILABLE",
            'description': "",
            'url': "#",
            'urlToImage': "",
            'sourceName': "Unknown Source",
            'publishedAt': ""
        })

    # exclude already played + too long headlines
    MAX_HEADLINE_LENGTH = 75
    played_titles = {p.headline for p in Play.query.with_entities(Play.headline).filter(Play.user_id == uid)}
    candidates = []
    for a in data["articles"]:
        title = a.get("title")
        url_a = a.get("url")
        if not title or not url_a:
            continue
        cleaned = title_cleanup(title.upper())
        if cleaned not in played_titles and len(cleaned) <= MAX_HEADLINE_LENGTH:
            candidates.append((cleaned, a))

    if not candidates:
        if preview:
            # fallback: pick a random short headline for preview
            fallback_articles = [
                a for a in data["articles"]
                if a.get("title") and a.get("url") and len(title_cleanup(a["title"].upper())) <= MAX_HEADLINE_LENGTH
            ]
            if fallback_articles:
                a = random.choice(fallback_articles)
                cleaned = title_cleanup(a["title"].upper())
                return jsonify({
                    'headline': cleaned,
                    'description': (a.get("description") or "").strip() or "No summary available.",
                    'url': a["url"],
                    'urlToImage': a.get("urlToImage", ""),
                    'sourceName': a.get("source", {}).get("name", "Unknown Source"),
                    'publishedAt': a.get("publishedAt", "")
                })
        return jsonify({"error": "No new headlines available"}), 204

    cleaned, a = random.choice(candidates)
    desc = (a.get("description") or "").strip() or "No summary available."

    return jsonify({
        'headline': cleaned,
        'description': desc,
        'url': a["url"],
        'urlToImage': a.get("urlToImage", ""),
        'sourceName': a.get("source", {}).get("name", "Unknown Source"),
        'publishedAt': a.get("publishedAt", "")
    })

@app.route("/play", methods=["POST"])
def save_play():
    """
    Save a completed play (history item). Also used to derive streak and completed headlines.
    Body: {headline, score, timeTaken, url, sourceName, publishedAt}
    """
    uid, is_new = get_or_create_user_id()
    data = request.get_json(force=True) or {}
    headline = title_cleanup((data.get("headline") or "").upper())
    score = float(data.get("score") or 0)
    time_taken = float(data.get("timeTaken") or 0)
    url_a = data.get("url") or ""
    source_name = data.get("sourceName") or ""
    published_at = data.get("publishedAt") or ""

    if not headline:
        return jsonify({"error": "headline required"}), 400

    # enforce daily cap server-side
    if plays_today(uid) >= MAX_DAILY:
        return jsonify({"error": "Daily limit reached"}), 429

    # Upsert-like behavior: ignore duplicate headline for same user
    existing = Play.query.filter_by(user_id=uid, headline=headline).first()
    if existing:
        return jsonify({"status": "exists"})

    p = Play(
        user_id=uid,
        headline=headline,
        score=score,
        time_taken=time_taken,
        date_played=date.today(),  # server date
        source_name=source_name,
        url=url_a,
        published_at=published_at
    )
    db.session.add(p)
    db.session.commit()

    return jsonify({"status": "ok", "streak": compute_streak(uid)})

@app.route("/history", methods=["GET", "DELETE"])
def history():
    uid, is_new = get_or_create_user_id()

    if request.method == "DELETE":
        Play.query.filter_by(user_id=uid).delete()
        db.session.commit()
        return jsonify({"status": "cleared"})

    # GET
    rows = Play.query.filter_by(user_id=uid).order_by(Play.date_played.desc(), Play.id.desc()).all()
    out = [{
        "headline": r.headline,
        "score": r.score,
        "timeTaken": r.time_taken,
        "date": r.date_played.isoformat(),
        "url": r.url,
        "sourceName": r.source_name,
        "publishedAt": r.published_at
    } for r in rows]
    return jsonify(out)

if __name__ == "__main__":
    app.run(debug=True)
