# =============================================================================
# Dockerfile — iamjairo/dockerfile-generator (Streamlit + multi-provider AI)
# =============================================================================
# Stages
#   builder   — install Python deps into a virtual-env (keeps the final image clean)
#   runtime   — lean production image; git is included for repo analysis
# =============================================================================

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# System build-deps (git for any source installs; gcc for C extensions)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        git \
 && rm -rf /var/lib/apt/lists/*

# Create an isolated virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies first (cache layer)
COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir streamlit

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

LABEL org.opencontainers.image.title="Dockerfile Generator" \
      org.opencontainers.image.description="Multi-provider AI Dockerfile & docker-compose generator (Streamlit)" \
      org.opencontainers.image.source="https://github.com/iamjairo/dockerfile-generator"

# Runtime system packages
#   git  — required by repo_analyzer.py to shallow-clone repositories
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        git \
        curl \
 && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Non-root user for security
RUN groupadd --gid 1001 appgroup \
 && useradd  --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

WORKDIR /app

# Copy application source (preserves directory structure)
COPY --chown=appuser:appgroup . .

# Streamlit configuration — disable telemetry, set server options
RUN mkdir -p /home/appuser/.streamlit
COPY --chown=appuser:appgroup docker/streamlit_config.toml /home/appuser/.streamlit/config.toml

USER appuser

# Streamlit default port
EXPOSE 8501

# Liveness probe — Streamlit exposes a /_stcore/health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8501/_stcore/health || exit 1

ENTRYPOINT ["streamlit", "run", "app.py"]
CMD ["--server.port=8501", "--server.address=0.0.0.0"]
