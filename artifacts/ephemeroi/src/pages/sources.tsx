import { useState, useMemo } from "react";
import { 
  useListEphemeroiSources, 
  useListEphemeroiSourceStates,
  useCreateEphemeroiSource, 
  useDeleteEphemeroiSource,
  useStreamEphemeroiSource,
  getListEphemeroiSourcesQueryKey,
  type EphemeroiSourceState,
  type EphemeroiStateAxes
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { Radio, Search, Link as LinkIcon, Trash2, Plus, AlertCircle, RefreshCw, Github, Users, Sparkles, ArrowUp, ArrowDown, Database, Rss, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

function StateMiniDisplay({ state }: { state: EphemeroiSourceState }) {
  const axes: Array<{ key: keyof EphemeroiStateAxes; letter: string; label: string }> = [
    { key: "capability", letter: "C", label: "Capability" },
    { key: "integrity",  letter: "I", label: "Integrity" },
    { key: "usability",  letter: "U", label: "Usability" },
    { key: "trust",      letter: "T", label: "Trust" },
  ];
  return (
    <div className="space-y-1.5" title={state.lastInsight ?? "no insight extracted yet"}>
      {axes.map((a) => {
        const v = state.vector[a.key];
        const d = state.lastDelta[a.key];
        const pct = Math.max(0, Math.min(1, v)) * 100;
        const moved = Math.abs(d) >= 0.005;
        const dir: "up" | "down" | "none" = moved ? (d > 0 ? "up" : "down") : "none";
        return (
          <div key={a.key} className="flex items-center gap-2 text-[10px] font-mono">
            <span className="w-3 text-muted-foreground" title={a.label}>{a.letter}</span>
            <div className="flex-1 h-1.5 bg-muted rounded-sm overflow-hidden">
              <div
                className={`h-full ${dir === "down" ? "bg-destructive/70" : "bg-primary/70"}`}
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
            <span className="w-7 text-right text-muted-foreground">{Math.round(pct)}</span>
            <span className="w-8 flex items-center justify-end gap-0.5">
              {dir === "up" && (
                <>
                  <ArrowUp className="w-2.5 h-2.5 text-primary" />
                  <span className="text-primary">{Math.round(d * 100)}</span>
                </>
              )}
              {dir === "down" && (
                <>
                  <ArrowDown className="w-2.5 h-2.5 text-destructive" />
                  <span className="text-destructive">{Math.round(d * 100)}</span>
                </>
              )}
              {dir === "none" && <span className="text-muted-foreground/40">·</span>}
            </span>
          </div>
        );
      })}
      {state.lastInsight && (
        <p className="text-[10px] italic text-muted-foreground/80 pt-1 line-clamp-2">
          "{state.lastInsight}"
        </p>
      )}
    </div>
  );
}

type SourceKind = "rss" | "url" | "search" | "github" | "github_user" | "gh_archive" | "stream";

export default function Sources() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useListEphemeroiSources();
  const { data: statesData } = useListEphemeroiSourceStates();
  const createSource = useCreateEphemeroiSource();
  const deleteSource = useDeleteEphemeroiSource();
  const streamSource = useStreamEphemeroiSource();
  const { toast } = useToast();

  const [streamingId, setStreamingId] = useState<number | null>(null);

  const stateBySourceId = useMemo(() => {
    const m = new Map<number, EphemeroiSourceState>();
    for (const s of statesData?.states ?? []) m.set(s.sourceId, s);
    return m;
  }, [statesData]);

  const [kind, setKind] = useState<SourceKind>("rss");
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");

  const githubPattern = /^([\w][\w.-]*\/[\w][\w.-]*|https?:\/\/(?:www\.)?github\.com\/[\w][\w.-]*\/[\w][\w.-]*\/?$)/i;
  const githubUserPattern = /^([\w][\w-]*|https?:\/\/(?:www\.)?github\.com\/[\w][\w-]*\/?$)/i;
  const ghArchivePattern = /^\s*(repo|event|org)\s*:\s*[\w./@-]+(?:\s*,\s*(repo|event|org)\s*:\s*[\w./@-]+)*\s*$/i;

  const githubInvalid = kind === "github" && target.length > 0 && !githubPattern.test(target.trim());
  const githubUserInvalid = kind === "github_user" && target.length > 0 && !githubUserPattern.test(target.trim());
  const ghArchiveInvalid = kind === "gh_archive" && target.length > 0 && !ghArchivePattern.test(target.trim());
  const streamUrlInvalid = kind === "stream" && target.length > 0 && !/^https?:\/\/.+/.test(target.trim());

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    if (kind === "github" && !githubPattern.test(target.trim())) {
      toast({ title: "Invalid GitHub repo", description: "Use \"owner/repo\" or a github.com URL.", variant: "destructive" });
      return;
    }
    if (kind === "github_user" && !githubUserPattern.test(target.trim())) {
      toast({ title: "Invalid GitHub user", description: "Use a username/org or a github.com/<user> URL.", variant: "destructive" });
      return;
    }
    if (kind === "gh_archive" && target.trim().length > 0 && !ghArchivePattern.test(target.trim())) {
      toast({ title: "Invalid GH Archive filter", description: "Use comma-separated repo:/event:/org: pairs.", variant: "destructive" });
      return;
    }
    if (kind === "stream" && !/^https?:\/\/.+/.test(target.trim())) {
      toast({ title: "Invalid stream URL", description: "Must be a fully-qualified HTTP/HTTPS URL.", variant: "destructive" });
      return;
    }
    try {
      await createSource.mutateAsync({ data: { kind, target: target.trim(), label: label || undefined } });
      setTarget("");
      setLabel("");
      queryClient.invalidateQueries({ queryKey: getListEphemeroiSourcesQueryKey() });
      toast({ title: "Source added successfully" });
    } catch {
      toast({ title: "Failed to add source", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteSource.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListEphemeroiSourcesQueryKey() });
    } catch {
      toast({ title: "Failed to delete source", variant: "destructive" });
    }
  };

  const handleStream = async (id: number) => {
    setStreamingId(id);
    try {
      const result = await streamSource.mutateAsync({ id });
      const { addedCount, bytesRead, errors } = result;
      if (errors.length > 0 && addedCount === 0) {
        toast({
          title: "Stream ingest failed",
          description: errors[0] ?? "Unknown error",
          variant: "destructive",
        });
      } else {
        const kb = (bytesRead / 1024).toFixed(1);
        toast({
          title: `Stream ingest complete`,
          description: `${addedCount} observation${addedCount !== 1 ? "s" : ""} added · ${kb} KB read${errors.length > 0 ? ` · ${errors.length} warning(s)` : ""}`,
        });
        queryClient.invalidateQueries({ queryKey: getListEphemeroiSourcesQueryKey() });
      }
    } catch {
      toast({ title: "Streaming ingest failed", variant: "destructive" });
    } finally {
      setStreamingId(null);
    }
  };

  const getIcon = (sourceKind: string) => {
    switch (sourceKind) {
      case "rss": return <Radio className="w-4 h-4" />;
      case "search": return <Search className="w-4 h-4" />;
      case "github": return <Github className="w-4 h-4" />;
      case "github_user": return <Users className="w-4 h-4" />;
      case "gh_archive": return <Database className="w-4 h-4" />;
      case "stream": return <Rss className="w-4 h-4" />;
      default: return <LinkIcon className="w-4 h-4" />;
    }
  };

  const targetLabel =
    kind === "search" ? "Search Query"
      : kind === "github" ? "GitHub Repo"
      : kind === "github_user" ? "GitHub User / Org"
      : kind === "gh_archive" ? "Filter Expression"
      : kind === "stream" ? "Stream URL (NDJSON or newline-delimited text)"
      : "URL";

  const targetPlaceholder =
    kind === "search" ? 'e.g. "artificial intelligence advances"'
      : kind === "github" ? "owner/repo or https://github.com/owner/repo"
      : kind === "github_user" ? "username or https://github.com/username"
      : kind === "gh_archive" ? "repo:torvalds/,event:PullRequestEvent"
      : kind === "stream" ? "https://example.com/events.ndjson"
      : "https://...";

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-48 w-full bg-card" />
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full bg-card" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <div>
        <h2 className="font-serif text-3xl text-foreground mb-2">Sources</h2>
        <p className="text-muted-foreground">What should the observer watch?</p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Add Source</CardTitle>
          <CardDescription>
            Configure a new RSS feed, URL, recurring search query, GitHub repo, GitHub user/org, GH Archive firehose, or a streaming NDJSON endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-col md:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1">
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={kind} onValueChange={(v: any) => setKind(v)}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rss">RSS/Atom Feed</SelectItem>
                  <SelectItem value="url">Single URL</SelectItem>
                  <SelectItem value="search">Search Topic</SelectItem>
                  <SelectItem value="github">GitHub Repo</SelectItem>
                  <SelectItem value="github_user">GitHub User / Org</SelectItem>
                  <SelectItem value="gh_archive">GH Archive (firehose)</SelectItem>
                  <SelectItem value="stream">Streaming Endpoint</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2 flex-[2]">
              <label className="text-xs font-medium text-muted-foreground">{targetLabel}</label>
              <Input 
                value={target}
                onChange={e => setTarget(e.target.value)}
                placeholder={targetPlaceholder}
                className="bg-background"
                required
                aria-invalid={githubInvalid || githubUserInvalid || ghArchiveInvalid || streamUrlInvalid}
              />
              {githubInvalid && (
                <p className="text-xs text-destructive">Use the form <code>owner/repo</code> or a github.com URL.</p>
              )}
              {githubUserInvalid && (
                <p className="text-xs text-destructive">Use a github username/org name or a <code>github.com/&lt;user&gt;</code> URL.</p>
              )}
              {ghArchiveInvalid && (
                <p className="text-xs text-destructive">
                  Use comma-separated <code>key:value</code> pairs where key is <code>repo</code>, <code>event</code>, or <code>org</code>.
                </p>
              )}
              {streamUrlInvalid && (
                <p className="text-xs text-destructive">Must be a fully-qualified HTTP or HTTPS URL.</p>
              )}
              {kind === "github_user" && !githubUserInvalid && (
                <p className="text-xs text-muted-foreground">
                  Watches up to 30 of this user's most-recently-pushed public repos (skips forks &amp; archived).
                </p>
              )}
              {kind === "gh_archive" && !ghArchiveInvalid && (
                <p className="text-xs text-muted-foreground">
                  Filter narrows the hourly GH event firehose. AND-combined; at least one filter required.
                </p>
              )}
              {kind === "stream" && !streamUrlInvalid && (
                <p className="text-xs text-muted-foreground">
                  Consumes NDJSON or newline-delimited text. Use "Stream Now" on the source card to trigger ingest on demand.
                </p>
              )}
            </div>

            <div className="space-y-2 flex-1">
              <label className="text-xs font-medium text-muted-foreground">Label (optional)</label>
              <Input 
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Auto-detect"
                className="bg-background"
              />
            </div>

            <Button type="submit" disabled={createSource.isPending} className="w-full md:w-auto">
              {createSource.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground">Active Streams</h3>
        
        {data?.sources.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground italic border border-dashed border-border rounded-lg bg-card/30">
            No sources configured yet. Add one above to begin.
          </div>
        ) : (
          <div className="grid gap-4">
            {data?.sources.map((source, i) => (
              <motion.div
                key={source.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="bg-card/50 border-border/50 overflow-hidden">
                  <div className="flex flex-col md:flex-row">
                    <div className="p-4 flex-1 flex items-start gap-4">
                      <div className={`p-2 rounded-md ${source.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                        {getIcon(source.kind)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="font-medium text-foreground truncate">{source.label}</h4>
                          <Badge variant={source.active ? "outline" : "secondary"} className="text-[10px] h-5 uppercase tracking-wider">
                            {source.kind}
                          </Badge>
                          {source.autoAdded && (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-5 uppercase tracking-wider border-primary/40 text-primary bg-primary/10 flex items-center gap-1"
                              title={source.autoAddedReason ?? "Added autonomously by Ephemeroi"}
                            >
                              <Sparkles className="w-3 h-3" /> Auto-watched
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate" title={source.target}>
                          {source.target}
                        </p>
                        {source.autoAdded && source.autoAddedReason && (
                          <p
                            className="text-xs text-muted-foreground/80 italic mt-1 line-clamp-2"
                            title={source.autoAddedReason}
                          >
                            "{source.autoAddedReason}"
                          </p>
                        )}
                      </div>
                    </div>
                    
                    <div className="p-4 md:border-l border-t md:border-t-0 border-border/50 bg-background/30 flex flex-col gap-3 md:w-72">
                      {(() => {
                        const st = stateBySourceId.get(source.id);
                        return st ? (
                          <StateMiniDisplay state={st} />
                        ) : (
                          <div className="text-[10px] font-mono text-muted-foreground/50 italic">
                            no readings yet
                          </div>
                        );
                      })()}

                      <div className="flex items-end justify-between gap-3 pt-1 border-t border-border/30">
                        <div className="text-xs">
                          <div className="text-muted-foreground mb-1">Last polled</div>
                          <div className="font-mono text-foreground">
                            {source.lastPolledAt ? formatDistanceToNow(new Date(source.lastPolledAt)) + " ago" : "Never"}
                          </div>
                          {source.lastError && (
                            <div className="text-destructive mt-1 flex items-center gap-1 line-clamp-1" title={source.lastError}>
                              <AlertCircle className="w-3 h-3" /> Error
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          {source.kind === "stream" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7 gap-1"
                              onClick={() => handleStream(source.id)}
                              disabled={streamingId === source.id}
                              title="Trigger a streaming ingest pass on demand"
                            >
                              {streamingId === source.id ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Zap className="w-3 h-3" />
                              )}
                              {streamingId === source.id ? "Streaming…" : "Stream Now"}
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDelete(source.id)}
                            disabled={deleteSource.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
