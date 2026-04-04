import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RepoContext {
  mode: "github" | "language";
  language?: string;
  framework?: string;
  build_tool?: string;
  runtime_versions?: Record<string, string>;
  detected_ports?: number[];
  dependencies?: string;
  existing_docker_files?: Record<string, string>;
  repo_url?: string;
  manifests_found?: string[];
  error?: string;
}

interface ApiKeys {
  openai?: string;
  google?: string;
  cohere?: string;
  ollama_host?: string;
  ollama_model?: string;
  github_token?: string;
}

// ---------------------------------------------------------------------------
// Network blocks (homelab-alpha conventions)
// ---------------------------------------------------------------------------
const BRIDGE_NETWORK_BLOCK = `
networks:
  <APP_NAME>_net:
    attachable: false
    internal: false
    external: false
    name: <APP_NAME>
    driver: bridge
    ipam:
      driver: default
      config:
        - subnet: 172.20.0.0/24
          ip_range: 172.20.0.0/24
          gateway: 172.20.0.1
    driver_opts:
      com.docker.network.bridge.default_bridge: "false"
      com.docker.network.bridge.enable_icc: "true"
      com.docker.network.bridge.enable_ip_masquerade: "true"
      com.docker.network.bridge.host_binding_ipv4: "0.0.0.0"
      com.docker.network.bridge.name: "<APP_NAME>"
      com.docker.network.driver.mtu: "1500"
    labels:
      com.<APP_NAME>.network.description: "is an isolated bridge network."
`;

const MACVLAN_NETWORK_BLOCK = `
networks:
  <APP_NAME>_net:
    attachable: true
    internal: false
    external: false
    name: <APP_NAME>
    driver: macvlan
    ipam:
      driver: default
      config:
        - subnet: 192.168.1.0/24
          ip_range: 192.168.1.128/25
          gateway: 192.168.1.1
          aux_addresses:
            host: 192.168.1.254
    driver_opts:
      parent: eno1
      ipv6: "false"
    labels:
      com.<APP_NAME>.network.description: "is a non-isolated macvlan network."

# --- How to find the parent interface ---
# Run: ip a
# Look for the active interface connected to your LAN (e.g. eno1, eth0, ens33).
# Replace 'eno1' above with your interface name.
#
# --- Host to container traffic ---
# The Docker host cannot reach macvlan containers by default.
# To enable this, create a macvlan shim on the host:
#   sudo ip link add macvlan0 link eno1 type macvlan mode bridge
#   sudo ip addr add 192.168.1.253/24 dev macvlan0
#   sudo ip link set macvlan0 up
`;

const NETWORK_GUIDANCE: Record<string, { label: string; guidance: string; block: string }> = {
  bridge: {
    label: "bridge",
    guidance:
      "Use the BRIDGE network block below (homelab-alpha convention). " +
      "Containers share an isolated virtual network and reach the internet via NAT. " +
      "Assign each service a static ipv4_address within the subnet. " +
      "Do NOT include the macvlan block.",
    block: BRIDGE_NETWORK_BLOCK,
  },
  macvlan: {
    label: "macvlan",
    guidance:
      "Use the MACVLAN network block below (homelab-alpha convention). " +
      "Each container appears as an independent device on the physical LAN with its own MAC address. " +
      "Assign each service a static ipv4_address within the ip_range. " +
      "Include the host shim interface instructions as comments. " +
      "Do NOT include the bridge block. " +
      "Because macvlan containers have real LAN IPs, the ports: mapping is optional — " +
      "services are directly reachable by their container IP on the LAN.",
    block: MACVLAN_NETWORK_BLOCK,
  },
};

