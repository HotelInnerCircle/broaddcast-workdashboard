import type { Server as SocketIOServer, Socket } from "socket.io";
import { Types } from "mongoose";
import { connectDB } from "../db/connect";
import { resolveSession } from "../auth/session-service";
import { parseCookieHeader, sessionCookieName } from "../auth/cookies";
import { registerRealtime } from "./index";
import { rooms, type RealtimeAdapter } from "./adapter";
import { presence, OFFLINE_AFTER_MS } from "./presence";
import { User } from "../../models/User";
import type { SessionContext } from "../../types";

/**
 * Socket.IO layer (spec 3.3, 7.6, 10). Sockets authenticate with the same session cookie as HTTP
 * and join company:{id} + user:{id}; conversation rooms are joined only after a membership check.
 * Every emit is addressed to a room inside one company, so nothing can cross tenants.
 */
export function attachRealtime(io: SocketIOServer) {
  io.use(async (socket: Socket, next) => {
    try {
      const cookies = parseCookieHeader(socket.handshake.headers.cookie);
      await connectDB();
      const ctx = await resolveSession(cookies[sessionCookieName()]);
      if (!ctx) return next(new Error("unauthorized"));
      (socket.data as { ctx: SessionContext }).ctx = ctx;
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error("unauthorized"));
    }
  });

  const adapter: RealtimeAdapter = {
    emitToCompany: (companyId, event, payload) => { io.to(rooms.company(companyId)).emit(event, payload); },
    emitToUser: (userId, event, payload) => { io.to(rooms.user(userId)).emit(event, payload); },
    emitToRoom: (companyId, room, event, payload) => { io.to(rooms.scoped(companyId, room)).emit(event, payload); },
  };
  registerRealtime(adapter);

  const touchLastActive = async (userId: string) => { try { await User.updateOne({ _id: new Types.ObjectId(userId) }, { $set: { lastActiveAt: new Date() } }); } catch { /* best effort */ } };
  const announce = (ctx: SessionContext, online: boolean) => { if (ctx.companyId) adapter.emitToCompany(ctx.companyId, "presence:update", { userId: ctx.userId, online, at: new Date() }); };

  io.on("connection", (socket) => {
    const ctx = (socket.data as { ctx: SessionContext }).ctx;
    socket.join(rooms.user(ctx.userId));
    if (ctx.companyId) socket.join(rooms.company(ctx.companyId));
    if (presence.heartbeat(ctx.userId, ctx.companyId, true)) announce(ctx, true);
    void touchLastActive(ctx.userId);

    /** Client sends this every 30s (spec 7.6). */
    socket.on("presence:heartbeat", () => {
      if (presence.heartbeat(ctx.userId, ctx.companyId)) announce(ctx, true);
    });

    /** Join a conversation room after a server-side membership check; cross-tenant ids are simply not found. */
    socket.on("chat:join", async (conversationId: unknown, ack?: (ok: boolean) => void) => {
      try {
        if (!ctx.companyId || typeof conversationId !== "string") throw new Error("bad request");
        const { getAccessibleConversation } = await import("../../services/chatService");
        await getAccessibleConversation(ctx as SessionContext & { companyId: string }, conversationId);
        socket.join(rooms.scoped(ctx.companyId, `conversation:${conversationId}`));
        ack?.(true);
      } catch {
        ack?.(false);
      }
    });
    socket.on("chat:leave", (conversationId: unknown) => {
      if (ctx.companyId && typeof conversationId === "string") socket.leave(rooms.scoped(ctx.companyId, `conversation:${conversationId}`));
    });
    /** Typing indicator relayed only inside a room the socket has joined. */
    socket.on("chat:typing", (conversationId: unknown) => {
      if (!ctx.companyId || typeof conversationId !== "string") return;
      const room = rooms.scoped(ctx.companyId, `conversation:${conversationId}`);
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit("chat:typing", { conversationId, userId: ctx.userId, name: ctx.name, at: Date.now() });
    });

    socket.on("disconnect", () => {
      if (presence.disconnect(ctx.userId)) announce(ctx, false);
    });
  });

  /** Dead connections without a close frame go offline once their heartbeat is older than 90s. */
  setInterval(() => {
    for (const gone of presence.sweep()) if (gone.companyId) adapter.emitToCompany(gone.companyId, "presence:update", { userId: gone.userId, online: false, at: new Date() });
  }, Math.min(15_000, OFFLINE_AFTER_MS / 6)).unref();

  return adapter;
}
