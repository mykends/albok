import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_PORT = 8765
DEFAULT_CORS_ORIGINS = [
    # Expo dev server (web). Cookies are per host, so use "localhost" for both the app and the API in development.
    "http://localhost:8081",
]
DEFAULT_SCOPES = "openid profile email hrEduPersonPrimaryAffiliation hrEduPersonStaffCategory hrEduPersonHomeOrg o"


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_bool(name: str, default: bool = False) -> bool:
    value = _env(name)
    return default if not value else value.lower() in ("1", "true", "yes", "on")


def _env_list(name: str, default: list[str]) -> list[str]:
    value = os.environ.get(name)
    if value is None:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


def _default_data_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "data"


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(_env("ALBOK_DATA_DIR") or _default_data_dir()))
    # PostgreSQL in production, e.g. postgresql+psycopg://albok:secret@db/albok. Falls back to SQLite for development.
    database_url_override: str = field(default_factory=lambda: _env("ALBOK_DATABASE_URL"))
    host: str = field(default_factory=lambda: _env("ALBOK_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(_env("ALBOK_PORT", str(DEFAULT_PORT))))
    # Where the API is reachable from browsers; the OIDC redirect URI is built from it.
    public_url: str = field(default_factory=lambda: _env("ALBOK_PUBLIC_URL", f"http://localhost:{DEFAULT_PORT}").rstrip("/"))
    # Where the web UI lives. Same as public_url in production; the Expo dev server in development.
    web_url: str = field(default_factory=lambda: _env("ALBOK_WEB_URL", "http://localhost:8081").rstrip("/"))
    cors_origins: list[str] = field(default_factory=lambda: _env_list("ALBOK_CORS_ORIGINS", DEFAULT_CORS_ORIGINS))
    max_upload_bytes: int = field(default_factory=lambda: int(_env("ALBOK_MAX_UPLOAD_MB", "300")) * 1024 * 1024)
    timezone: str = field(default_factory=lambda: _env("ALBOK_TIMEZONE", "Europe/Zagreb"))
    session_secret: str = field(default_factory=lambda: _env("ALBOK_SESSION_SECRET", "dev-only-secret-change-me"))
    school_name: str = field(default_factory=lambda: _env("ALBOK_SCHOOL_NAME"))
    # The school's published GDPR privacy policy (required for AAI@EduHr), linked from the sign-in page.
    privacy_url: str = field(default_factory=lambda: _env("ALBOK_PRIVACY_URL"))

    # AAI@EduHr (OpenID Connect, confidential client)
    oidc_issuer: str = field(default_factory=lambda: _env("ALBOK_OIDC_ISSUER").rstrip("/"))
    oidc_client_id: str = field(default_factory=lambda: _env("ALBOK_OIDC_CLIENT_ID"))
    oidc_client_secret: str = field(default_factory=lambda: _env("ALBOK_OIDC_CLIENT_SECRET"))
    oidc_scopes: str = field(default_factory=lambda: _env("ALBOK_OIDC_SCOPES", DEFAULT_SCOPES))
    # "client_secret_basic" or "client_secret_post"
    oidc_token_auth: str = field(default_factory=lambda: _env("ALBOK_OIDC_TOKEN_AUTH", "client_secret_basic"))
    # Forces a fresh login on shared PCs. Set to "" if the provider rejects it (max_age=0 is sent as well).
    oidc_prompt: str = field(default_factory=lambda: _env("ALBOK_OIDC_PROMPT", "login"))
    # Built-in mock provider with seeded users, for running without AAI@EduHr Lab.
    mock_oidc: bool = field(default_factory=lambda: _env_bool("ALBOK_MOCK_OIDC"))
    # Value of `o` or `hrEduPersonHomeOrg` that identifies this school. Empty disables the check.
    school_org: str = field(default_factory=lambda: _env("ALBOK_SCHOOL_ORG"))
    # AAI usernames that are always admins, so the first admin can sign in before any roster exists.
    bootstrap_admins: list[str] = field(default_factory=lambda: [u.lower() for u in _env_list("ALBOK_ADMINS", [])])

    student_idle_minutes: int = field(default_factory=lambda: int(_env("ALBOK_STUDENT_IDLE_MINUTES", "10")))
    staff_idle_minutes: int = field(default_factory=lambda: int(_env("ALBOK_STAFF_IDLE_MINUTES", "120")))
    staff_session_hours: int = field(default_factory=lambda: int(_env("ALBOK_STAFF_SESSION_HOURS", "12")))

    # Office → PDF conversion. A Gotenberg URL (the `convert` service) or, if empty, a local `soffice` binary.
    converter_url: str = field(default_factory=lambda: _env("ALBOK_CONVERTER_URL").rstrip("/"))
    soffice_path: str = field(default_factory=lambda: _env("ALBOK_SOFFICE", "soffice"))

    # School SMTP relay. Without a host, emails are written to <data_dir>/outbox as .eml files.
    smtp_host: str = field(default_factory=lambda: _env("ALBOK_SMTP_HOST"))
    smtp_port: int = field(default_factory=lambda: int(_env("ALBOK_SMTP_PORT", "587")))
    smtp_user: str = field(default_factory=lambda: _env("ALBOK_SMTP_USER"))
    smtp_password: str = field(default_factory=lambda: _env("ALBOK_SMTP_PASSWORD"))
    # "starttls", "ssl" or "none"
    smtp_security: str = field(default_factory=lambda: _env("ALBOK_SMTP_SECURITY", "starttls"))
    mail_from: str = field(default_factory=lambda: _env("ALBOK_MAIL_FROM", "Albok <albok@localhost>"))
    max_attachment_mb: int = field(default_factory=lambda: int(_env("ALBOK_MAX_ATTACHMENT_MB", "20")))

    # Runs the daily school-year jobs (warning emails, year-end deletion) inside the API process.
    run_jobs: bool = field(default_factory=lambda: _env_bool("ALBOK_RUN_JOBS", True))
    # Development only: pretend it is this local time (e.g. 2026-10-21T09:00) so lessons can be tried at night.
    fake_now: str = field(default_factory=lambda: _env("ALBOK_FAKE_NOW"))

    @property
    def database_url(self) -> str:
        if self.database_url_override:
            return self.database_url_override
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.data_dir / 'albok.db'}"

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def secure_cookies(self) -> bool:
        return self.public_url.startswith("https://")

    @property
    def oidc_enabled(self) -> bool:
        return self.mock_oidc or bool(self.oidc_issuer and self.oidc_client_id)


settings = Settings()