// ---------------------------------------------------------------------------
// GitHub repo analysis
// ---------------------------------------------------------------------------
const MANIFEST_FILES = [
  "package.json", "requirements.txt", "Pipfile", "pyproject.toml",
  "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "Gemfile",
  "composer.json", "setup.py", "setup.cfg", "mix.exs", "build.sbt",
];
const DOCKER_FILES = ["Dockerfile", "Dockerfile.prod", "docker-compose.yml", "docker-compose.yaml"];
const VERSION_FILES = [".nvmrc", ".python-version", ".node-version", ".tool-versions"];
const PORT_PATTERNS = [
  /(?:PORT|port)\s*[=:]\s*(\d{2,5})/g,
  /\.listen\s*\(\s*(\d{2,5})/g,
  /app\.run\s*\([^)]*port\s*=\s*(\d{2,5})/g,
  /EXPOSE\s+(\d{2,5})/g,
  /"port"\s*:\s*(\d{2,5})/g,
];

function normalizeGitHubUrl(url: string): string {
  url = url.trim();
  const ghFull = url.match(/(?:https?:\/\/)?github\.com\/([\w.\-]+\/[\w.\-]+)/);
  if (ghFull) return ghFull[1].replace(/\.git$/, "");
  if (url.startsWith("gh:")) url = url.slice(3);
  if (/^[\w.\-]+\/[\w.\-]+$/.test(url)) return url;
  throw new Error(`Cannot parse '${url}' as a GitHub repository URL. Use https://github.com/owner/repo or owner/repo.`);
}

function detectFramework(contents: Record<string, string>): string | undefined {
  const pkg = contents["package.json"];
  if (pkg) {
    try {
      const p = JSON.parse(pkg);
      const deps = { ...p.dependencies, ...p.devDependencies };
      if (deps["next"]) return "Next.js";
      if (deps["nuxt"]) return "Nuxt.js";
      if (deps["react"]) return "React";
      if (deps["vue"]) return "Vue.js";
      if (deps["svelte"]) return "Svelte";
      if (deps["express"]) return "Express.js";
      if (deps["fastify"]) return "Fastify";
      if (deps["@nestjs/core"]) return "NestJS";
      if (deps["@angular/core"]) return "Angular";
    } catch {}
  }
  const reqs = (contents["requirements.txt"] || "").toLowerCase();
  const pp = (contents["pyproject.toml"] || "").toLowerCase();
  const combined = reqs + pp;
  if (combined.includes("django")) return "Django";
  if (combined.includes("fastapi")) return "FastAPI";
  if (combined.includes("flask")) return "Flask";
  if (combined.includes("tornado")) return "Tornado";
  if (combined.includes("starlette")) return "Starlette";
  const pom = (contents["pom.xml"] || "").toLowerCase();
  if (pom.includes("spring-boot")) return "Spring Boot";
  if (pom.includes("quarkus")) return "Quarkus";
  return undefined;
}

function detectBuildTool(contents: Record<string, string>, files: string[]): string | undefined {
  if (contents["pom.xml"]) return "Maven";
  if (contents["build.gradle"]) return "Gradle";
  if (contents["build.sbt"]) return "SBT";
  if (contents["Cargo.toml"]) return "Cargo";
  if (contents["go.mod"]) return "Go modules";
  if (contents["package.json"]) {
    if (files.includes("yarn.lock")) return "Yarn";
    if (files.includes("pnpm-lock.yaml")) return "pnpm";
    return "npm";
  }
  return undefined;
}

function detectRuntimeVersions(contents: Record<string, string>): Record<string, string> {
  const versions: Record<string, string> = {};
  if (contents[".nvmrc"]) versions["node"] = contents[".nvmrc"].trim().replace(/^v/, "");
  if (contents[".node-version"]) versions["node"] = contents[".node-version"].trim().replace(/^v/, "");
  if (contents[".python-version"]) versions["python"] = contents[".python-version"].trim();
  if (contents[".tool-versions"]) {
    for (const line of contents[".tool-versions"].split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 2) versions[parts[0]] = parts[1];
    }
  }
  return versions;
}

function detectPorts(contents: Record<string, string>): number[] {
  const ports = new Set<number>();
  for (const text of Object.values(contents)) {
    for (const pattern of PORT_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        const p = parseInt(m[1]);
        if (p >= 1 && p <= 65535) ports.add(p);
      }
    }
  }
  return Array.from(ports).sort((a, b) => a - b);
}

