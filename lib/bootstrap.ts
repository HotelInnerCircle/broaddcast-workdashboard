import { connectDB } from "@/lib/db/connect";
import { Plan } from "@/models/Plan";
import { User } from "@/models/User";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { env } from "@/lib/env";

/**
 * Platform bootstrap (A60): runs once at server start and only fills what is missing, so a fresh
 * database is usable without any seed script - the Super Admin from .env can sign in and create
 * companies, and the default plans exist for new companies. Existing records are never modified,
 * except that the Super Admin's password follows SUPERADMIN_PASSWORD so it can be rotated from .env.
 */
const DEFAULT_PLANS = [
  { name: "Starter", limits: { users: 10, projects: 10, clients: 5, storageMB: 1024 }, features: ["timer", "attendance", "reports"], price: 0, isDefault: true },
  { name: "Business", limits: { users: 50, projects: 100, clients: 50, storageMB: 10240 }, features: ["timer", "attendance", "reports", "chat", "exports"], price: 2999, isDefault: false },
  { name: "Enterprise", limits: { users: 1000, projects: 5000, clients: 1000, storageMB: 102400 }, features: ["timer", "attendance", "reports", "chat", "exports", "audit-viewer", "priority-support"], price: 9999, isDefault: false },
];

export async function bootstrapPlatform(): Promise<void> {
  // The first DNS/SRV lookup can fail transiently right after boot; keep trying for a while.
  for (let attempt = 1; ; attempt++) {
    try { await connectDB(); break; } catch (e) {
      if (attempt >= 10) throw e;
      console.warn(`[bootstrap] database not reachable yet (attempt ${attempt}/10): ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  if ((await Plan.countDocuments()) === 0) {
    await Plan.insertMany(DEFAULT_PLANS.map((p) => ({ ...p, currency: "INR", billingCycle: "monthly" })));
    console.log("[bootstrap] created default plans (Starter / Business / Enterprise)");
  }

  const email = env.SUPERADMIN_EMAIL.trim().toLowerCase();
  const password = env.SUPERADMIN_PASSWORD;
  if (!email || !password) {
    if ((await User.countDocuments({ role: "SUPER_ADMIN" })) === 0) console.warn("[bootstrap] no SUPER_ADMIN exists and SUPERADMIN_EMAIL/PASSWORD are not set - nobody can create companies");
    return;
  }
  const existing = await User.findOne({ email }).select("+passwordHash");
  if (!existing) {
    await User.create({ name: "Platform Admin", email, role: "SUPER_ADMIN", companyId: null, status: "active", passwordHash: await hashPassword(password), joiningDate: new Date() });
    console.log(`[bootstrap] created SUPER_ADMIN ${email}`);
  } else if (existing.role === "SUPER_ADMIN") {
    if (!(await verifyPassword(password, existing.passwordHash))) {
      await User.updateOne({ _id: existing._id }, { $set: { passwordHash: await hashPassword(password) } });
      console.log(`[bootstrap] SUPER_ADMIN password updated from .env for ${email}`);
    }
  }
}
