import { NextResponse } from "next/server";

/**
 * Digital Asset Links (A64): lets the Android TWA wrapper open this site full-screen without the
 * browser bar. Fill ANDROID_PACKAGE_NAME and ANDROID_CERT_SHA256 (the signing certificate's SHA-256
 * fingerprint from Play Console -> App signing) once the Android package exists.
 */
export function GET() {
  const pkg = process.env.ANDROID_PACKAGE_NAME;
  const sha = (process.env.ANDROID_CERT_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!pkg || sha.length === 0) return NextResponse.json([], { headers: { "Cache-Control": "public, max-age=300" } });
  return NextResponse.json([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: sha } }], { headers: { "Cache-Control": "public, max-age=3600" } });
}
