# Chatterbox voice-cloning service (CPU by default).
# GPU build: docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
FROM python:3.11-slim

# CPU wheels by default; the GPU override passes https://download.pytorch.org/whl/cu124
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models \
    VOICE_DATA_DIR=/data/voices

WORKDIR /app
# ffmpeg lets the service convert uploads the browser couldn't (M4A/AAC voice memos, WebM, ...).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
RUN pip install torch==2.6.0 torchaudio==2.6.0 --index-url "${TORCH_INDEX}"
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .
# chmod: files copied from the build context keep the host's permissions, which the non-root "app" user may not
# be able to read (uvicorn then exits with code 1 before logging anything useful).
RUN chmod -R a+rX /app \
 && useradd --system --uid 10001 --create-home app \
 && mkdir -p /models /data/voices \
 && chown -R app:app /models /data
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)" || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
