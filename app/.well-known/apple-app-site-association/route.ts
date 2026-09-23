import { NextResponse } from "next/server";

/**
 * iOS universal links (A65): lets the iOS app open app.broaddcast.com links directly.
 * Set IOS_TEAM_ID (Apple Developer team) once the app exists; app id is <TeamID>.com.broaddcast.workpulse.
 */
export function GET() {
  const team = process.env.IOS_TEAM_ID;
  if (!team) return NextResponse.json({ applinks: { apps: [], details: [] } }, { headers: { "content-type": "application/json", "Cache-Control": "public, max-age=300" } });
  const appID = `${team}.com.broaddcast.workpulse`;
  return NextResponse.json(
    { applinks: { apps: [], details: [{ appID, paths: ["*"] }] }, webcredentials: { apps: [appID] } },
    { headers: { "content-type": "application/json", "Cache-Control": "public, max-age=3600" } },
  );
}
