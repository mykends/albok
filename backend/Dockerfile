# Albok API. Build context: backend/
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 ALBOK_DATA_DIR=/data
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY albok_api ./albok_api
COPY samples ./samples

RUN useradd --system --uid 10001 albok && mkdir -p /data && chown albok /data
USER albok
VOLUME /data
EXPOSE 8000

# One worker: background jobs (conversion, exports, the daily school-year job) run in this process.
CMD ["uvicorn", "albok_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
