import { env } from "@/lib/env";
import { Errors } from "@/lib/api/errors";
import { imagekitDriver } from "./imagekit";
import type { StorageDriver } from "./types";

/** ImageKit is the only storage backend (A54, local driver removed on 22 Sep 2026). Created lazily so a missing key fails at first use with a clear message. */
let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) driver = imagekitDriver();
  return driver;
}

/** Upload rules (spec 3.4): allowed types, extension + MIME must agree, size cap. */
const ALLOWED: Record<string, string[]> = {
  "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/webp": ["webp"], "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
};
const MAGIC: Array<{ mime: string; bytes: number[] }> = [
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
];

export function validateUpload(file: File, opts: { imagesOnly?: boolean } = {}): { ext: string; mime: string } {
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size === 0) throw Errors.bad("EMPTY_FILE", "The file is empty");
  if (file.size > maxBytes) throw Errors.bad("FILE_TOO_LARGE", `Files must be at most ${env.MAX_UPLOAD_MB} MB`);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type.toLowerCase();
  const allowed = ALLOWED[mime];
  if (!allowed || !allowed.includes(ext)) throw Errors.bad("UNSUPPORTED_FILE", "Unsupported file type");
  if (opts.imagesOnly && !mime.startsWith("image/")) throw Errors.bad("UNSUPPORTED_FILE", "Only PNG, JPG or WEBP images are allowed");
  return { ext, mime };
}

export function sniffMatches(buffer: Buffer, mime: string): boolean {
  const rule = MAGIC.find((m) => m.mime === mime);
  if (!rule) return mime === "image/webp" ? buffer.subarray(0, 4).toString("ascii") === "RIFF" : true;
  return rule.bytes.every((b, i) => buffer[i] === b);
}
