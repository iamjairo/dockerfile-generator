import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { History, Github, Code2, Copy, ChevronDown, ChevronUp, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface HistoryEntry {
  id: string;
  created_at: string;
  mode: string;
  input_value: string;
  provider: string;
  network_type: string;
  language: string | null;
  framework: string | null;
  detected_ports: number[] | null;
  dockerfile: string | null;
  compose: string | null;
  repo_url: string | null;
  error_message: string | null;
}

function getSessionId(): string {
  let sid = localStorage.getItem("dfgen_session_id");
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem("dfgen_session_id", sid);
  }
  return sid;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI GPT-4o",
  gemini: "Google Gemini",
  cohere: "Cohere",
  ollama: "Ollama",
};

function EntryCard({ entry, onDelete }: { entry: HistoryEntry; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const label = entry.framework || entry.language || entry.input_value;
  const isError = !!entry.error_message;

  return (
    <Card className={`panel-surface ${isError ? "border-destructive/30" : ""}`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${isError ? "bg-destructive/10" : "bg-primary/10"}`}>
            {entry.mode === "github" ? (
              <Github className={`h-3.5 w-3.5 ${isError ? "text-destructive" : "text-primary"}`} />
            ) : (
              <Code2 className={`h-3.5 w-3.5 ${isError ? "text-destructive" : "text-primary"}`} />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">{label}</span>
              {isError && <Badge variant="destructive" className="text-[10px] h-4">Error</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <Badge variant="outline" className="text-[10px] h-4">{PROVIDER_LABELS[entry.provider] || entry.provider}</Badge>
              <Badge variant="outline" className="text-[10px] h-4">{entry.network_type}</Badge>
              {entry.detected_ports?.map((p) => (
                <Badge key={p} variant="secondary" className="text-[10px] h-4">:{p}</Badge>
              ))}
            </div>
            {isError && (
              <p className="text-xs text-destructive mt-1.5 line-clamp-2">{entry.error_message}</p>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {!isError && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setExpanded((e) => !e)}
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(entry.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {expanded && !isError && (
          <div className="mt-4">
            <Tabs defaultValue="dockerfile">
              <TabsList className="h-8 w-full">
                <TabsTrigger value="dockerfile" className="flex-1 text-xs">Dockerfile</TabsTrigger>
                <TabsTrigger value="compose" className="flex-1 text-xs">docker-compose.yml</TabsTrigger>
              </TabsList>
              <TabsContent value="dockerfile" className="mt-2">
                <div className="relative rounded-md border border-border/70 overflow-hidden">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute right-2 top-2 h-6 text-[10px] gap-1 z-10"
                    onClick={() => handleCopy(entry.dockerfile!, "Dockerfile")}
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                  <pre className="p-3 text-[11px] leading-relaxed overflow-x-auto max-h-80 bg-[hsl(224_27%_8%)] text-slate-300 font-mono">
                    {entry.dockerfile}
                  </pre>
                </div>
              </TabsContent>
              <TabsContent value="compose" className="mt-2">
                <div className="relative rounded-md border border-border/70 overflow-hidden">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute right-2 top-2 h-6 text-[10px] gap-1 z-10"
                    onClick={() => handleCopy(entry.compose!, "docker-compose.yml")}
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                  <pre className="p-3 text-[11px] leading-relaxed overflow-x-auto max-h-80 bg-[hsl(224_27%_8%)] text-slate-300 font-mono">
                    {entry.compose}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sid = getSessionId();
    supabase
      .from("generation_history")
      .select("*")
      .eq("session_id", sid)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) toast.error("Failed to load history");
        else setEntries((data as HistoryEntry[]) || []);
        setLoading(false);
      });
  }, []);

  const handleDelete = async (id: string) => {
    await supabase.from("generation_history").delete().eq("id", id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    toast.success("Entry deleted");
  };

  const successful = entries.filter((e) => !e.error_message);
  const failed = entries.filter((e) => !!e.error_message);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6 text-primary" />
            Generation History
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            All generations from this browser session
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Badge variant="secondary">{successful.length} successful</Badge>
          {failed.length > 0 && <Badge variant="destructive">{failed.length} failed</Badge>}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading history…
        </div>
      ) : entries.length === 0 ? (
        <Card className="panel-surface">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <History className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No generations yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Go to the Generator tab to create your first Dockerfile
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
