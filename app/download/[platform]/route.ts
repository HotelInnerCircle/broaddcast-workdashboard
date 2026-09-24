import { assetDownloadUrl, type Platform } from "@/lib/releases";

/**
 * `/download/android` and `/download/windows` (A82): the two links handed to staff. Each one looks
 * up the file in the latest release and redirects to a short-lived signed URL, so the binary is
 * never streamed through this server.
 *
 * When there is nothing to hand out the answer is a redirect back to `/download`, not an error
 * body: somebody following a link is a person, and a page that explains why beats raw JSON.
 *
 * The redirect back is deliberately a **relative** Location, built with no reference to APP_URL or
 * to the request URL. An absolute one has to be constructed, and constructing it is what failed in
 * production - a 500 with an empty body for every platform, including ones that never reach the
 * release lookup. A relative Location is valid HTTP, the browser resolves it against the request,
 * and there is nothing left that can throw.
 */
export const dynamic = "force-dynamic";

const PLATFORMS: Platform[] = ["android", "windows"];

function backToPage(query = "") {
  return new Response(null, {
    status: 302,
    headers: { Location: `/download${query}`, "Cache-Control": "no-store" },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ platform: string }> }) {
  try {
    const { platform } = await params;
    if (!PLATFORMS.includes(platform as Platform)) return backToPage();

    const url = await assetDownloadUrl(platform as Platform);
    if (!url) return backToPage(`?unavailable=${platform}`);

    // The signed URL expires, so this redirect must never be cached.
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
  } catch {
    // A download link must never answer with a blank 500. Send them to the page instead.
    return backToPage();
  }
}
