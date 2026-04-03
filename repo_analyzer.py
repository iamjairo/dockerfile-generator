"""
repo_analyzer.py — GitHub repository analysis for Dockerfile generation.

Accepts a GitHub repo URL (HTTPS or owner/repo shorthand), shallow-clones it
to a temporary directory, walks the tree to collect signals (manifest files,
runtime hints, existing Dockerfiles, exposed ports), then returns a structured
context dict ready for use in AI prompts.
"""

import os
import re
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Manifest / hint file names that reveal the language or runtime
# ---------------------------------------------------------------------------
MANIFEST_FILES = {
    "package.json": "Node.js",
    "package-lock.json": "Node.js",
    "yarn.lock": "Node.js",
    "pnpm-lock.yaml": "Node.js",
    "requirements.txt": "Python",
    "Pipfile": "Python",
    "Pipfile.lock": "Python",
    "pyproject.toml": "Python",
    "setup.py": "Python",
    "setup.cfg": "Python",
    "pom.xml": "Java (Maven)",
    "build.gradle": "Java (Gradle)",
    "build.gradle.kts": "Java (Gradle)",
    "Cargo.toml": "Rust",
    "go.mod": "Go",
    "composer.json": "PHP",
    "Gemfile": "Ruby",
    "Gemfile.lock": "Ruby",
    "mix.exs": "Elixir",
    "*.csproj": "C# (.NET)",
    "*.fsproj": "F# (.NET)",
    "*.vbproj": "VB.NET",
    "global.json": "C# (.NET)",
    "CMakeLists.txt": "C/C++",
    "Makefile": "C/C++",
    "pubspec.yaml": "Dart/Flutter",
    "build.sbt": "Scala (SBT)",
}

RUNTIME_HINT_FILES = {
    ".nvmrc": "Node.js version",
    ".node-version": "Node.js version",
    ".python-version": "Python version",
    ".ruby-version": "Ruby version",
    ".tool-versions": "ASDF multi-runtime versions",
}

# Port patterns: look for common ways applications expose ports in source files
PORT_PATTERNS = [
    r"(?:PORT|port)\s*[=:]\s*(\d{2,5})",
    r"\.listen\s*\(\s*(\d{2,5})",
    r"app\.run\s*\([^)]*port\s*=\s*(\d{2,5})",
    r"EXPOSE\s+(\d{2,5})",
    r'"port"\s*:\s*(\d{2,5})',
    r"server_port\s*=\s*(\d{2,5})",
]

# Source file extensions to scan for port hints
SOURCE_EXTENSIONS = {
    ".js", ".ts", ".py", ".go", ".java", ".rb", ".php",
    ".cs", ".rs", ".ex", ".exs", ".scala", ".kt",
}

# Maximum number of source files to scan for ports (keep analysis fast)
MAX_PORT_SCAN_FILES = 50


def _normalize_github_url(url: str) -> str:
    """
    Convert any of the following into a clonable HTTPS URL:
      - https://github.com/owner/repo
      - https://github.com/owner/repo.git
      - http://github.com/owner/repo
      - github.com/owner/repo
      - owner/repo
      - gh:owner/repo
    """
    url = url.strip()

    # Already a full HTTPS URL
    if re.match(r"https?://github\.com/", url, re.IGNORECASE):
        if not url.endswith(".git"):
            url = url.rstrip("/") + ".git"
        return url

    # github.com/owner/repo (no scheme)
    if re.match(r"github\.com/", url, re.IGNORECASE):
        url = "https://" + url
        if not url.endswith(".git"):
            url = url.rstrip("/") + ".git"
        return url

    # gh:owner/repo shorthand (GitHub CLI style)
    if url.startswith("gh:"):
        url = url[3:]

    # owner/repo shorthand (bare) — GitHub names: alphanumeric, hyphens, dots, underscores
    if re.match(r"^[a-zA-Z0-9_.\-]+/[a-zA-Z0-9_.\-]+$", url):
        return f"https://github.com/{url}.git"

    raise ValueError(
        f"Cannot parse '{url}' as a GitHub repository URL.\n"
        "Accepted formats: https://github.com/owner/repo, owner/repo, gh:owner/repo"
    )


def _find_files_glob(root: Path, pattern: str):
    """Return all files matching *pattern* (glob) under *root*."""
    return list(root.rglob(pattern))


