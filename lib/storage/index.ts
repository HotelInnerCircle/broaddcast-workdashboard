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

/**
 * Pixel size of an uploaded image, read straight from the file header (A72). Stored on the
 * attachment so the chat gallery can reserve the right box and never jump as pictures load.
 * Returns nulls for anything it cannot parse - the UI falls back to a square.
 */
export function imageSize(buffer: Buffer, mime: string): { width: number | null; height: number | null } {
  const none = { width: null, height: null };
  try {
    if (mime === "image/png" && buffer.length > 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (mime === "image/webp" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
      const fmt = buffer.subarray(12, 16).toString("ascii");
      // VP8 (lossy), VP8L (lossless) and VP8X (extended) each store the size differently.
      if (fmt === "VP8 ") return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      if (fmt === "VP8L") { const b = buffer.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (fmt === "VP8X") return { width: (buffer.readUIntLE(24, 3) & 0xffffff) + 1, height: (buffer.readUIntLE(27, 3) & 0xffffff) + 1 };
      return none;
    }
    if (mime === "image/jpeg") {
      // Walk the segment chain to the SOF marker, which carries the dimensions.
      let i = 2;
      while (i + 9 < buffer.length) {
        if (buffer[i] !== 0xff) { i++; continue; }
        const marker = buffer[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) };
        i += 2 + buffer.readUInt16BE(i + 2);
      }
    }
  } catch { /* unreadable header - fall through */ }
  return none;
}
