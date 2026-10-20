from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import create_db_engine, init_db
from .routers import books, notes, subjects


def create_app(database_url: str | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.engine = create_db_engine(database_url or settings.database_url)
        init_db(app.state.engine)
        yield
        app.state.engine.dispose()

    app = FastAPI(title="Albok API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(subjects.router)
    app.include_router(books.router)
    app.include_router(notes.router)

    @app.get("/api/health", tags=["meta"])
    def health():
        return {"status": "ok", "version": app.version}

    return app


app = create_app()
