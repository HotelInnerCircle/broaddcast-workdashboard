import type { Role, SessionContext } from "@/types";

declare module "next-auth" {
  interface Session {
    user: SessionContext & { id: string };
  }
  interface User {
    id?: string;
    role: Role;
    companyId: string | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    sid?: string;
    ctx?: SessionContext;
  }
}
