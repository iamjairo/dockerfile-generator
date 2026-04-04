# =============================================================================
# Dockerfile — dockerfile-generator (Streamlit app)
# =============================================================================
# Multi-stage build:
#   builder  — installs Python dependencies into a venv
#   runtime  — lean runtime image with only what the app needs
# =============================================================================

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# System deps needed to compile some Python packages (e.g. cryptography)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libssl-dev \
        libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy only the dependency manifest first (maximises Docker layer cache)
COPY requirements.txt .

# Create a venv and install all dependencies into it
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install pinned deps + Streamlit (not in requirements.txt but required by app.py)
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir \
        streamlit==1.35.0 \
        -r requirements.txt


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# git is required by repo_analyzer.py for shallow-cloning GitHub repos
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
    && rm -rf /var/lib/apt/lists/* \
    # Create a non-root user
    && groupadd --system appgroup \
    && useradd  --system --gid appgroup --home /app --shell /sbin/nologin appuser

# Copy the venv from the builder stage
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Copy application source
COPY --chown=appuser:appgroup . .

# Streamlit configuration — disable telemetry, set server defaults
# These can be overridden at runtime via STREAMLIT_* env vars
RUN mkdir -p /app/.streamlit && \
    printf '[server]\nport = 8501\naddress = "0.0.0.0"\nheadless = true\nenableCORS = false\nenableXsrfProtection = true\n\n[browser]\ngatherUsageStats = false\n\n[logger]\nlevel = "info"\n' \
    > /app/.streamlit/config.toml

# Switch to non-root user
USER appuser

# Streamlit listens on 8501 by default
EXPOSE 8501

# Health check — uses Streamlit's built-in healthz endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8501/_stcore/health')" || exit 1

ENTRYPOINT ["streamlit", "run"]
CMD ["app.py", "--server.port=8501", "--server.address=0.0.0.0"]
