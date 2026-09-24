import { NextResponse } from "next/server";
import { assetDownloadUrl, type Platform } from "@/lib/releases";

/**
 * `/download/android` and `/download/windows` (A82): the two links handed to staff. Each one looks
 * up the file in the latest release and redirects to a short-lived signed URL, so the binary is
 * never streamed through this server.
 */
export const dynamic = "force-dynamic";

const PLATFORMS: Platform[] = ["android", "windows"];

export async function GET(_req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }

  const url = await assetDownloadUrl(platform as Platform);
  if (!url) {
    return NextResponse.json(
      { error: "That app has not been published yet." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  // The signed URL expires, so this redirect must never be cached.
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
}
