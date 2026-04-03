"""
generate_dockerfile.py — Context-aware Dockerfile and docker-compose generation.

Public API
----------
generate_dockerfile(context: dict, provider_name: str) -> str
generate_docker_compose(context: dict, provider_name: str, network_type: str = "bridge") -> str

*context* is either:
  - The dict returned by repo_analyzer.analyze_repo(), or
  - A minimal dict with at least {"language": "<language or framework name>"}
    when the user typed a language directly.

*network_type* is either "bridge" (default) or "macvlan".
  - "bridge"  — isolated virtual network, containers reach internet via NAT.
                Best for most containerised workloads.
  - "macvlan" — containers appear as physical LAN devices with their own MAC
                addresses.  Best for homelab services that need a real LAN IP.
"""

import os
from pathlib import Path

from ai_providers import generate as ai_generate

# ---------------------------------------------------------------------------
# Load base templates once at import time
# ---------------------------------------------------------------------------
_TEMPLATES_DIR = Path(__file__).parent / "templates"


def _read_template(filename: str) -> str:
    path = _TEMPLATES_DIR / filename
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


_DOCKERFILE_TEMPLATE = _read_template("Dockerfile.template")
_COMPOSE_TEMPLATE = _read_template("docker-compose.template.yml")

# ---------------------------------------------------------------------------
# Exact homelab-alpha network block examples injected into the compose prompt
# Source: https://homelab-alpha.nl/docker/network-info/bridge-network-setup/
#         https://homelab-alpha.nl/docker/network-info/macvlan-network-setup/
# ---------------------------------------------------------------------------

_BRIDGE_NETWORK_BLOCK = """\
networks:
  <APP_NAME>_net:
    attachable: false   # true = standalone containers can attach manually
    internal: false     # true = no internet access (fully isolated)
    external: false     # true = network is managed outside this Compose file
    name: <APP_NAME>
    driver: bridge
    ipam:
      driver: default
      config:
        - subnet: 172.20.0.0/24    # Subnet in CIDR format
          ip_range: 172.20.0.0/24  # Range from which container IPs are allocated
          gateway: 172.20.0.1      # Gateway for the subnet
          # aux_addresses:          # Reserve IPs for non-container hosts
          #   host1: 172.20.0.2
    driver_opts:
      com.docker.network.bridge.default_bridge: "false"
      com.docker.network.bridge.enable_icc: "true"           # inter-container communication
      com.docker.network.bridge.enable_ip_masquerade: "true" # NAT / internet access
      com.docker.network.bridge.host_binding_ipv4: "0.0.0.0"
      com.docker.network.bridge.name: "<APP_NAME>"
      com.docker.network.driver.mtu: "1500"
    labels:
      com.<APP_NAME>.network.description: "is an isolated bridge network."
"""

_MACVLAN_NETWORK_BLOCK = """\
networks:
  <APP_NAME>_net:
    attachable: true    # Allow manual: docker network connect
    internal: false     # Allow internet access
    external: false
    name: <APP_NAME>
    driver: macvlan
    ipam:
      driver: default
      config:
        - subnet: 192.168.1.0/24     # Must match the physical LAN subnet
          ip_range: 192.168.1.128/25  # Reserve upper half for containers
          gateway: 192.168.1.1        # LAN gateway / router IP
          aux_addresses:              # IPs Docker will NOT assign to containers
            host: 192.168.1.254       # Reserve the Docker host IP to avoid conflict
    driver_opts:
      parent: eno1                    # Physical NIC — run `ip a` to find yours
      ipv6: "false"
    labels:
      com.<APP_NAME>.network.description: "is a non-isolated macvlan network."

# --- How to find the parent interface ---
# Run: ip a
# Look for the active interface connected to your LAN (e.g. eno1, eth0, ens33).
# Replace `eno1` above with your interface name.
#
# --- Host → container traffic ---
# The Docker host cannot reach macvlan containers by default.
# To enable this, create a macvlan shim interface on the host:
#   sudo ip link add macvlan0 link eno1 type macvlan mode bridge
#   sudo ip addr add 192.168.1.253/24 dev macvlan0
#   sudo ip link set macvlan0 up
"""

