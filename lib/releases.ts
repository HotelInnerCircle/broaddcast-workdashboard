import { env } from "@/lib/env";

/**
 * Reads the latest built apps out of the GitHub release they were published to (A82).
 *
 * The repository is private, so its release assets cannot be linked to directly - GitHub would ask
 * the person to sign in. Instead `/download/<platform>` asks the API for a short-lived signed URL
 * and redirects to it, which means the file never travels through this server: no bandwidth cost
 * and no risk of a serverless function timing out on a 90 MB installer.
 */
export type Platform = "android" | "windows";

export interface ReleaseAsset {
  platform: Platform;
  name: string;
  size: number;
  id: number;
}
export interface Release {
  tag: string;
  publishedAt: string | null;
  assets: ReleaseAsset[];
}

const API = "https://api.github.com";

function platformOf(name: string): Platform | null {
  const n = name.toLowerCase();
  if (n.endsWith(".apk")) return "android";
  if (n.endsWith(".exe")) return "windows";
  return null;
}

/** The token is only needed for a private repo; a public one answers without it. */
function headers(accept = "application/vnd.github+json"): Record<string, string> {
  return {
    ...(env.GITHUB_RELEASES_TOKEN ? { Authorization: `Bearer ${env.GITHUB_RELEASES_TOKEN}` } : {}),
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** The newest published release, or null when releases are not configured or none exists yet. */
export async function latestRelease(): Promise<Release | null> {
  if (!env.GITHUB_RELEASES_REPO) return null;
  try {
    // Cached for five minutes: the download page is public, and a release changes rarely.
    const res = await fetch(`${API}/repos/${env.GITHUB_RELEASES_REPO}/releases/latest`, {
      headers: headers(),
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      tag_name?: string;
      published_at?: string | null;
      assets?: { id: number; name: string; size: number }[];
    };
    const assets = (json.assets ?? []).flatMap((a) => {
      const platform = platformOf(a.name);
      return platform ? [{ platform, name: a.name, size: a.size, id: a.id }] : [];
    });
    return { tag: json.tag_name ?? "", publishedAt: json.published_at ?? null, assets };
  } catch {
    // A download page that renders without the buttons beats one that 500s.
    return null;
  }
}

/** A temporary, signed URL for that platform's file, or null if there is no such asset. */
export async function assetDownloadUrl(platform: Platform): Promise<string | null> {
  const release = await latestRelease();
  const asset = release?.assets.find((a) => a.platform === platform);
  if (!asset) return null;

  // `application/octet-stream` makes the API answer with a redirect to signed storage rather than
  // with the asset's JSON. We want that Location, not the bytes.
  const res = await fetch(`${API}/repos/${env.GITHUB_RELEASES_REPO}/releases/assets/${asset.id}`, {
    headers: headers("application/octet-stream"),
    redirect: "manual",
    cache: "no-store",
  });
  return res.headers.get("location");
}
