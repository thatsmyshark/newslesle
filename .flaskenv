FLASK_APP=app.py
FLASK_ENV=development
# force local SQLite, even if Railway DATABASE_URL leaks in
SQLALCHEMY_DATABASE_URI=sqlite:///newslesle_dev.db