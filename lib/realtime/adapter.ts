/**
 * Realtime adapter interface (spec 3.1 / 3.3). Feature code only ever calls these methods; the
 * implementation (Socket.IO on a host with a live Node process, Ably where there is none) is
 * swappable. Events are always addressed to a company or to named users - never broadcast
 * globally, so nothing can cross tenants.
 */
export interface RealtimeAdapter {
  emitToCompany(companyId: string, event: string, payload: unknown): void;
  emitToUser(userId: string, event: string, payload: unknown): void;
  /**
   * Fan out to a known set of people (A76). Conversation traffic goes this way rather than to a
   * shared room: with a hosted pub/sub service the server decides who receives what, so a DM can
   * never be delivered to - or subscribed to by - someone who is not in it.
   */
  emitToUsers(userIds: string[], event: string, payload: unknown): void;
}

/** Channel/room names. The same two names work as Socket.IO rooms and as Ably channels. */
export const rooms = {
  company: (companyId: string) => `company:${companyId}`,
  user: (userId: string) => `user:${userId}`,
};

export const noopAdapter: RealtimeAdapter = {
  emitToCompany() {},
  emitToUser() {},
  emitToUsers() {},
};
