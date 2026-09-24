import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { assetDownloadUrl, type Platform } from "@/lib/releases";

/**
 * `/download/android` and `/download/windows` (A82): the two links handed to staff. Each one looks
 * up the file in the latest release and redirects to a short-lived signed URL, so the binary is
 * never streamed through this server.
 *
 * When there is nothing to hand out the answer is a redirect back to `/download`, not an error
 * body: somebody following a link is a person, and a page that explains why beats raw JSON.
 */
export const dynamic = "force-dynamic";

const PLATFORMS: Platform[] = ["android", "windows"];
const NO_STORE = { "Cache-Control": "no-store" };

function backToPage(req: Request, query = "") {
  return NextResponse.redirect(new URL(`/download${query}`, env.APP_URL || req.url), {
    status: 302,
    headers: NO_STORE,
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!PLATFORMS.includes(platform as Platform)) return backToPage(req);

  const url = await assetDownloadUrl(platform as Platform);
  if (!url) return backToPage(req, `?unavailable=${platform}`);

  // The signed URL expires, so this redirect must never be cached.
  return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
}
