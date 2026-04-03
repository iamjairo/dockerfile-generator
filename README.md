# 🚀 Dockerfile Generator

Generate production-ready **Dockerfiles** and **docker-compose.yml** files for any project — from a GitHub repository URL or a language / framework name — powered by AI.

---

## ✨ Features

- **GitHub repo analysis** — paste a public GitHub URL (`https://github.com/owner/repo` or `owner/repo`) and the app shallow-clones it, detects the language, framework, build tool, runtime versions, and exposed ports, then generates tailored Docker files.
- **Language / framework input** — the classic mode: type a language or framework name and get instant results.
- **Dual output** — generates both a `Dockerfile` (multi-stage, non-root, HEALTHCHECK, pinned base image) and a `docker-compose.yml` with download buttons for each.
- **Multi-AI provider support** — use whichever AI you have an account with; the sidebar only shows providers whose API key is configured.
- **Bridge & Macvlan network support** — choose your Docker network type in the sidebar; the generated `docker-compose.yml` follows the exact [homelab-alpha](https://homelab-alpha.nl) network conventions.
- **homelab-alpha templates** — base templates for both Dockerfile and docker-compose are baked in as structural starting points for the AI.

---

## 🌐 Live App

[https://dockerfile-generator.streamlit.app/](https://dockerfile-generator.streamlit.app/)

---

## 🤖 Supported AI Providers

| Provider | Env var | Model |
|---|---|---|
| **Cohere** | `COHERE_API_KEY` | command-r-plus |
| **OpenAI** | `OPENAI_API_KEY` | gpt-4o (configurable via `OPENAI_MODEL`) |
| **Google Gemini** | `GOOGLE_API_KEY` | gemini-1.5-pro |
| **Anthropic Claude** | `ANTHROPIC_API_KEY` | claude-3-5-sonnet-latest |
| **Ollama (local)** | *(none required)* | llama3 (configurable via `OLLAMA_MODEL`) |

Only providers with a key set in `.env` are shown in the sidebar. Ollama is always shown (uses `http://localhost:11434`).

---

## 🔀 Docker Network Types

### Bridge (default)

Containers share an isolated virtual network and reach the internet via NAT. Services are exposed through port mappings. Best for most containerised workloads.

Convention: [homelab-alpha bridge network setup](https://homelab-alpha.nl/docker/network-info/bridge-network-setup/)

```yaml
networks:
  myapp_net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/24
          ip_range: 172.20.0.0/24
          gateway: 172.20.0.1
    driver_opts:
      com.docker.network.bridge.enable_icc: "true"
      com.docker.network.bridge.enable_ip_masquerade: "true"
      com.docker.network.driver.mtu: "1500"
```

### Macvlan

Each container gets a real LAN IP and MAC address — directly reachable from other hosts on the network without port mapping. Best for homelab services (e.g. DNS, reverse proxies, home automation) that need to appear as physical devices.

Convention: [homelab-alpha macvlan network setup](https://homelab-alpha.nl/docker/network-info/macvlan-network-setup/)

```yaml
networks:
  myapp_net:
    driver: macvlan
    ipam:
      config:
        - subnet: 192.168.1.0/24
          ip_range: 192.168.1.128/25
          gateway: 192.168.1.1
    driver_opts:
      parent: eno1    # run `ip a` to find your NIC name
      ipv6: "false"
```

> **Note:** The Docker host itself cannot reach macvlan containers by default. Create a macvlan shim interface on the host if host → container traffic is needed.

---

## 📊 Application Flow

```
User (Browser)
    │
    ├─ Tab: GitHub Repository URL ──► repo_analyzer.py (clone + analyse)
    │                                         │
    └─ Tab: Language / Framework              │
                │                             │
                └────────────────────────────►│
                                         context dict
                                              │
                                    generate_dockerfile.py
                                    ┌─────────┴──────────┐
                               Dockerfile          docker-compose.yml
                               (multi-stage,       (bridge or macvlan,
                                non-root,           homelab-alpha
                                HEALTHCHECK)        conventions)
                                              │
                                       ai_providers.py
                                    ┌────────┼────────┐
                                 Cohere  OpenAI  Gemini  Anthropic  Ollama
```

---

## 🚦 Quickstart

### 1. Clone the repo

```bash
git clone https://github.com/iamjairo/dockerfile-generator.git
cd dockerfile-generator
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure API keys

```bash
cp .env.example .env
# Edit .env and add at least one AI provider key
```

### 4. Run the app

```bash
streamlit run app.py
```

---

## 🛠️ Project Structure

```
.
├── app.py                          # Streamlit UI
├── generate_dockerfile.py          # AI prompt logic (Dockerfile + docker-compose)
├── ai_providers.py                 # Multi-AI provider interface
├── repo_analyzer.py                # GitHub repo cloning & analysis
├── templates/
│   ├── Dockerfile.template         # Base Dockerfile template (multi-stage)
│   └── docker-compose.template.yml # Base docker-compose template (bridge + macvlan)
├── requirements.txt                # Python dependencies
├── .env.example                    # Example environment variables
└── README.md                       # This file
```

---

## 🌐 Deployment (Free!)

**Deploy on [Streamlit Community Cloud](https://streamlit.io/cloud):**

1. Push your code to a public GitHub repo.
2. Go to Streamlit Cloud and create a new app from your repo.
3. Add your API key(s) in the app's **Secrets** (Settings → Secrets).
4. Click Deploy — done!

---

## 🤝 Contributing

Contributions welcome! Open issues, suggest features, or submit PRs.

---

## 🙏 Credits

- [Streamlit](https://streamlit.io/)
- [Cohere](https://cohere.com/)
- [OpenAI](https://openai.com/)
- [Google Gemini](https://ai.google.dev/)
- [Anthropic](https://anthropic.com/)
- [Ollama](https://ollama.com/)
- [homelab-alpha](https://homelab-alpha.nl) — Docker network conventions

---

*Built with ❤️ using AI!*
