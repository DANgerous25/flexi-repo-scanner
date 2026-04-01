import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  ListTodo,
  Plug,
  FlaskConical,
  Settings,
  Bell,
  Moon,
  Sun,
  ScanSearch,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/use-theme";
import { mockNotifications } from "@/lib/mock-data";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/benchmarks", label: "Benchmarks", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
];

function ScannerLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Flexi Repo Scanner"
    >
      <rect x="2" y="2" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="1.5" className="text-cyan-500" />
      <path d="M7 10h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-cyan-400" />
      <path d="M7 14h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-cyan-400/70" />
      <path d="M7 18h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-cyan-400/50" />
      <circle cx="21" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" className="text-cyan-500" />
      <path d="M23.5 20.5L25.5 22.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-cyan-500" />
    </svg>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const unreadCount = mockNotifications.filter((n) => !n.read).length;

  const pageTitle = (() => {
    if (location === "/") return "Dashboard";
    if (location.startsWith("/tasks/") && location.includes("/edit")) return "Edit Task";
    if (location.startsWith("/tasks/") && location.includes("/results")) return "Task Results";
    if (location === "/tasks/new") return "New Task";
    if (location === "/notifications") return "Notifications";
    const item = navItems.find((n) => n.href === location);
    return item?.label ?? "Flexi Repo Scanner";
  })();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {!sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(true)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:relative z-50 lg:z-auto
          h-full border-r border-border bg-sidebar flex flex-col
          transition-all duration-300 ease-in-out
          ${sidebarOpen ? "w-56" : "w-0"}
          overflow-hidden
        `}
      >
        {/* Logo & Hamburger */}
        <div className="flex items-center h-14 border-b border-border">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex items-center justify-center w-14 h-14 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0"
            data-testid="button-sidebar-toggle"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          {sidebarOpen && (
            <div className="flex items-center gap-2.5 min-w-0">
              <ScannerLogo />
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-semibold text-foreground leading-tight truncate">Flexi Scanner</span>
                <span className="text-[10px] text-muted-foreground leading-tight">Repo Analysis</span>
              </div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <ScrollArea className="flex-1 py-2">
          <nav className="space-y-0.5 px-2">
            {navItems.map(({ href, label, icon: Icon }) => {
              const isActive = href === "/" ? location === "/" : location.startsWith(href);
              return (
                <Link key={href} href={href} onClick={() => setSidebarOpen(false)}>
                  <div
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                    data-testid={`nav-${label.toLowerCase()}`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {sidebarOpen ? <span className="truncate">{label}</span> : null}
                  </div>
                </Link>
              );
            })}
          </nav>
        </ScrollArea>

        {/* Bottom section */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <ScanSearch className="w-3.5 h-3.5 flex-shrink-0" />
            {sidebarOpen ? <span className="truncate">v1.0.0</span> : null}
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-border flex items-center justify-between px-4 md:px-6 bg-background flex-shrink-0">
          <div className="flex items-center gap-2">
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-8 w-8 text-muted-foreground"
              onClick={() => setSidebarOpen(true)}
              data-testid="button-mobile-menu"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <h1 className="text-sm font-semibold text-foreground">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={toggleTheme}
                  data-testid="button-theme-toggle"
                >
                  {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle theme</TooltipContent>
            </Tooltip>

            <Link href="/notifications">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground relative"
                    data-testid="button-notifications"
                  >
                    <Bell className="w-4 h-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-cyan-500 text-[10px] font-bold text-white flex items-center justify-center">
                        {unreadCount}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Notifications</TooltipContent>
              </Tooltip>
            </Link>
          </div>
        </header>

        {/* Page content */}
        <ScrollArea className="flex-1">
          <main className="p-4 md:p-6 min-w-0">{children}</main>
        </ScrollArea>
      </div>
    </div>
  );
}
