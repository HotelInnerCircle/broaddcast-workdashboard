import ImageKit from "imagekit";
import { env } from "@/lib/env";
import type { StorageDriver } from "./types";

/**
 * ImageKit driver (A54). Every object is uploaded as a *private* file at `/<key>` inside the
 * media library, so it is only reachable through the signed URLs this driver mints - the same
 * contract the local driver honours. Keys keep their `companies/<id>/...` prefix, which maps to an
 * ImageKit folder, so deleting a company removes its whole folder in one call.
 */
export function imagekitDriver(): StorageDriver {
  if (!env.IMAGEKIT_PUBLIC_KEY || !env.IMAGEKIT_PRIVATE_KEY || !env.IMAGEKIT_URL_ENDPOINT) {
    throw new Error("File storage needs IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT in .env");
  }
  const ik = new ImageKit({ publicKey: env.IMAGEKIT_PUBLIC_KEY, privateKey: env.IMAGEKIT_PRIVATE_KEY, urlEndpoint: env.IMAGEKIT_URL_ENDPOINT });
  const split = (key: string) => {
    const i = key.lastIndexOf("/");
    return { folder: i >= 0 ? `/${key.slice(0, i)}` : "/", name: i >= 0 ? key.slice(i + 1) : key };
  };
  // fileIds of objects uploaded by this process: deleting them needs no search round-trip.
  const ids = new Map<string, string>();
  const remember = (key: string, fileId: string) => { ids.set(key, fileId); if (ids.size > 5000) ids.delete(ids.keys().next().value as string); };
  // ImageKit's search index lags ~1s behind uploads; searching by name is consistent much sooner
  // than listing by folder, so look up by name, match the exact path, and retry briefly.
  const findFileId = async (key: string): Promise<string | null> => {
    const cached = ids.get(key);
    if (cached) return cached;
    const { name } = split(key);
    for (let attempt = 0; attempt < 4; attempt++) {
      const files = (await ik.listFiles({ searchQuery: `name = "${name.replace(/"/g, "")}"`, limit: 20 })) as Array<{ fileId: string; filePath: string }>;
      const hit = files.find((f) => f.filePath === `/${key}`);
      if (hit) return hit.fileId;
      await new Promise((r) => setTimeout(r, 750));
    }
    return null;
  };
  return {
    async put({ key, body }) {
      const { folder, name } = split(key);
      // useUniqueFileName=false keeps the path deterministic so the key alone identifies the object.
      const res = await ik.upload({ file: body, fileName: name, folder, useUniqueFileName: false, isPrivateFile: true });
      remember(key, res.fileId);
      return { key };
    },
    async getSignedUrl(key, expiresInSec = 3600) {
      return ik.url({ path: `/${key}`, signed: true, expireSeconds: expiresInSec });
    },
    async delete(key) {
      const fileId = await findFileId(key).catch(() => null);
      ids.delete(key);
      if (fileId) await ik.deleteFile(fileId).catch(() => { /* already gone */ });
    },
    async deletePrefix(prefix) {
      await ik.deleteFolder(prefix.replace(/^\/+|\/+$/g, "")).catch((e: { message?: string }) => {
        // A folder that never received an upload does not exist - nothing to remove.
        if (!/not\s*found|does not exist/i.test(e?.message ?? "")) throw e;
      });
    },
  };
}
