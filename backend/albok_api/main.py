import asyncio
import logging
from contextlib import asynccontextmanager, suppress

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .clock import Clock
from .config import settings
from .db import create_db_engine, init_db
from .oidc import OIDCClient
from .routers import admin, auth, content, exports, reader, student

log = logging.getLogger(__name__)


def build_oidc_client(mock: bool, transport: httpx.AsyncBaseTransport | None) -> OIDCClient | None:
    redirect_uri = f"{settings.public_url}/auth/callback"
    if mock:
        from .mock_oidc import MOCK_CLIENT_ID, MOCK_CLIENT_SECRET

        return OIDCClient(
            f"{settings.public_url}/mock-oidc", MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, redirect_uri, settings.oidc_scopes,
            transport=transport,
        )  # fmt: skip
    if settings.oidc_issuer and settings.oidc_client_id:
        return OIDCClient(
            settings.oidc_issuer,
            settings.oidc_client_id,
            settings.oidc_client_secret,
            redirect_uri,
            settings.oidc_scopes,
            token_auth=settings.oidc_token_auth,
            transport=transport,
        )
    log.warning("No OIDC provider configured: nobody can sign in. Set ALBOK_OIDC_* or ALBOK_MOCK_OIDC=1.")
    return None


def create_app(
    database_url: str | None = None,
    *,
    clock: Clock | None = None,
    mock_oidc: bool | None = None,
    oidc_transport: httpx.AsyncBaseTransport | None = None,
    run_jobs: bool | None = None,
    seed: bool | None = None,
) -> FastAPI:
    mock = settings.mock_oidc if mock_oidc is None else mock_oidc
    if clock is None:
        clock = Clock.offset_to(settings.tz, settings.fake_now) if settings.fake_now else Clock(settings.tz)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.engine = create_db_engine(database_url or settings.database_url)
        init_db(app.state.engine)
        if mock if seed is None else seed:
            from .dev_seed import seed_if_empty

            await asyncio.to_thread(seed_if_empty, app.state.engine, clock)
        jobs_task = None
        if settings.run_jobs if run_jobs is None else run_jobs:
            from .jobs import job_loop

            jobs_task = asyncio.create_task(job_loop(app.state.engine, clock))
        yield
        if jobs_task:
            jobs_task.cancel()
            with suppress(asyncio.CancelledError):
                await jobs_task
        app.state.engine.dispose()

    app = FastAPI(title="Albok API", version="0.2.0", lifespan=lifespan)
    app.state.clock = clock
    app.state.oidc = build_oidc_client(mock, oidc_transport)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth.router)
    app.include_router(student.router)
    app.include_router(reader.router)
    app.include_router(exports.router)
    app.include_router(content.router)
    app.include_router(admin.router)
    if mock:
        from . import mock_oidc

        app.include_router(mock_oidc.router)

    @app.get("/api/health", tags=["meta"])
    def health():
        return {"status": "ok", "version": app.version}

    @app.get("/api/public", tags=["meta"])
    def public_config():
        """Shown on the sign-in page before anyone is signed in."""
        return {"school_name": settings.school_name, "privacy_url": settings.privacy_url or None}

    return app


app = create_app()
