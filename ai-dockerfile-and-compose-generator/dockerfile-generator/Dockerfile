# =============================================================================
# Dockerfile — dockerfile-generator (Streamlit + multi-provider AI)
# =============================================================================
# Build:  docker build -t dockerfile-generator .
# Run:    docker run --env-file .env -p 8501:8501 dockerfile-generator
# =============================================================================

FROM python:3.11-slim AS base

# ── System dependencies ───────────────────────────────────────────────────────
# git  : required by repo_analyzer.py (shallow-clones GitHub repos)
# curl : used by the HEALTHCHECK
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Non-root user ────────────────────────────────────────────────────────────
RUN groupadd --gid 1000 appuser \
    && useradd --uid 1000 --gid 1000 --no-create-home appuser

# ── Working directory ────────────────────────────────────────────────────────
WORKDIR /app

# ── Python dependencies ──────────────────────────────────────────────────────
# Copy manifests first so Docker can cache this layer independently of source.
COPY requirements.txt ./

# Install all Python dependencies including Streamlit (not in requirements.txt
# upstream but required to run app.py).
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir \
        streamlit>=1.35.0 \
        -r requirements.txt

# ── Application source ───────────────────────────────────────────────────────
COPY . .

# ── Streamlit config ─────────────────────────────────────────────────────────
# Disable the "Welcome to Streamlit" first-run prompt and telemetry.
# Override the server address so it binds on all interfaces inside the container.
RUN mkdir -p /app/.streamlit
COPY .streamlit/config.toml /app/.streamlit/config.toml 2>/dev/null || true

RUN printf '[general]\nemail = ""\n\n[server]\nheadless = true\naddress = "0.0.0.0"\nport = 8501\nenableCORS = false\nenableXsrfProtection = false\n\n[browser]\ngatherUsageStats = false\n' \
    > /app/.streamlit/config.toml

# ── File ownership ───────────────────────────────────────────────────────────
RUN chown -R appuser:appuser /app
USER appuser

# ── Port ─────────────────────────────────────────────────────────────────────
EXPOSE 8501

# ── Health check ─────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8501/_stcore/health || exit 1

# ── Entrypoint ───────────────────────────────────────────────────────────────
ENTRYPOINT ["streamlit", "run", "app.py"]
CMD ["--server.port=8501", "--server.address=0.0.0.0"]
