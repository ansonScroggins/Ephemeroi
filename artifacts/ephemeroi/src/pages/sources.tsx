import { useState } from "react";
import { 
  useListEphemeroiSources, 
  useCreateEphemeroiSource, 
  useDeleteEphemeroiSource,
  getListEphemeroiSourcesQueryKey
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { Radio, Search, Link as LinkIcon, Trash2, Plus, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

export default function Sources() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useListEphemeroiSources();
  const createSource = useCreateEphemeroiSource();
  const deleteSource = useDeleteEphemeroiSource();
  const { toast } = useToast();

  const [kind, setKind] = useState<"rss" | "url" | "search">("rss");
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;

    try {
      await createSource.mutateAsync({
        data: { kind, target, label: label || undefined }
      });
      setTarget("");
      setLabel("");
      queryClient.invalidateQueries({ queryKey: getListEphemeroiSourcesQueryKey() });
      toast({ title: "Source added successfully" });
    } catch (err) {
      toast({ 
        title: "Failed to add source", 
        variant: "destructive" 
      });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteSource.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListEphemeroiSourcesQueryKey() });
    } catch (err) {
      toast({ 
        title: "Failed to delete source", 
        variant: "destructive" 
      });
    }
  };

  const getIcon = (sourceKind: string) => {
    switch(sourceKind) {
      case 'rss': return <Radio className="w-4 h-4" />;
      case 'search': return <Search className="w-4 h-4" />;
      default: return <LinkIcon className="w-4 h-4" />;
    }
  };

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
          <CardDescription>Configure a new RSS feed, URL, or recurring search query.</CardDescription>
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
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2 flex-[2]">
              <label className="text-xs font-medium text-muted-foreground">
                {kind === 'search' ? 'Search Query' : 'URL'}
              </label>
              <Input 
                value={target}
                onChange={e => setTarget(e.target.value)}
                placeholder={kind === 'search' ? 'e.g. "artificial intelligence advances"' : 'https://...'}
                className="bg-background"
                required
              />
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
                      <div className={`p-2 rounded-md ${source.active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                        {getIcon(source.kind)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-foreground truncate">{source.label}</h4>
                          <Badge variant={source.active ? "outline" : "secondary"} className="text-[10px] h-5 uppercase tracking-wider">
                            {source.kind}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate" title={source.target}>
                          {source.target}
                        </p>
                      </div>
                    </div>
                    
                    <div className="p-4 md:border-l border-t md:border-t-0 border-border/50 bg-background/30 flex items-center justify-between md:justify-end gap-6 md:w-64">
                      <div className="text-xs">
                        <div className="text-muted-foreground mb-1">Last Polled</div>
                        <div className="font-mono text-foreground">
                          {source.lastPolledAt ? formatDistanceToNow(new Date(source.lastPolledAt)) + ' ago' : 'Never'}
                        </div>
                        {source.lastError && (
                          <div className="text-destructive mt-1 flex items-center gap-1 line-clamp-1" title={source.lastError}>
                            <AlertCircle className="w-3 h-3" /> Error
                          </div>
                        )}
                      </div>
                      
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
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
