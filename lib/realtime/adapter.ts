/**
 * Realtime adapter interface (spec 3.1 / 3.3). Feature code only ever calls these
 * methods; the implementation (Socket.IO today, Pusher/Ably/polling later) is swappable.
 * Events are always addressed to a company, a user, or a named room inside a company -
 * never broadcast globally, so nothing can cross tenants.
 */
export interface RealtimeAdapter {
  emitToCompany(companyId: string, event: string, payload: unknown): void;
  emitToUser(userId: string, event: string, payload: unknown): void;
  emitToRoom(companyId: string, room: string, event: string, payload: unknown): void;
}

export const rooms = {
  company: (companyId: string) => `company:${companyId}`,
  user: (userId: string) => `user:${userId}`,
  scoped: (companyId: string, room: string) => `company:${companyId}:${room}`,
};

export const noopAdapter: RealtimeAdapter = {
  emitToCompany() {},
  emitToUser() {},
  emitToRoom() {},
};
