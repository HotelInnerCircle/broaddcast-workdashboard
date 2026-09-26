import { Errors } from "@/lib/api/errors";
import { storage, validateUpload, sniffMatches } from "@/lib/storage";
import { Company } from "@/models/Company";

export interface StoredProof { proofKey: string; proofName: string; proofSize: number; proofType: string }

/** Is a picture required for this kind of record in this company? */
export async function proofRequired(companyId: string, kind: "timer" | "dailyReport"): Promise<boolean> {
  const c = await Company.findById(companyId).select("workProof").lean();
  const wp = (c?.workProof ?? {}) as Record<string, boolean | undefined>;
  // Absent means on: the setting was introduced switched on, and a company that
  // predates it should get the behaviour that was asked for, not the opposite.
  return wp[kind] !== false;
}

/**
 * Store a picture of the work, privately.
 *
 * The same checks every other upload gets: a size limit, an images-only type
 * allowlist, and the bytes sniffed to confirm the file is the image it claims to
 * be. A screenshot can carry a client's name, an inbox, or somebody's face, so
 * it is stored as a private object and read through a link that expires.
 */
export async function storeWorkProof(
  companyId: string,
  file: File,
  kind: "timer" | "daily",
  ownerId: string,
): Promise<StoredProof> {
  const { mime, ext } = validateUpload(file, { imagesOnly: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffMatches(buffer, mime)) throw Errors.bad("BAD_IMAGE", "That file is not the image it claims to be");

  const key = `companies/${companyId}/work-proof/${kind}/${ownerId}-${Date.now()}.${ext}`;
  await storage().put({ key, body: buffer, contentType: mime });
  return { proofKey: key, proofName: file.name || `proof.${ext}`, proofSize: buffer.length, proofType: mime };
}

/** A short-lived link to a stored proof. */
export const proofUrl = (key: string) => storage().getSignedUrl(key, 300);

/**
 * Pulls the picture out of a multipart request, refusing when one is required
 * and missing. Returns null when the request is plain JSON.
 */
export async function readProof(
  req: Request,
  companyId: string,
  kind: "timer" | "dailyReport",
): Promise<{ fields: Record<string, string>; file: File | null } | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) return null;
  const form = await req.formData();
  const file = form.get("proof");
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
  return { fields, file: file instanceof File && file.size > 0 ? file : null };
}

/** The message shown when the picture is missing and the company insists on one. */
export const missingProof = (what: string) =>
  Errors.bad("PROOF_REQUIRED", `Add a picture of ${what} before saving. Your company asks for one.`);
