import dns from "node:dns";
import mongoose from "mongoose";
import { env } from "@/lib/env";
// Registering every model here guarantees populate() targets exist regardless of which route compiled first.
import "@/models";

declare global {
  // eslint-disable-next-line no-var
  var __mongoose: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined;
}

const cached = global.__mongoose ?? (global.__mongoose = { conn: null, promise: null });

/** Cached connection: safe across Next.js hot reloads and route handlers. */
export async function connectDB(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    // Optional resolver override (A52): Node's c-ares can fall back to 127.0.0.1 on some Windows
    // setups, which breaks mongodb+srv lookups even though the OS resolver works.
    const servers = (process.env.DNS_SERVERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (servers.length) dns.setServers(servers);
    mongoose.set("strictQuery", true);
    cached.promise = mongoose.connect(env.MONGODB_URI, { maxPoolSize: 20 }).then((m) => m);
  }
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    // Do not cache a failed attempt (e.g. a transient SRV DNS error at boot): the next request retries.
    cached.promise = null;
    throw e;
  }
  return cached.conn;
}
