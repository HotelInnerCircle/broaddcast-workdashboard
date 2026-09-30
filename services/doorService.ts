import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { DoorDevice } from "@/models/DoorDevice";
import { WorkSite } from "@/models/WorkSite";
import { User } from "@/models/User";
import { generateToken, hashToken } from "@/lib/utils/tokens";
import { identifyFace, DEFAULT_MARGIN } from "@/lib/face/match";
import { faceSettings } from "./faceService";
import type { CompanyContext } from "@/lib/auth/context";

/**
 * Devices at doors (A126).
 *
 * A door device is trusted to do exactly two things: work out which employee is
 * standing in front of it, and record a swipe for them at its own site. It
 * cannot read anybody's record, cannot approve anything, and cannot act outside
 * the company it was registered in. That narrowness is deliberate - a tablet on
 * a wall is the least physically secure thing this system has, and it should be
 * the least powerful.
 */

/** What a device is allowed to be, once its token has been recognised. */
export interface DeviceContext {
  companyId: string;
  deviceId: string;
  deviceName: string;
  siteId: string;
}

/**
 * Register one, and hand back its token.
 *
 * The token is returned here and nowhere else, ever. Losing it means
 * registering the device again, which is a minute of somebody's time and the
 * correct trade for not keeping a working key in a database.
 */
export async function registerDoorDevice(
  ctx: CompanyContext,
  input: { name: string; siteId: string },
  ip: string | null,
) {
  if (!Types.ObjectId.isValid(input.siteId)) throw Errors.bad("BAD_SITE", "Pick a work site for this device");
  const site = await scoped(WorkSite, ctx).findOne({ _id: new Types.ObjectId(input.siteId) }).select("name").lean();
  if (!site) throw Errors.notFound("Work site");

  const token = generateToken(32);
  const device = await scoped(DoorDevice, ctx).create({
    name: input.name.trim(),
    siteId: site._id,
    tokenHash: hashToken(token),
    createdBy: new Types.ObjectId(ctx.userId),
  });

  await audit({
    ctx, companyId: ctx.companyId, entity: "doorDevice", entityId: device._id,
    action: "door_device.registered",
    summary: `${ctx.name} registered the door device "${input.name}" at ${site.name}`,
    after: { name: input.name, site: site.name }, ip,
  });

  return { id: String(device._id), name: device.name, siteName: site.name as string, token };
}

/** The devices this company has, and where they are. */
export async function listDoorDevices(ctx: CompanyContext) {
  const rows = await scoped(DoorDevice, ctx).find({ revokedAt: null })
    // The site lives behind the tenant guard too, so it is populated the way
    // everything else here populates across it.
    .populate(pop("siteId", "name")).sort({ createdAt: -1 }).lean();
  return rows.map((d) => ({
    id: String(d._id),
    name: d.name as string,
    siteName: ((d.siteId as unknown as { name?: string })?.name) ?? "Unknown site",
    active: Boolean(d.active),
    lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt as Date).toISOString() : null,
  }));
}

/**
 * Stop trusting one.
 *
 * Immediate, because the reason somebody revokes a door device is that it has
 * walked out of the building.
 */
export async function revokeDoorDevice(ctx: CompanyContext, id: string, ip: string | null) {
  if (!Types.ObjectId.isValid(id)) throw Errors.notFound("Device");
  const device = await scoped(DoorDevice, ctx).findOne({ _id: new Types.ObjectId(id) });
  if (!device) throw Errors.notFound("Device");
  device.active = false;
  device.revokedAt = new Date();
  await device.save();
  await audit({
    ctx, companyId: ctx.companyId, entity: "doorDevice", entityId: device._id,
    action: "door_device.revoked", summary: `${ctx.name} revoked the door device "${device.name}"`, ip,
  });
  return { revoked: true };
}

/**
 * Turn a device token into what it is allowed to do, or nothing.
 *
 * Unscoped on purpose: the token is what identifies the company, so there is no
 * tenant to scope by until it has been recognised. It is looked up by the hash
 * of the token, which is indexed, and the company comes back off the row.
 */
export async function resolveDevice(token: string | null | undefined): Promise<DeviceContext | null> {
  if (!token) return null;
  const device = await DoorDevice.findOne({ tokenHash: hashToken(token), active: true, revokedAt: null })
    .setOptions({ skipTenantGuard: true } as never)
    .select("companyId name siteId").lean();
  if (!device) return null;
  return {
    companyId: String(device.companyId),
    deviceId: String(device._id),
    deviceName: device.name as string,
    siteId: String(device.siteId),
  };
}

/** Noted on a schedule rather than every frame - a door device polls constantly. */
const SEEN_INTERVAL_MS = 5 * 60_000;
export function touchDevice(deviceId: string, lastSeenAt: Date | null): void {
  if (lastSeenAt && Date.now() - lastSeenAt.getTime() < SEEN_INTERVAL_MS) return;
  void DoorDevice.updateOne({ _id: new Types.ObjectId(deviceId) }, { $set: { lastSeenAt: new Date() } })
    .setOptions({ skipTenantGuard: true } as never)
    .catch(() => {});
}

/**
 * Which employee is this?
 *
 * Only faces a person has approved are candidates (A120): an enrolment nobody
 * has looked at is a face the camera chose, and a door that recognised one of
 * those would be recording attendance against whoever happened to enrol first.
 *
 * The threshold is tightened here relative to the phone. Being wrong at a door
 * marks the wrong person present; being wrong on a phone only fails to confirm
 * somebody who is already signed in, which is a far smaller mistake.
 */
export async function identifyAtDoor(device: DeviceContext, descriptor: unknown) {
  const settings = await faceSettings(device.companyId);
  const people = await User.find({
    companyId: new Types.ObjectId(device.companyId),
    faceApproval: "approved",
    archivedAt: null,
    status: { $ne: "deactivated" },
  }).setOptions({ skipTenantGuard: true } as never)
    .select("+faceDescriptor name employeeCode").lean();

  const candidates = people
    .filter((p) => Array.isArray(p.faceDescriptor))
    .map((p) => ({ userId: String(p._id), descriptor: p.faceDescriptor as number[] }));

  const found = identifyFace(descriptor, candidates, {
    // A door has to be surer than a phone does.
    threshold: Math.min(settings.threshold, 0.5),
    margin: DEFAULT_MARGIN,
  });

  if (!found.userId) return { ...found, user: null };
  const who = people.find((p) => String(p._id) === found.userId);
  return {
    ...found,
    user: who ? { id: String(who._id), name: who.name as string, employeeCode: (who.employeeCode as string | null) ?? null } : null,
  };
}
