"""Database engine and session management.

Several enrichment threads write concurrently while the UI thread reads,
so the connection is tuned for that: WAL journaling lets readers work
during a write, and a busy timeout makes a brief lock wait instead of
failing the product with "database is locked".
"""

from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from epay_tool.config import DB_PATH, ensure_dirs
from epay_tool.db.models import Base

BUSY_TIMEOUT_SECONDS = 30

_engine = None
_SessionFactory: sessionmaker | None = None


def _configure_sqlite(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def init_db(db_url: str | None = None):
    """Create the engine and tables. Call once at app start."""
    global _engine, _SessionFactory
    ensure_dirs()
    url = db_url or f"sqlite:///{DB_PATH}"
    _engine = create_engine(
        url,
        connect_args={"check_same_thread": False, "timeout": BUSY_TIMEOUT_SECONDS},
    )
    event.listen(_engine, "connect", _configure_sqlite)
    Base.metadata.create_all(_engine)
    _SessionFactory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def get_session() -> Session:
    if _SessionFactory is None:
        raise RuntimeError("init_db() must be called before get_session()")
    return _SessionFactory()
