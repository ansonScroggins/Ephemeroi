import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, BookOpen, AlertTriangle, FileText, Settings, Radio, Eye, Brain, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEphemeroiStream } from "@/hooks/use-ephemeroi-stream";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  
  // Initialize the SSE stream connection for the entire app
  useEphemeroiStream();

  const navItems = [
    { href: "/", label: "Overview", icon: Eye },
    { href: "/sources", label: "Sources", icon: Radio },
    { href: "/beliefs", label: "Beliefs", icon: BookOpen },
    { href: "/topic-beliefs", label: "Opinions", icon: Brain },
    { href: "/contradictions", label: "Tensions", icon: AlertTriangle },
    { href: "/reports", label: "Reports", icon: FileText },
    { href: "/spectral", label: "Spectral", icon: Sparkles },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background text-foreground font-sans">
      {/* Sidebar */}
      <aside className="w-full md:w-64 border-b md:border-r border-border bg-sidebar flex-shrink-0 flex flex-col">
        <div className="p-6">
          <div className="flex items-center gap-3 text-primary mb-1">
            <Activity className="w-6 h-6" />
            <h1 className="font-serif text-2xl tracking-wide font-medium text-foreground">Ephemeroi</h1>
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-2 uppercase tracking-wider">Autonomous Observer</p>
        </div>

        <nav className="flex-1 px-4 pb-6 overflow-y-auto">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "opacity-70")} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.015] mix-blend-overlay z-0" 
             style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}>
        </div>
        <div className="flex-1 overflow-y-auto relative z-10 p-6 md:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}
