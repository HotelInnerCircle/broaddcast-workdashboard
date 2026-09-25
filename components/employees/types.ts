export interface EmployeeRow {
  /** A90: the shift this person is on, or null for the company hours. */
  shiftId: string | null;
  id: string; name: string; email: string; role: string; roleLabel: string; status: string; avatarUrl: string | null;
  phone: string | null; department: string | null; designation: string | null; joiningDate: string | null; lastActiveAt: string | null;
  team: { id: string; name: string } | null; manager: { id: string; name: string } | null; createdAt: string;
}
export interface TeamOption { id: string; name: string; lead: { id: string; name: string } | null; manager: { id: string; name: string } | null; memberCount: number; description: string | null }
export interface InviteRow { id: string; email: string; role: string; team: string | null; expiresAt: string; lastSentAt: string | null; createdAt: string }
