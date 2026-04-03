"""
ai_providers.py — Unified multi-provider AI interface for Dockerfile generation.

Each provider exposes a single function:
    generate(prompt: str, **kwargs) -> str

Available providers (shown only if the required env var is set):
    - Cohere      (COHERE_API_KEY)
    - OpenAI      (OPENAI_API_KEY)
    - Gemini      (GOOGLE_API_KEY)
    - Anthropic   (ANTHROPIC_API_KEY)
    - Ollama      (no key needed — local server)
"""

import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Provider names (used as dict keys and UI labels)
# ---------------------------------------------------------------------------
COHERE = "Cohere (command-r-plus)"
OPENAI = "OpenAI (GPT-4o)"
GEMINI = "Google Gemini (1.5 Pro)"
ANTHROPIC = "Anthropic Claude (3.5 Sonnet)"
OLLAMA = "Ollama (local)"


def _cohere_generate(prompt: str) -> str:
    import cohere  # type: ignore[import-untyped]

    api_key = os.getenv("COHERE_API_KEY")
    if not api_key:
        raise ValueError("COHERE_API_KEY is not set.")
    co = cohere.Client(api_key)
    response = co.generate(
        model="command-r-plus",
        prompt=prompt,
        max_tokens=2000,
        temperature=0.4,
    )
    return response.generations[0].text.strip()


def _openai_generate(prompt: str) -> str:
    from openai import OpenAI  # type: ignore[import-untyped]

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set.")
    client = OpenAI(api_key=api_key)
    model = os.getenv("OPENAI_MODEL", "gpt-4o")
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2000,
        temperature=0.4,
    )
    return response.choices[0].message.content.strip()


def _gemini_generate(prompt: str) -> str:
    import google.generativeai as genai  # type: ignore[import-untyped]

    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY is not set.")
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-pro")
    response = model.generate_content(prompt)
    return response.text.strip()


def _anthropic_generate(prompt: str) -> str:
    import anthropic  # type: ignore[import-untyped]

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is not set.")
    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-3-5-sonnet-latest",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()


def _ollama_generate(prompt: str) -> str:
    model = os.getenv("OLLAMA_MODEL", "llama3")
    base_url = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    url = f"{base_url}/api/generate"
    payload = {"model": model, "prompt": prompt, "stream": False}
    try:
        resp = requests.post(url, json=payload, timeout=300)
        resp.raise_for_status()
        return resp.json().get("response", "").strip()
    except requests.exceptions.ConnectionError:
        raise ConnectionError(
            f"Cannot connect to Ollama at {base_url}. "
            "Make sure the Ollama server is running and accessible."
        )


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
_PROVIDERS = {
    COHERE: ("COHERE_API_KEY", _cohere_generate),
    OPENAI: ("OPENAI_API_KEY", _openai_generate),
    GEMINI: ("GOOGLE_API_KEY", _gemini_generate),
    ANTHROPIC: ("ANTHROPIC_API_KEY", _anthropic_generate),
    OLLAMA: (None, _ollama_generate),  # no key required
}


def available_providers() -> list[str]:
    """Return provider names whose API key is configured (Ollama always included)."""
    result: list[str] = []
    for name, (env_var, _) in _PROVIDERS.items():
        if env_var is None or os.getenv(env_var):
            result.append(name)
    return result


def generate(provider_name: str, prompt: str) -> str:
    """
    Call the named provider with *prompt* and return the generated text.

    Raises:
        ValueError  — unknown provider name or missing API key.
        Exception   — provider-specific errors (network, quota, etc.).
    """
    if provider_name not in _PROVIDERS:
        raise ValueError(
            f"Unknown provider '{provider_name}'. "
            f"Available: {list(_PROVIDERS.keys())}"
        )
    _, fn = _PROVIDERS[provider_name]
    return fn(prompt)
