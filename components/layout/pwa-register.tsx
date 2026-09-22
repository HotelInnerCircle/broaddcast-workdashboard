"use client";
import { useEffect } from "react";

/** Registers the service worker (A64). No-op in development and in browsers without SW support. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* not fatal */ });
  }, []);
  return null;
}
