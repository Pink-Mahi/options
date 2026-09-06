import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { isDemoMode } from "@/features/market-data/service";

export const metadata: Metadata = {
  title: "Option Profit Calculator — AI Options Income & Profit Analyzer",
  description:
    "Analyze covered calls, cash-secured puts, LEAPS, and portfolio income with deterministic calculations and real market data.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "OPC",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

const SHELL_EXCLUDED_PATHS = ["/login", "/setup"];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemoMode();
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "";
  const excludeShell = SHELL_EXCLUDED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider>
          {excludeShell ? children : <AppShell demo={demo}>{children}</AppShell>}
        </ThemeProvider>
      </body>
    </html>
  );
}
