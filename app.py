# app.py

import json
from flask import Flask, redirect, render_template, jsonify, url_for
import requests
import random
import re

app = Flask(__name__)

NEWS_API_KEY = "d29cdda90f014b88bde1bbe8bf1a8e51"
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

    cached_article = {
        'headline': headline,
        'description': description,
        'url': article_url,
        'urlToImage': image_url,
        'sourceName': source_name 
    }
    print(f"[Newslesle Answer] {cached_article['headline']}")
    print(f"[Newslesle URL] {cached_article['url']}")

    return jsonify({
        'headline': headline,
        'description': description,
        'url': article_url,
        'urlToImage': image_url,
        'sourceName': source_name 
    })

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True)
