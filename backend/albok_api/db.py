from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine, select

from .models import Subject

STARTER_SUBJECTS = [
    {"name": "Mathematics", "slug": "mathematics", "description": "Algebra, geometry and calculus", "color": "#2563eb", "icon": "calculator"},
    {"name": "Physics", "slug": "physics", "description": "Mechanics, energy and waves", "color": "#7c3aed", "icon": "atom"},
    {"name": "Chemistry", "slug": "chemistry", "description": "Elements, reactions and compounds", "color": "#0891b2", "icon": "flask-conical"},
    {"name": "Biology", "slug": "biology", "description": "Cells, genetics and ecosystems", "color": "#16a34a", "icon": "leaf"},
    {"name": "History", "slug": "history", "description": "Civilisations, events and people", "color": "#d97706", "icon": "landmark"},
]


def create_db_engine(database_url: str) -> Engine:
    engine = create_engine(database_url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def init_db(engine: Engine) -> None:
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        if session.exec(select(Subject)).first() is None:
            for position, subject in enumerate(STARTER_SUBJECTS):
                session.add(Subject(position=position, **subject))
            session.commit()


def get_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine) as session:
        yield session
