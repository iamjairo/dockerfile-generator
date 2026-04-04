# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Dockerfile — iamjairo/dockerfile-generator (Streamlit + multi-provider AI)
# ---------------------------------------------------------------------------

# ── Stage 1: dependency builder ─────────────────────────────────────────────
FROM python:3.11-slim AS builder

# Install build dependencies required by some AI client libraries
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gcc \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy only the dependency manifest first for maximum layer-cache reuse
COPY requirements.txt .

# Install into an isolated prefix so we can copy just the packages to runtime
RUN pip install --upgrade pip \
    && pip install --prefix=/install --no-cache-dir -r requirements.txt


# ── Stage 2: runtime image ──────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

LABEL maintainer="iamjairo" \
      description="Dockerfile Generator — Streamlit app with multi-provider AI support" \
      org.opencontainers.image.source="https://github.com/iamjairo/dockerfile-generator"

# git is required by repo_analyzer.py for shallow-cloning GitHub repos
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-built Python packages from builder
COPY --from=builder /install /usr/local

# Create a non-root user to run the application
RUN useradd --no-create-home --shell /bin/false appuser

WORKDIR /app

# Copy application source
COPY . .

# Ensure the Streamlit config directory exists and set sane defaults
# (prevents Streamlit from nagging about email / telemetry on first run)
RUN mkdir -p /home/appuser/.streamlit && \
    printf '[general]\nemail = ""\n\n[server]\nheadless = true\nenableCORS = false\nenableXsrfProtection = false\n' \
      > /home/appuser/.streamlit/credentials.toml && \
    printf '[server]\nheadless = true\nport = 8501\nenableCORS = false\naddress = "0.0.0.0"\n' \
      > /home/appuser/.streamlit/config.toml && \
    chown -R appuser:appuser /home/appuser /app

USER appuser

# Streamlit default port
EXPOSE 8501

# Liveness check — Streamlit serves a /_stcore/health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8501/_stcore/health')" || exit 1

ENTRYPOINT ["python", "-m", "streamlit", "run"]
CMD ["app.py", "--server.port=8501", "--server.address=0.0.0.0"]