async function analyzeGitHubRepo(urlOrShorthand: string, githubToken?: string): Promise<RepoContext> {
  const ctx: RepoContext = { mode: "github" };
  let ownerRepo: string;
  try {
    ownerRepo = normalizeGitHubUrl(urlOrShorthand);
  } catch (e) {
    ctx.error = (e as Error).message;
    return ctx;
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "dockerfile-generator/2.0",
  };
  if (githubToken) headers["Authorization"] = `token ${githubToken}`;

  const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`, { headers });
  if (!repoRes.ok) {
    ctx.error = repoRes.status === 404
      ? "Repository not found. Make sure the URL is correct and the repo is public."
      : `GitHub API error: ${repoRes.status} ${repoRes.statusText}`;
    return ctx;
  }
  const repoData = await repoRes.json();
  ctx.language = repoData.language || undefined;
  ctx.repo_url = repoData.html_url;
  const branch = repoData.default_branch || "main";

  const treeRes = await fetch(
    `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`,
    { headers }
  );
  let allFiles: string[] = [];
  if (treeRes.ok) {
    const treeData = await treeRes.json();
    allFiles = (treeData.tree || []).filter((i: {type:string}) => i.type === "blob").map((i: {path:string}) => i.path);
  }
  ctx.manifests_found = MANIFEST_FILES.filter((f) => allFiles.includes(f));

  const toFetch = [...MANIFEST_FILES, ...DOCKER_FILES, ...VERSION_FILES].filter((f) => allFiles.includes(f));
  const fileContents: Record<string, string> = {};
  await Promise.all(
    toFetch.map(async (fname) => {
      try {
        const r = await fetch(
          `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${fname}`
        );
        if (r.ok) fileContents[fname] = (await r.text()).slice(0, 2000);
      } catch {}
    })
  );

  if (!ctx.language) {
    if (fileContents["package.json"]) ctx.language = "Node.js";
    else if (fileContents["requirements.txt"] || fileContents["pyproject.toml"] || fileContents["setup.py"]) ctx.language = "Python";
    else if (fileContents["go.mod"]) ctx.language = "Go";
    else if (fileContents["Cargo.toml"]) ctx.language = "Rust";
    else if (fileContents["pom.xml"]) ctx.language = "Java";
    else if (fileContents["Gemfile"]) ctx.language = "Ruby";
    else if (fileContents["composer.json"]) ctx.language = "PHP";
    else if (fileContents["mix.exs"]) ctx.language = "Elixir";
  }

  ctx.framework = detectFramework(fileContents);
  ctx.build_tool = detectBuildTool(fileContents, allFiles);
  ctx.runtime_versions = detectRuntimeVersions(fileContents);

  const depParts: string[] = [];
  for (const key of ["requirements.txt", "package.json", "go.mod", "Cargo.toml", "Gemfile", "composer.json", "pyproject.toml", "pom.xml"]) {
    if (fileContents[key]) depParts.push(`=== ${key} ===\n${fileContents[key].slice(0, 800)}`);
  }
  ctx.dependencies = depParts.join("\n\n");

  ctx.existing_docker_files = {};
  for (const f of DOCKER_FILES) {
    if (fileContents[f]) ctx.existing_docker_files[f] = fileContents[f];
  }
  ctx.detected_ports = detectPorts(fileContents);
  return ctx;
}

// ---------------------------------------------------------------------------
// Context summary builder
// ---------------------------------------------------------------------------
function buildContextSummary(ctx: RepoContext): string {
  const lines: string[] = [];
  lines.push(`Language: ${ctx.language || "Unknown"}`);
  if (ctx.framework) lines.push(`Framework: ${ctx.framework}`);
  if (ctx.build_tool) lines.push(`Build tool: ${ctx.build_tool}`);
  if (ctx.runtime_versions && Object.keys(ctx.runtime_versions).length > 0) {
    lines.push(`Runtime versions: ${Object.entries(ctx.runtime_versions).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
  if (ctx.detected_ports && ctx.detected_ports.length > 0) {
    lines.push(`Detected application ports: ${ctx.detected_ports.join(", ")}`);
  }
  if (ctx.dependencies) lines.push(`\nDependency manifests (excerpts):\n${ctx.dependencies.slice(0, 1500)}`);
  if (ctx.existing_docker_files && Object.keys(ctx.existing_docker_files).length > 0) {
    const names = Object.keys(ctx.existing_docker_files).join(", ");
    lines.push(`\nExisting Docker files found (for reference, do NOT copy blindly): ${names}`);
    const first = Object.entries(ctx.existing_docker_files)[0];
    if (first) lines.push(`\n--- ${first[0]} (existing, reference only) ---\n${first[1].slice(0, 800)}`);
  }
  if (ctx.repo_url) lines.push(`\nRepository: ${ctx.repo_url}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// AI Providers
// ---------------------------------------------------------------------------
async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000,
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 3000, temperature: 0.4 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

async function callCohere(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "command-r-plus",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000,
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`Cohere error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.message?.content?.[0]?.text || data.text || "").trim();
}

async function callOllama(prompt: string, host: string, model: string): Promise<string> {
  const url = `${host.replace(/\/$/, "")}/api/generate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status} — make sure Ollama is running and accessible at ${host}`);
  const data = await res.json();
  return (data.response || "").trim();
}

