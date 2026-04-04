import { NavLink } from "react-router-dom";
import { Container, History, Settings, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Generator", icon: Zap },
  { to: "/history", label: "History", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
];

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell-grid min-h-screen">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col border-r border-border/70 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border/70">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-brand shadow-sm">
            <Container className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none tracking-tight">DockerForge</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">AI Docker Generator</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-border/70">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Supports OpenAI · Gemini<br />
            Cohere · Ollama (local)
          </p>
        </div>
      </aside>

      {/* Mobile topbar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-50 flex items-center justify-between border-b border-border/70 bg-background/90 backdrop-blur px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md gradient-brand">
            <Container className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold">DockerForge</span>
        </div>
        <nav className="flex items-center gap-1">
          {navItems.map(({ to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                )
              }
            >
              <Icon className="h-4 w-4" />
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <main className="lg:overflow-y-auto pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
