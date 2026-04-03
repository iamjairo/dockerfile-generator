"""
generate_dockerfile.py — Context-aware Dockerfile and docker-compose generation.

Public API
----------
generate_dockerfile(context: dict, provider_name: str) -> str
generate_docker_compose(context: dict, provider_name: str) -> str

*context* is either:
  - The dict returned by repo_analyzer.analyze_repo(), or
  - A minimal dict with at least {"language": "<language or framework name>"}
    when the user typed a language directly.
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

=== BASE TEMPLATE ===
Use the following template as your structural starting point. Fill in every \
<PLACEHOLDER> with the correct value for this project. Remove commented-out \
optional services if they are clearly not needed. Keep the named network block \
at the bottom.

{compose_template}

=== REQUIREMENTS ===
- Use `name:` at the top for the Compose project name.
- Set `restart: unless-stopped` on all services.
- Use named volumes (not bare bind-mounts) for all persistent data.
- Pass secrets and credentials via environment variables sourced from a `.env` file.
- Add a `healthcheck:` block to every service.
- Include `deploy.resources` limits for production readiness.
- Define a single named bridge network at the bottom (homelab-alpha convention).
- If the project uses a database or cache, include the appropriate optional service.
- Add meaningful `labels:` metadata.
- If the application needs to be built from source, use the `build:` key; \
  otherwise specify an `image:`.
- Map the correct application port(s) from EXPOSE to the host.

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


def generate_docker_compose(context: dict, provider_name: str) -> str:
    """
    Generate a docker-compose.yml for the given *context* using *provider_name*.

    Parameters
    ----------
    context : dict
        Same shape as for generate_dockerfile().
    provider_name : str
        One of the names returned by ai_providers.available_providers().

    Returns
    -------
    str
        Raw docker-compose.yml content.
    """
    context_summary = _build_context_summary(context)
    prompt = _COMPOSE_PROMPT.format(
        context_summary=context_summary,
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