async function callAI(provider: string, prompt: string, keys: ApiKeys): Promise<string> {
  switch (provider) {
    case "openai":
      if (!keys.openai) throw new Error("OpenAI API key not configured. Add it in Settings.");
      return callOpenAI(prompt, keys.openai);
    case "gemini":
      if (!keys.google) throw new Error("Google API key not configured. Add it in Settings.");
      return callGemini(prompt, keys.google);
    case "cohere":
      if (!keys.cohere) throw new Error("Cohere API key not configured. Add it in Settings.");
      return callCohere(prompt, keys.cohere);
    case "ollama": {
      const host = keys.ollama_host || "http://localhost:11434";
      const model = keys.ollama_model || "llama3";
      return callOllama(prompt, host, model);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
function buildDockerfilePrompt(ctx: RepoContext): string {
  return `You are an expert Docker engineer. Generate a production-ready Dockerfile for the project described below.

=== PROJECT CONTEXT ===
${buildContextSummary(ctx)}

=== REQUIREMENTS ===
- Use a multi-stage build (builder + runtime) wherever a build/compile step exists.
- Choose an official, minimal base image (e.g. *-slim, *-alpine) appropriate for the language and version.
- Pin the base image version — do NOT use \`latest\`.
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
---DOCKERFILE_END---`;
}

function buildComposePrompt(ctx: RepoContext, networkType: string): string {
  const net = NETWORK_GUIDANCE[networkType] || NETWORK_GUIDANCE["bridge"];
  return `You are an expert Docker Compose engineer. Generate a production-ready docker-compose.yml for the project described below.

=== PROJECT CONTEXT ===
${buildContextSummary(ctx)}

=== NETWORK TYPE: ${net.label} ===
${net.guidance}

=== NETWORK BLOCK (homelab-alpha convention) ===
Place this block verbatim at the bottom of the file, substituting <APP_NAME> with the actual application name throughout:

${net.block}

=== REQUIREMENTS ===
- Use \`name:\` at the top for the Compose project name.
- Set \`restart: unless-stopped\` on all services.
- Use \`logging:\` with driver json-file, max-size 1M, max-file 2 on every service.
- Set \`stop_grace_period: 1m\` on every service.
- Set \`pull_policy: if_not_present\` on every service.
- Use \`security_opt: [no-new-privileges:true]\` on every service.
- Assign a static \`ipv4_address\` from the subnet to every service in the network block.
- Pass secrets and credentials via environment variables sourced from a \`.env\` file and optionally a \`stack.env\` file (Portainer compatibility).
- Set PUID/PGID (default 1000) and TZ environment variables on every service.
- Add a \`healthcheck:\` block with start_interval to every service.
- If the project uses a database or cache, include the appropriate optional service with a healthcheck.
- Add \`labels:\` with a \`com.<app_name>.<service>.description\` key to every service.
- If the application needs to be built from source, use the \`build:\` key; otherwise specify an \`image:\`.
- Map the correct application port(s) from EXPOSE to the host (use long-form \`ports:\` with target/published/protocol).
- Use external named volumes (external: true) for persistent data.

=== OUTPUT FORMAT ===
Return ONLY the raw docker-compose.yml content between these two separator lines and nothing else:
---COMPOSE_START---
<docker-compose.yml content here>
---COMPOSE_END---`;
}

// ---------------------------------------------------------------------------
// Extraction helper
// ---------------------------------------------------------------------------
function extractBetween(text: string, start: string, end: string): string {
  if (text.includes(start) && text.includes(end)) {
    const s = text.indexOf(start) + start.length;
    const e = text.indexOf(end, s);
    return text.slice(s, e).trim();
  }
  const lines = text.trim().split("\n");
  if (lines[0]?.startsWith("```")) lines.shift();
  if (lines[lines.length - 1]?.startsWith("```")) lines.pop();
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/health")) {
    return json({ status: "ok", service: "generate-docker" });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { mode, input, provider, network_type = "bridge", api_keys = {} } = body as {
    mode: string;
    input: string;
    provider: string;
    network_type?: string;
    api_keys?: ApiKeys;
  };

  if (!mode || !input || !provider) {
    return json({ error: "Missing required fields: mode, input, provider" }, 400);
  }

  try {
    let ctx: RepoContext;
    if (mode === "github") {
      ctx = await analyzeGitHubRepo(input, (api_keys as ApiKeys).github_token);
      if (ctx.error) return json({ error: ctx.error }, 400);
    } else {
      ctx = { mode: "language", language: input as string };
    }

    const [dockerfileRaw, composeRaw] = await Promise.all([
      callAI(provider, buildDockerfilePrompt(ctx), api_keys as ApiKeys),
      callAI(provider, buildComposePrompt(ctx, network_type as string), api_keys as ApiKeys),
    ]);

    const dockerfile = extractBetween(dockerfileRaw, "---DOCKERFILE_START---", "---DOCKERFILE_END---");
    const compose = extractBetween(composeRaw, "---COMPOSE_START---", "---COMPOSE_END---");

    return json({
      dockerfile,
      compose,
      context: {
        language: ctx.language,
        framework: ctx.framework,
        build_tool: ctx.build_tool,
        detected_ports: ctx.detected_ports,
        manifests_found: ctx.manifests_found,
        repo_url: ctx.repo_url,
        existing_docker_files: ctx.existing_docker_files ? Object.keys(ctx.existing_docker_files) : [],
      },
    });
  } catch (err) {
    console.error("generate-docker error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
