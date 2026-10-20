"""Development entry point (`npm run backend`). Production runs uvicorn directly (see backend/Dockerfile)."""

import uvicorn

from albok_api.config import settings
from albok_api.main import app

if __name__ == "__main__":
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")
