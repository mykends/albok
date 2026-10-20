"""Entry point for `python run.py` and for the PyInstaller-built albok-backend.exe."""

import os
import sys
import threading

import uvicorn

from albok_api.config import settings
from albok_api.main import app


def exit_when_parent_exits() -> None:
    """The desktop app holds our stdin open; EOF means it quit or crashed, so stop too."""

    def watch() -> None:
        sys.stdin.read()
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


if __name__ == "__main__":
    if os.environ.get("ALBOK_EXIT_WITH_PARENT") == "1":
        exit_when_parent_exits()
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")