def _detect_framework(manifest_content: dict[str, str]) -> str | None:
    """
    Given the raw text content of detected manifest files, try to identify
    a specific framework (e.g. Django, Flask, Express, Spring Boot).
    """
    frameworks = []

    pkg_json = manifest_content.get("package.json", "")
    if pkg_json:
        try:
            pkg = json.loads(pkg_json)
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        except json.JSONDecodeError:
            deps = {}
        if "next" in deps:
            frameworks.append("Next.js")
        elif "nuxt" in deps:
            frameworks.append("Nuxt.js")
        elif "react" in deps:
            frameworks.append("React")
        elif "vue" in deps:
            frameworks.append("Vue.js")
        elif "svelte" in deps:
            frameworks.append("Svelte")
        elif "express" in deps:
            frameworks.append("Express.js")
        elif "fastify" in deps:
            frameworks.append("Fastify")
        elif "nestjs" in deps or "@nestjs/core" in deps:
            frameworks.append("NestJS")
        elif "angular" in deps or "@angular/core" in deps:
            frameworks.append("Angular")

    reqs = manifest_content.get("requirements.txt", "")
    if reqs:
        reqs_lower = reqs.lower()
        if "django" in reqs_lower:
            frameworks.append("Django")
        elif "flask" in reqs_lower:
            frameworks.append("Flask")
        elif "fastapi" in reqs_lower:
            frameworks.append("FastAPI")
        elif "tornado" in reqs_lower:
            frameworks.append("Tornado")
        elif "starlette" in reqs_lower:
            frameworks.append("Starlette")

    pyproject = manifest_content.get("pyproject.toml", "")
    if pyproject:
        pp_lower = pyproject.lower()
        if "django" in pp_lower:
            frameworks.append("Django")
        elif "flask" in pp_lower:
            frameworks.append("Flask")
        elif "fastapi" in pp_lower:
            frameworks.append("FastAPI")

    pom = manifest_content.get("pom.xml", "")
    if pom:
        if "spring-boot" in pom.lower():
            frameworks.append("Spring Boot")
        elif "quarkus" in pom.lower():
            frameworks.append("Quarkus")
        elif "micronaut" in pom.lower():
            frameworks.append("Micronaut")

    return frameworks[0] if frameworks else None


def _detect_ports(root: Path) -> list[int]:
    """Scan source files for common port-binding patterns."""
    found_ports: set[int] = set()
    scanned = 0

    for ext in SOURCE_EXTENSIONS:
        if scanned >= MAX_PORT_SCAN_FILES:
            break
        for fpath in root.rglob(f"*{ext}"):
            if scanned >= MAX_PORT_SCAN_FILES:
                break
            # Skip node_modules, .git, vendor directories
            parts = fpath.parts
            if any(p in parts for p in ("node_modules", ".git", "vendor", "target", "dist", "build", "__pycache__")):
                continue
            try:
                text = fpath.read_text(encoding="utf-8", errors="ignore")
                for pattern in PORT_PATTERNS:
                    for match in re.finditer(pattern, text):
                        port = int(match.group(1))
                        if 1 <= port <= 65535:  # include all valid port numbers
                            found_ports.add(port)
            except OSError:
                pass
            scanned += 1

    # Also check common config files
    for config_name in ("docker-compose.yml", "docker-compose.yaml", ".env.example", ".env.sample"):
        config_path = root / config_name
        if config_path.exists():
            try:
                text = config_path.read_text(encoding="utf-8", errors="ignore")
                for pattern in PORT_PATTERNS:
                    for match in re.finditer(pattern, text):
                        port = int(match.group(1))
                        if 1 <= port <= 65535:  # include all valid port numbers
                            found_ports.add(port)
            except OSError:
                pass

    return sorted(found_ports)


def _read_runtime_versions(root: Path) -> dict[str, str]:
    """Read runtime version pins from hint files."""
    versions: dict[str, str] = {}

    nvmrc = root / ".nvmrc"
    if nvmrc.exists():
        try:
            versions["node"] = nvmrc.read_text().strip().lstrip("v")
        except OSError:
            pass

    node_version = root / ".node-version"
    if node_version.exists() and "node" not in versions:
        try:
            versions["node"] = node_version.read_text().strip().lstrip("v")
        except OSError:
            pass

    python_version = root / ".python-version"
    if python_version.exists():
        try:
            versions["python"] = python_version.read_text().strip()
        except OSError:
            pass

    ruby_version = root / ".ruby-version"
    if ruby_version.exists():
        try:
            versions["ruby"] = ruby_version.read_text().strip().lstrip("v")
        except OSError:
            pass

    tool_versions = root / ".tool-versions"
    if tool_versions.exists():
        try:
            for line in tool_versions.read_text().splitlines():
                parts = line.split()
                if len(parts) == 2:
                    versions[parts[0]] = parts[1]
        except OSError:
            pass

    return versions


def _check_existing_docker_files(root: Path) -> dict[str, str]:
    """Collect any existing Dockerfile / docker-compose content for reference."""
    result: dict[str, str] = {}
    for name in ("Dockerfile", "Dockerfile.prod", "Dockerfile.dev", "docker-compose.yml", "docker-compose.yaml"):
        fpath = root / name
        if fpath.exists():
            try:
                content = fpath.read_text(encoding="utf-8", errors="ignore")
                result[name] = content[:3000]  # limit size
            except OSError:
                pass
    return result


