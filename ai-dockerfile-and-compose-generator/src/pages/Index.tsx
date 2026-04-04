import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Github,
  Code2,
  Zap,
  Copy,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Network,
  Bot,
} from "lucide-react";

const PROVIDERS = [
  { value: "openai", label: "OpenAI GPT-4o" },
  { value: "gemini", label: "Google Gemini 1.5 Pro" },
  { value: "cohere", label: "Cohere command-r-plus" },
  { value: "ollama", label: "Ollama (local)" },
];

function getSessionId(): string {
  let sid = localStorage.getItem("dfgen_session_id");
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem("dfgen_session_id", sid);
  }
  return sid;
}

function getApiKeys() {
  try {
    return JSON.parse(localStorage.getItem("dfgen_api_keys") || "{}");
  } catch {
    return {};
  }
}

function CodeBlock({ code, filename }: { code: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  return (
    <div className="rounded-lg border border-border/70 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/60 border-b border-border/70">
        <span className="text-xs font-mono text-muted-foreground">{filename}</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={handleCopy}>
            {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
        </div>
      </div>
      <pre className="p-4 text-xs leading-relaxed overflow-x-auto overflow-y-auto max-h-[500px] bg-[hsl(224_27%_8%)] text-slate-300 font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function Index() {
  const [provider, setProvider] = useState("openai");
  const [networkType, setNetworkType] = useState("bridge");
  const [mode, setMode] = useState("language");
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    dockerfile: string;
    compose: string;
    context: {
      language?: string;
      framework?: string;
      detected_ports?: number[];
      repo_url?: string;
      manifests_found?: string[];
      existing_docker_files?: string[];
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    const sid = getSessionId();
    supabase
      .from("generation_history")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sid)
      .then(({ count }) => setTotalCount(count || 0));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!inputValue.trim()) {
      toast.warning(
        mode === "github"
          ? "Please enter a GitHub repository URL"
          : "Please enter a language or framework"
      );
      return;
    }

    const apiKeys = getApiKeys();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("generate-docker", {
        body: {
          mode,
          input: inputValue.trim(),
          provider,
          network_type: networkType,
          api_keys: apiKeys,
        },
      });

      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      setResult(data);

      // Save to history
      const sid = getSessionId();
      await supabase.from("generation_history").insert({
        session_id: sid,
        mode,
        input_value: inputValue.trim(),
        provider,
        network_type: networkType,
        language: data.context?.language || null,
        framework: data.context?.framework || null,
        detected_ports: data.context?.detected_ports?.length ? data.context.detected_ports : null,
        dockerfile: data.dockerfile,
        compose: data.compose,
        repo_url: data.context?.repo_url || null,
      });

      setTotalCount((c) => c + 1);
      toast.success("Files generated successfully!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      toast.error("Generation failed", { description: msg });

      // Save error to history
      const sid = getSessionId();
      await supabase.from("generation_history").insert({
        session_id: sid,
        mode,
        input_value: inputValue.trim(),
        provider,
        network_type: networkType,
        error_message: msg,
      });
    } finally {
      setLoading(false);
    }
  }, [inputValue, mode, provider, networkType]);

  const label = result?.context?.framework || result?.context?.language || inputValue;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            Generator
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate production-ready Dockerfile + docker-compose.yml from a GitHub repo or language name
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {totalCount} generated
        </Badge>
      </div>

      {/* Config card */}
      <Card className="panel-surface">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Provider + Network row */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <Bot className="h-3.5 w-3.5" />
                AI Provider
              </Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-sm">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <Network className="h-3.5 w-3.5" />
                Docker Network Type
              </Label>
              <div className="flex rounded-lg border border-border/70 overflow-hidden h-9">
                {(["bridge", "macvlan"] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => setNetworkType(n)}
                    className={`flex-1 text-xs font-medium transition-colors ${
                      networkType === n
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {networkType === "macvlan" && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-400">
              <strong>macvlan:</strong> Containers get real LAN IPs — directly reachable without port mapping.
              Requires knowing your host NIC name (<code className="font-mono">ip a</code>). The Docker host cannot
              reach macvlan containers by default.
            </div>
          )}

          {/* Input mode tabs */}
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList className="w-full h-9">
              <TabsTrigger value="github" className="flex-1 gap-1.5 text-xs">
                <Github className="h-3.5 w-3.5" />
                GitHub Repo
              </TabsTrigger>
              <TabsTrigger value="language" className="flex-1 gap-1.5 text-xs">
                <Code2 className="h-3.5 w-3.5" />
                Language / Framework
              </TabsTrigger>
            </TabsList>
            <TabsContent value="github" className="mt-3 space-y-1.5">
              <Label className="text-xs">GitHub Repository URL</Label>
              <Input
                placeholder="https://github.com/owner/repo  or  owner/repo"
                value={mode === "github" ? inputValue : ""}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                className="font-mono text-sm h-9"
              />
              <p className="text-[11px] text-muted-foreground">
                The app analyses the repo via GitHub API — detects language, framework, ports, and dependencies.
              </p>
            </TabsContent>
            <TabsContent value="language" className="mt-3 space-y-1.5">
              <Label className="text-xs">Language or Framework</Label>
              <Input
                placeholder="e.g. Python, Node.js, Java, Django, React, Go…"
                value={mode === "language" ? inputValue : ""}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                className="text-sm h-9"
              />
            </TabsContent>
          </Tabs>

          <Button
            onClick={handleGenerate}
            disabled={loading || !inputValue.trim()}
            className="w-full gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating with {PROVIDERS.find((p) => p.value === provider)?.label}…
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" />
                Generate Docker Files
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Error state */}
      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive">Generation failed</p>
                <p className="text-xs text-muted-foreground mt-1">{error}</p>
                {error.toLowerCase().includes("api key") && (
                  <p className="text-xs mt-2 text-muted-foreground">
                    Go to <a href="/settings" className="text-primary underline">Settings</a> to configure your API keys.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4 animate-fade-in-safe">
          {/* Context analysis */}
          <Card className="panel-surface border-green-500/20 bg-green-500/5">
            <CardContent className="pt-4 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                <span className="text-sm font-medium text-green-700 dark:text-green-400">
                  Generated for{" "}
                  <strong>{label}</strong>
                  {result.context?.framework && result.context?.language && ` (${result.context.language})`}
                </span>
                <div className="flex flex-wrap gap-1.5 ml-auto">
                  {result.context?.detected_ports?.map((p) => (
                    <Badge key={p} variant="outline" className="text-[10px] h-5">
                      :{p}
                    </Badge>
                  ))}
                  <Badge variant="secondary" className="text-[10px] h-5">{networkType} network</Badge>
                  <Badge variant="secondary" className="text-[10px] h-5">{PROVIDERS.find(p => p.value === provider)?.label}</Badge>
                </div>
              </div>
              {result.context?.manifests_found && result.context.manifests_found.length > 0 && (
                <p className="text-[11px] text-muted-foreground mt-2 ml-6">
                  Analysed: {result.context.manifests_found.join(", ")}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Output tabs */}
          <Tabs defaultValue="dockerfile">
            <TabsList className="w-full h-9">
              <TabsTrigger value="dockerfile" className="flex-1 text-xs">📄 Dockerfile</TabsTrigger>
              <TabsTrigger value="compose" className="flex-1 text-xs">🐳 docker-compose.yml</TabsTrigger>
            </TabsList>
            <TabsContent value="dockerfile" className="mt-3">
              <CodeBlock code={result.dockerfile} filename="Dockerfile" />
            </TabsContent>
            <TabsContent value="compose" className="mt-3">
              <CodeBlock code={result.compose} filename="docker-compose.yml" />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