_NETWORK_GUIDANCE = {
    "bridge": (
        "bridge",
        "Use the BRIDGE network block below (homelab-alpha convention). "
        "Containers share an isolated virtual network and reach the internet via NAT. "
        "Assign each service a static ipv4_address within the subnet. "
        "Do NOT include the macvlan block.",
        _BRIDGE_NETWORK_BLOCK,
    ),
    "macvlan": (
        "macvlan",
        "Use the MACVLAN network block below (homelab-alpha convention). "
        "Each container appears as an independent device on the physical LAN with its own MAC address. "
        "Assign each service a static ipv4_address within the ip_range. "
        "Include the host shim interface instructions as comments. "
        "Do NOT include the bridge block. "
        "Because macvlan containers have real LAN IPs, the `ports:` mapping is optional — "
        "services are directly reachable by their container IP on the LAN.",
        _MACVLAN_NETWORK_BLOCK,
    ),
}

# ---------------------------------------------------------------------------
# Context helpers
# ---------------------------------------------------------------------------

def _build_context_summary(context: dict) -> str:
    """Convert a context dict into a human-readable summary for prompts."""
    lines: list[str] = []

    language = context.get("language") or "Unknown"
    framework = context.get("framework")
    lines.append(f"Language: {language}")
    if framework:
        lines.append(f"Framework: {framework}")

    build_tool = context.get("build_tool")
    if build_tool:
        lines.append(f"Build tool: {build_tool}")

    runtime_versions = context.get("runtime_versions") or {}
    if runtime_versions:
        versions_str = ", ".join(f"{k} {v}" for k, v in runtime_versions.items())
        lines.append(f"Runtime versions: {versions_str}")

    ports = context.get("detected_ports") or []
    if ports:
        lines.append(f"Detected application ports: {', '.join(str(p) for p in ports)}")

    dependencies = context.get("dependencies") or ""
    if dependencies:
        lines.append(f"\nDependency manifests (excerpts):\n{dependencies[:1500]}")

    existing = context.get("existing_docker_files") or {}
    if existing:
        names = ", ".join(existing.keys())
        lines.append(f"\nExisting Docker files found (for reference, do NOT copy blindly): {names}")
        for name, content in list(existing.items())[:1]:
            lines.append(f"\n--- {name} (existing, reference only) ---\n{content[:800]}")

    repo_url = context.get("repo_url") or ""
    if repo_url and repo_url != (context.get("language") or ""):
        lines.append(f"\nRepository: {repo_url}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_DOCKERFILE_PROMPT = """\
You are an expert Docker engineer. Generate a production-ready Dockerfile for the project described below.

=== PROJECT CONTEXT ===
{context_summary}

=== BASE TEMPLATE ===
Use the following template as your structural starting point. Fill in every \
<PLACEHOLDER> with the correct value for this project. Remove stages or \
instructions that do not apply. Add language-specific best-practice steps \
as needed.

{dockerfile_template}

=== REQUIREMENTS ===
- Use a multi-stage build (builder + runtime) wherever a build/compile step exists.
- Choose an official, minimal base image (e.g. *-slim, *-alpine) appropriate for the language and version.
- Pin the base image version — do NOT use `latest`.
- Install only the minimum system packages needed; clean up package manager caches in the same RUN layer.
- Copy dependency manifests before source code to maximise layer caching.
- Run the application as a non-root user.
- Add a HEALTHCHECK instruction appropriate for the application.
- Use EXPOSE to document the listening port.
- Use ENTRYPOINT + CMD correctly (ENTRYPOINT for the executable, CMD for overridable args).
- Follow Docker best practices for layer ordering and caching.

=== OUTPUT FORMAT ===
Return ONLY the raw Dockerfile content between these two separator lines and nothing else:
---DOCKERFILE_START---
<Dockerfile content here>
---DOCKERFILE_END---
"""

_COMPOSE_PROMPT = """\
You are an expert Docker Compose engineer. Generate a production-ready docker-compose.yml for the project described below.

=== PROJECT CONTEXT ===
{context_summary}

=== NETWORK TYPE: {network_label} ===
{network_guidance}

=== NETWORK BLOCK (homelab-alpha convention) ===
Place this block verbatim at the bottom of the file, substituting <APP_NAME> \
with the actual application name throughout:

{network_block}

=== BASE TEMPLATE ===
Use the following template as your structural starting point. Fill in every \
<PLACEHOLDER> with the correct value for this project. Remove commented-out \
optional services if they are clearly not needed. Replace the network section \
with the homelab-alpha network block above.

{compose_template}

=== REQUIREMENTS ===
- Use `name:` at the top for the Compose project name.
- Set `restart: unless-stopped` on all services.
- Use `logging:` with driver json-file, max-size 1M, max-file 2 on every service.
- Set `stop_grace_period: 1m` on every service.
- Set `pull_policy: if_not_present` on every service.
- Use `security_opt: [no-new-privileges:true]` on every service.
- Assign a static `ipv4_address` from the subnet to every service in the network block.
- Pass secrets and credentials via environment variables sourced from a `.env` file \
  and optionally a `stack.env` file (Portainer compatibility).
- Set PUID/PGID (default 1000) and TZ environment variables on every service.
- Add a `healthcheck:` block with start_interval to every service.
- If the project uses a database or cache, include the appropriate optional service \
  with a healthcheck.
- Add `labels:` with a `com.<app_name>.<service>.description` key to every service.
- If the application needs to be built from source, use the `build:` key; \
  otherwise specify an `image:`.
- Map the correct application port(s) from EXPOSE to the host (use long-form `ports:` with target/published/protocol).
- Use external named volumes (external: true) for persistent data.

=== OUTPUT FORMAT ===
Return ONLY the raw docker-compose.yml content between these two separator lines and nothing else:
---COMPOSE_START---
<docker-compose.yml content here>
---COMPOSE_END---
"""

# ---------------------------------------------------------------------------
# Extraction helpers
# ---------------------------------------------------------------------------

def _extract_between(text: str, start_marker: str, end_marker: str) -> str:
    """Extract content between start_marker and end_marker lines."""
    if start_marker in text and end_marker in text:
        start_idx = text.index(start_marker) + len(start_marker)
        end_idx = text.index(end_marker, start_idx)
        return text[start_idx:end_idx].strip()

    # Fallback: strip common markdown fences
    lines = text.strip().splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_dockerfile(context: dict, provider_name: str) -> str:
    """
    Generate a Dockerfile for the given *context* using *provider_name*.

    Parameters
    ----------
    context : dict
        Keys used: language, framework, build_tool, runtime_versions,
        detected_ports, dependencies, existing_docker_files, repo_url.
        At minimum, supply {"language": "<language>"}.
    provider_name : str
        One of the names returned by ai_providers.available_providers().

    Returns
    -------
    str
        Raw Dockerfile content.
    """
    context_summary = _build_context_summary(context)
    prompt = _DOCKERFILE_PROMPT.format(
        context_summary=context_summary,
        dockerfile_template=_DOCKERFILE_TEMPLATE,
    )
    raw = ai_generate(provider_name, prompt)
    return _extract_between(raw, "---DOCKERFILE_START---", "---DOCKERFILE_END---")


def generate_docker_compose(
    context: dict,
    provider_name: str,
    network_type: str = "bridge",
) -> str:
    """
    Generate a docker-compose.yml for the given *context* using *provider_name*.

    Parameters
    ----------
    context : dict
        Same shape as for generate_dockerfile().
    provider_name : str
        One of the names returned by ai_providers.available_providers().
    network_type : str
        "bridge"  — isolated bridge network (NAT, default).
                    Best for most containerised workloads.
        "macvlan" — containers appear as physical LAN devices with own MAC
                    addresses.  Best for homelab services needing a real LAN IP.

    Returns
    -------
    str
        Raw docker-compose.yml content.
    """
    net_key = network_type.lower()
    if net_key not in _NETWORK_GUIDANCE:
        net_key = "bridge"

    network_label, network_guidance, network_block = _NETWORK_GUIDANCE[net_key]

    context_summary = _build_context_summary(context)
    prompt = _COMPOSE_PROMPT.format(
        context_summary=context_summary,
        network_label=network_label,
        network_guidance=network_guidance,
        network_block=network_block,
        compose_template=_COMPOSE_TEMPLATE,
    )
    raw = ai_generate(provider_name, prompt)
    return _extract_between(raw, "---COMPOSE_START---", "---COMPOSE_END---")


# ---------------------------------------------------------------------------
# CLI entry-point (kept for backward compatibility)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    from ai_providers import available_providers

    providers = available_providers()
    if not providers:
        print("❌ No AI provider configured. Set at least one API key in your .env file.")
        raise SystemExit(1)

    provider = providers[0]
    print(f"Using provider: {provider}")

    language = input("Enter the programming language or framework: ").strip()
    if not language:
        print("⚠️ Input cannot be empty.")
        raise SystemExit(1)

    context = {"language": language}
    print("\n--- Dockerfile ---")
    print(generate_dockerfile(context, provider))
    print("\n--- docker-compose.yml ---")
    print(generate_docker_compose(context, provider))