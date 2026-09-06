import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Option Profit Calculator",
    short_name: "OPC",
    description:
      "Analyze covered calls, cash-secured puts, LEAPS, and portfolio income with deterministic calculations and real market data.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#1e293b",
    orientation: "any",
    categories: ["finance", "productivity"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
