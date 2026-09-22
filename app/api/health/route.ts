import mongoose from "mongoose";
import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";

export const GET = route(async () => ok({ status: "ok", db: mongoose.connection.readyState === 1 ? "connected" : "disconnected", time: new Date().toISOString() }));
