import streamlit as st
from ai_providers import available_providers
from generate_dockerfile import generate_dockerfile, generate_docker_compose
from repo_analyzer import analyze_repo

st.set_page_config(page_title="Dockerfile Generator", layout="centered")

st.markdown(
    """
    <style>
    .main { background-color: #f5f7fa; }
    .stButton>button {
        background-color: #0072ff;
        color: white;
        font-weight: bold;
        border-radius: 8px;
        padding: 0.5em 2em;
        margin-top: 1em;
        transition: background 0.3s;
    }
    .stButton>button:hover { background-color: #0059b2; }
    .stTextInput>div>div>input {
        border-radius: 6px;
        border: 1.5px solid #0072ff;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
st.title("🚀 Dockerfile Generator")
st.write(
    "Generate a production-ready **Dockerfile** and **docker-compose.yml** from a "
    "GitHub repository URL or by specifying a language / framework."
)
st.markdown("---")

# ---------------------------------------------------------------------------
# Sidebar — AI provider + network type selection
# ---------------------------------------------------------------------------
with st.sidebar:
    st.header("⚙️ Settings")
    providers = available_providers()

    if not providers:
        st.error(
            "No AI provider configured.\n\n"
            "Add at least one API key to your `.env` file and restart the app.\n\n"
            "See `.env.example` for all supported keys."
        )
        st.stop()

    provider = st.selectbox(
        "AI Provider",
        providers,
        help="Only providers with a configured API key are listed.",
    )

    st.markdown("---")

    network_type = st.radio(
        "Docker Network Type",
        options=["bridge", "macvlan"],
        index=0,
        help=(
            "**bridge** — Isolated virtual network; containers reach the internet via NAT. "
            "Best for most containerised workloads.\n\n"
            "**macvlan** — Containers appear as physical devices on your LAN with their own "
            "MAC addresses. Best for homelab services that need a real LAN IP directly "
            "reachable from other hosts."
        ),
    )

    if network_type == "bridge":
        st.info(
            "🔀 **Bridge network**\n\n"
            "Containers share an isolated virtual network. "
            "Internet access via NAT. Services are exposed through port mappings.\n\n"
            "Convention: [homelab-alpha bridge setup]"
            "(https://homelab-alpha.nl/docker/network-info/bridge-network-setup/)"
        )
    else:
        st.warning(
            "🔌 **Macvlan network**\n\n"
            "Each container gets a real LAN IP and MAC address — directly reachable "
            "from other hosts without port mapping.\n\n"
            "⚠️ Requires: knowing your host's physical NIC name (`ip a`). "
            "The Docker host itself cannot reach macvlan containers by default.\n\n"
            "Convention: [homelab-alpha macvlan setup]"
            "(https://homelab-alpha.nl/docker/network-info/macvlan-network-setup/)"
        )

    st.markdown("---")
    st.markdown(
        "**Supported AI providers**\n"
        "- Cohere → `COHERE_API_KEY`\n"
        "- OpenAI → `OPENAI_API_KEY`\n"
        "- Gemini → `GOOGLE_API_KEY`\n"
        "- Anthropic → `ANTHROPIC_API_KEY`\n"
        "- Ollama → runs locally (no key needed)\n"
    )

# ---------------------------------------------------------------------------
# Input — tabs: GitHub repo vs language / framework
# ---------------------------------------------------------------------------
tab_github, tab_language = st.tabs(["🐙 GitHub Repository", "💬 Language / Framework"])

repo_context: dict | None = None
language_context: dict | None = None

with tab_github:
    st.markdown(
        "Paste a **public** GitHub repository URL or shorthand. "
        "The app will clone the repo, analyse its contents, and generate "
        "tailored Docker files."
    )
    repo_url = st.text_input(
        "GitHub repository",
        placeholder="https://github.com/owner/repo  or  owner/repo",
        key="repo_url_input",
    )
    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        analyse_btn = st.button("🔍 Analyse & Generate", use_container_width=True, key="analyse_btn")

    if analyse_btn:
        if not repo_url.strip():
            st.warning("⚠️ Please enter a GitHub repository URL.")
        else:
            with st.spinner("Cloning and analysing repository…"):
                ctx = analyze_repo(repo_url.strip())

            if ctx.get("error"):
                st.error(f"❌ {ctx['error']}")
            else:
                repo_context = ctx
                with st.expander("📋 Repository Analysis", expanded=True):
                    st.markdown(f"**Language:** {ctx.get('language') or 'Unknown'}")
                    if ctx.get("framework"):
                        st.markdown(f"**Framework:** {ctx['framework']}")
                    if ctx.get("build_tool"):
                        st.markdown(f"**Build tool:** {ctx['build_tool']}")
                    if ctx.get("runtime_versions"):
                        versions = ", ".join(f"{k} {v}" for k, v in ctx["runtime_versions"].items())
                        st.markdown(f"**Runtime versions:** {versions}")
                    if ctx.get("detected_ports"):
                        ports = ", ".join(str(p) for p in ctx["detected_ports"])
                        st.markdown(f"**Detected ports:** {ports}")
                    if ctx.get("manifests_found"):
                        manifests = ", ".join(ctx["manifests_found"])
                        st.markdown(f"**Manifest files:** {manifests}")
                    if ctx.get("existing_docker_files"):
                        existing = ", ".join(ctx["existing_docker_files"].keys())
                        st.info(f"ℹ️ Existing Docker files found (used as reference): {existing}")

with tab_language:
    st.markdown(
        "Enter the programming language or framework you want Docker files for."
    )
    language = st.text_input(
        "Language or framework",
        placeholder="e.g. Python, Node.js, Java, Django, React, Go…",
        key="language_input",
    )
    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        generate_btn = st.button("⚡ Generate Docker Files", use_container_width=True, key="generate_btn")

    if generate_btn:
        if not language.strip():
            st.warning("⚠️ Please enter a programming language or framework.")
        else:
            language_context = {"language": language.strip()}

# ---------------------------------------------------------------------------
# Generation — runs for whichever tab submitted a context
# ---------------------------------------------------------------------------
active_context = repo_context or language_context

if active_context is not None:
    label = active_context.get("framework") or active_context.get("language") or "project"
    st.markdown("---")
    st.subheader(f"📦 Generated Docker Files — {label}  `({network_type} network)`")

    with st.spinner(f"Generating Dockerfile using {provider}…"):
        try:
            dockerfile_result = generate_dockerfile(active_context, provider)
            dockerfile_ok = True
        except Exception as exc:
            dockerfile_result = ""
            dockerfile_ok = False
            dockerfile_error = exc

    with st.spinner(f"Generating docker-compose.yml using {provider} [{network_type} network]…"):
        try:
            compose_result = generate_docker_compose(active_context, provider, network_type)
            compose_ok = True
        except Exception as exc:
            compose_result = ""
            compose_ok = False
            compose_error = exc

    out_tab1, out_tab2 = st.tabs(["📄 Dockerfile", "🐳 docker-compose.yml"])

    with out_tab1:
        if dockerfile_ok:
            st.success("✅ Dockerfile generated!")
            st.code(dockerfile_result, language="dockerfile")
            st.download_button(
                label="⬇️ Download Dockerfile",
                data=dockerfile_result,
                file_name="Dockerfile",
                mime="text/plain",
            )
        else:
            st.error("❌ Failed to generate Dockerfile.")
            st.exception(dockerfile_error)

    with out_tab2:
        if compose_ok:
            st.success("✅ docker-compose.yml generated!")
            st.code(compose_result, language="yaml")
            st.download_button(
                label="⬇️ Download docker-compose.yml",
                data=compose_result,
                file_name="docker-compose.yml",
                mime="text/plain",
            )
        else:
            st.error("❌ Failed to generate docker-compose.yml.")
            st.exception(compose_error)

# ---------------------------------------------------------------------------
# Footer
# ---------------------------------------------------------------------------
st.markdown("---")
st.markdown(
    "<small style='color: #888;'>Built with ❤️ for developers. "
    "Supports Cohere · OpenAI · Google Gemini · Anthropic Claude · Ollama. "
    "Network conventions by <a href='https://homelab-alpha.nl' target='_blank'>homelab-alpha</a>.</small>",
    unsafe_allow_html=True,
)
