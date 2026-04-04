# Docker Setup — dockerfile-generator

Run the [iamjairo/dockerfile-generator](https://github.com/iamjairo/dockerfile-generator) Streamlit app
inside Docker on your local macOS machine.

---

## Directory layout

```
python-repo-docker/
├── Dockerfile               ← multi-stage Python 3.12 image
├── docker-compose.yml       ← service definition with custom bridge network
├── .env.example             ← template for API keys
├── docker/
│   └── streamlit_config.toml← Streamlit server config (no telemetry, headless)
└── DOCKER_SETUP.md          ← you are here
```

These files are designed to be **copied into the root of your cloned Python repo**,
or built with the repo root as the Docker build context.

---

## Prerequisites

| Tool | Minimum version | macOS install |
|------|-----------------|---------------|
| Docker Desktop | 4.x | https://www.docker.com/products/docker-desktop |
| Git | any | `brew install git` |

---

## Quick start (copy-paste)

```bash
# 1. Clone the Python repo
git clone https://github.com/iamjairo/dockerfile-generator.git
cd dockerfile-generator

# 2. Copy the Docker files into the repo root
cp -r /path/to/python-repo-docker/. .

# 3. Create your .env from the example
cp .env.example .env
#    Open .env and fill in at least one API key (e.g. OPENAI_API_KEY)

# 4. Build and start
docker compose up --build -d

# 5. Open the app
open http://localhost:8501
```

---

## Environment variables (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | optional* | OpenAI GPT-4o |
| `GOOGLE_API_KEY` | optional* | Google Gemini 1.5 Pro |
| `ANTHROPIC_API_KEY` | optional* | Anthropic Claude 3.5 Sonnet |
| `COHERE_API_KEY` | optional* | Cohere Command-R+ |
| `OLLAMA_HOST` | optional | e.g. `http://host.docker.internal:11434` for local Ollama |
| `OLLAMA_MODEL` | optional | e.g. `llama3` |

\* At least **one** provider key is needed to generate Dockerfiles.

---

## Common commands

```bash
# View live logs
docker compose logs -f

# Stop the container (data preserved)
docker compose stop

# Stop and remove container + network
docker compose down

# Rebuild after code changes
docker compose up --build -d

# Open a shell inside the running container
docker compose exec app bash
```

---

## Ollama (local LLM) on macOS

The container cannot reach `localhost:11434` directly. Use Docker's special hostname:

```env
# .env
OLLAMA_HOST=http://host.docker.internal:11434
OLLAMA_MODEL=llama3
```

Make sure Ollama is running on your Mac before starting the container:

```bash
ollama serve &
```

---

## Healthcheck

The Dockerfile and compose file both define a healthcheck against Streamlit's built-in
`/_stcore/health` endpoint. After `docker compose up`, run:

```bash
docker compose ps
# STATUS column should show: healthy
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Port 8501 already in use | Change `published: 8501` in compose to e.g. `8502` |
| `ModuleNotFoundError` on startup | Re-run `docker compose up --build` to reinstall deps |
| Blank page / no providers shown | Ensure `.env` contains at least one valid API key |
| Ollama connection refused | Set `OLLAMA_HOST=http://host.docker.internal:11434` |
| Subnet `172.20.0.0/24` conflict | Edit `subnet` + `gateway` in `docker-compose.yml` networks section |
