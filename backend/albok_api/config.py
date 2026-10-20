import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PORT = 8765
DEFAULT_CORS_ORIGINS = [
    # Expo dev server (web)
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    # Electron production build serves the exported web app from this origin
    "app://albok",
]


def _default_data_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "data"


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("ALBOK_DATA_DIR") or _default_data_dir()))
    host: str = field(default_factory=lambda: os.environ.get("ALBOK_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.environ.get("ALBOK_PORT", DEFAULT_PORT)))
    cors_origins: list[str] = field(
        default_factory=lambda: [
            o.strip() for o in os.environ.get("ALBOK_CORS_ORIGINS", ",".join(DEFAULT_CORS_ORIGINS)).split(",") if o.strip()
        ]
    )
    max_upload_bytes: int = 50 * 1024 * 1024

    @property
    def database_url(self) -> str:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.data_dir / 'albok.db'}"


settings = Settings()
