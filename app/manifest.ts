import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";

/** Web app manifest (A64): makes the app installable and is what the Android TWA wrapper reads. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.name,
    short_name: brand.name,
    description: brand.tagline,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f0e8",
    theme_color: "#2a2620",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      { src: "/screenshots/narrow-dashboard.png", sizes: "1080x1920", type: "image/png", form_factor: "narrow", label: "Dashboard" },
      { src: "/screenshots/narrow-timer.png", sizes: "1080x1920", type: "image/png", form_factor: "narrow", label: "Timer" },
      { src: "/screenshots/wide-dashboard.png", sizes: "1920x1080", type: "image/png", form_factor: "wide", label: "Dashboard" },
      { src: "/screenshots/wide-timer.png", sizes: "1920x1080", type: "image/png", form_factor: "wide", label: "Timer" },
    ],
    shortcuts: [
      { name: "Timer", url: "/timer", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Chat", url: "/chat", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Tasks", url: "/tasks", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