def analyze_repo(url_or_shorthand: str) -> dict:
    """
    Clone *url_or_shorthand* and analyse it, returning a context dict:

    {
        "repo_url": str,
        "language": str | None,
        "framework": str | None,
        "runtime_versions": {runtime: version, ...},
        "dependencies": str,          # raw manifest content snippet
        "detected_ports": [int, ...],
        "build_tool": str | None,
        "manifests_found": [str, ...],
        "existing_docker_files": {name: content, ...},
        "error": str | None,
    }
    """
    context: dict = {
        "repo_url": url_or_shorthand,
        "language": None,
        "framework": None,
        "runtime_versions": {},
        "dependencies": "",
        "detected_ports": [],
        "build_tool": None,
        "manifests_found": [],
        "existing_docker_files": {},
        "error": None,
    }

    try:
        clone_url = _normalize_github_url(url_or_shorthand)
        context["repo_url"] = clone_url.replace(".git", "")
    except ValueError as exc:
        context["error"] = str(exc)
        return context

    tmp_dir = tempfile.mkdtemp(prefix="dfgen_")
    try:
        # Shallow clone (depth 1) — fast and enough for analysis
        result = subprocess.run(
            ["git", "clone", "--depth", "1", "--quiet", clone_url, tmp_dir],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            err = result.stderr.strip()
            if "Repository not found" in err or "does not exist" in err:
                context["error"] = (
                    "Repository not found. Make sure the URL is correct and the repo is public."
                )
            elif "Authentication failed" in err:
                context["error"] = (
                    "Authentication failed. Only public repositories are supported without credentials."
                )
            else:
                context["error"] = f"git clone failed: {err or 'unknown error'}"
            return context

        root = Path(tmp_dir)

        # --- Detect manifests ---
        manifest_content: dict[str, str] = {}
        detected_language: str | None = None
        manifests_found: list[str] = []

        for manifest_name, lang in MANIFEST_FILES.items():
            if "*" in manifest_name:
                # glob pattern (e.g. *.csproj)
                matches = _find_files_glob(root, manifest_name)
                if matches:
                    manifests_found.append(manifest_name)
                    if detected_language is None:
                        detected_language = lang
                    try:
                        manifest_content[manifest_name.replace("*", "matched")] = matches[0].read_text(
                            encoding="utf-8", errors="ignore"
                        )[:2000]
                    except OSError:
                        pass
            else:
                fpath = root / manifest_name
                if fpath.exists():
                    manifests_found.append(manifest_name)
                    if detected_language is None:
                        detected_language = lang
                    try:
                        manifest_content[manifest_name] = fpath.read_text(
                            encoding="utf-8", errors="ignore"
                        )[:2000]
                    except OSError:
                        pass

        context["language"] = detected_language
        context["manifests_found"] = manifests_found

        # --- Detect framework ---
        context["framework"] = _detect_framework(manifest_content)

        # --- Build tool ---
        if "pom.xml" in manifests_found:
            context["build_tool"] = "Maven"
        elif "build.gradle" in manifests_found or "build.gradle.kts" in manifests_found:
            context["build_tool"] = "Gradle"
        elif "build.sbt" in manifests_found:
            context["build_tool"] = "SBT"
        elif "Cargo.toml" in manifests_found:
            context["build_tool"] = "Cargo"
        elif "go.mod" in manifests_found:
            context["build_tool"] = "Go modules"
        elif "package.json" in manifests_found:
            # Detect yarn vs npm vs pnpm
            if (root / "yarn.lock").exists():
                context["build_tool"] = "Yarn"
            elif (root / "pnpm-lock.yaml").exists():
                context["build_tool"] = "pnpm"
            else:
                context["build_tool"] = "npm"

        # --- Collate dependencies snippet for the prompt ---
        dep_lines: list[str] = []
        for key in ("requirements.txt", "package.json", "go.mod", "Cargo.toml",
                    "Gemfile", "composer.json", "Pipfile", "pyproject.toml", "pom.xml"):
            if key in manifest_content:
                snippet = manifest_content[key][:800]
                dep_lines.append(f"=== {key} ===\n{snippet}")
        context["dependencies"] = "\n\n".join(dep_lines) if dep_lines else ""

        # --- Runtime versions ---
        context["runtime_versions"] = _read_runtime_versions(root)

        # --- Detected ports ---
        context["detected_ports"] = _detect_ports(root)

        # --- Existing Docker files (reference only) ---
        context["existing_docker_files"] = _check_existing_docker_files(root)

    except subprocess.TimeoutExpired:
        context["error"] = "Repository clone timed out (120 s). Try again or use a smaller repo."
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        context["error"] = f"Error during repository analysis: {exc}"
    except Exception as exc:  # noqa: BLE001 — catch-all for truly unexpected errors
        context["error"] = f"Unexpected error during analysis: {exc}"
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return context
