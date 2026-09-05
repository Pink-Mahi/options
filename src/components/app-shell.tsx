"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Calculator, LayoutDashboard, PieChart, Search, Sparkles, Sun, Moon, Wallet, Layers, Eye, Shield, LogOut, User as UserIcon, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "USER";
}

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/search", label: "Stocks", icon: Search },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/positions", label: "Positions", icon: Layers },
  { href: "/watchlist", label: "Watchlist", icon: Eye },
  { href: "/income-planner", label: "Income", icon: Wallet },
  { href: "/calculator", label: "Calculator", icon: Calculator },
  { href: "/ai", label: "AI Assistant", icon: Sparkles },
];

export function AppShell({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwModal, setPwModal] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setUser(data.user ?? null))
      .catch(() => setUser(null));
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/login");
    router.refresh();
  }

  const navItems = user?.role === "ADMIN"
    ? [...NAV, { href: "/admin", label: "Admin", icon: Shield }]
    : NAV;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-14 items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
              OPC
            </span>
            <span className="hidden sm:inline">Option Profit Calculator</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1">
            {navItems.map((item) => {
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors",
                    active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {user && (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setMenuOpen(!menuOpen)}
                >
                  <UserIcon className="h-4 w-4" />
                  <span className="hidden sm:inline text-xs">{user.name ?? user.email}</span>
                </Button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 rounded-md border bg-popover p-1 shadow-md">
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">{user.name ?? "User"}</div>
                      <div>{user.email}</div>
                      {user.role === "ADMIN" && (
                        <span className="mt-0.5 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">ADMIN</span>
                      )}
                    </div>
                    <button
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-secondary"
                      onClick={() => { setMenuOpen(false); setPwModal(true); }}
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Change password
                    </button>
                    <button
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-secondary"
                      onClick={() => { setMenuOpen(false); handleLogout(); }}
                    >
                      <LogOut className="h-3.5 w-3.5" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            )}
          </nav>
        </div>
        {demo && (
          <div className="border-t bg-amber-500/10 px-4 py-1 text-center text-xs text-amber-700 dark:text-amber-300">
            Demo mode: no MARKET_DATA_API_KEY configured. Showing deterministic mock data. Add a Tradier key in .env.local for live data.
          </div>
        )}
      </header>
      {pwModal && <ChangePasswordModal onClose={() => setPwModal(false)} />}
      <main className="container flex-1 py-6">{children}</main>
      <footer className="border-t py-3 text-center text-xs text-muted-foreground">
        Educational tool only. Not investment advice. All calculations are estimates from market data and deterministic formulas.
      </footer>
    </div>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setErr("New passwords do not match");
      return;
    }
    if (next.length < 6) {
      setErr("New password must be at least 6 characters");
      return;
    }
    setLoading(true);
    setErr("");
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setLoading(false);
    if (res.ok) {
      setSuccess(true);
      setTimeout(onClose, 1500);
    } else {
      const data = await res.json().catch(() => ({}));
      setErr(data.error ?? "Failed to change password");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">Change Password</h2>
        {success ? (
          <p className="text-sm text-green-600 dark:text-green-400">Password changed successfully.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Current password</label>
              <input
                type="password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">New password</label>
              <input
                type="password"
                required
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Confirm new password</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                autoComplete="new-password"
              />
            </div>
            {err && <p className="text-sm text-red-500">{err}</p>}
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? "Changing…" : "Change password"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
