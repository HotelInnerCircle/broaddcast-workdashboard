import path from "node:path";
import type { NextConfig } from "next";

const secure = (process.env.APP_URL ?? "").startsWith("https://");
const dev = process.env.NODE_ENV !== "production";
const imagekit = new URL(process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io").origin;

/**
 * Content-Security-Policy (A59). Next.js needs inline scripts/styles for hydration and Tailwind, so
 * those stay 'unsafe-inline'; everything else is locked to this origin plus Razorpay checkout and the
 * ImageKit endpoint. Socket.IO connects same-origin (ws/wss).
 *
 * 'unsafe-eval' is added in development only: `next dev` compiles modules through eval for hot
 * reloading, and without it the page never hydrates - the login form falls back to a native submit
 * and nothing on the site works. The production bundle needs no eval, so production does not get it.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${imagekit} https://*.razorpay.com`,
  "font-src 'self' data:",
  // Ably (A76) needs its realtime socket and its REST/SSE fallback hosts; without them the
  // browser blocks the connection and chat silently drops back to polling.
  "connect-src 'self' ws: wss: https://*.ably.net wss://*.ably.net https://*.ably.io wss://*.ably.io https://*.ably-realtime.com wss://*.ably-realtime.com https://api.razorpay.com https://lumberjack.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(secure ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A63: client router cache - a page visited in the last 60s renders instantly on revisit instead of re-rendering on the server.
  experimental: { staleTimes: { dynamic: 60, static: 300 } },
  outputFileTracingRoot: path.join(process.cwd()),
  serverExternalPackages: ["mongoose", "socket.io", "nodemailer", "bcryptjs", "exceljs", "pdfkit", "imagekit"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  async headers() {
    return [
      /*
       * The face model weights never change - a new model would be a new file
       * name - and they are 6.5 MB (A113). Served with the default
       * `max-age=0, must-revalidate` every launch pays a round trip per file
       * before it may use bytes it already has. Marked immutable, it is one
       * download per device and nothing after that.
       */
      {
        source: "/models/face/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // A83: attendance swipes need the camera and a location fix. Both are granted to this origin
          // only, and the browser still asks the person - the policy is what makes asking possible at
          // all. Microphone and USB stay off: nothing here has any use for them.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(self \"https://checkout.razorpay.com\"), usb=()" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(secure ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
