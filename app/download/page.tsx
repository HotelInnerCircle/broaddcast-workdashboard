import Link from "next/link";
import { cookies } from "next/headers";
import { Apple, Download, Globe, Monitor, Smartphone, ShieldAlert } from "lucide-react";
import { brand } from "@/config/brand";
import { env } from "@/lib/env";
import { sessionCookieName } from "@/lib/auth/cookies";
import { latestRelease, type Platform } from "@/lib/releases";
import { BrandMark } from "@/components/layout/brand-mark";
import { Card, CardContent } from "@/components/ui/card";

/** Read at request time, so changing where the files are hosted does not need a rebuild. */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Get the app",
  description: `Install ${brand.name} on Android and Windows.`,
};

/**
 * The one public link staff are given (A82): `/download`. It is outside the auth gate on purpose -
 * somebody who has not signed in yet still has to be able to fetch the app.
 *
 * The file URLs come from env rather than being hard-coded, so where the binaries are hosted can
 * change (a GitHub release, object storage, this domain) without touching the page. Unset means the
 * platform simply says it is not published yet, instead of offering a link that 404s.
 */
export default async function DownloadPage({ searchParams }: { searchParams: Promise<{ unavailable?: string }> }) {
  // Normally the files come from the latest release, reached through /download/<platform>. The
  // env vars stay as an override, for the day they are hosted somewhere else.
  const release = await latestRelease();
  const asset = (platform: Platform) => release?.assets.find((a) => a.platform === platform);
  const link = (platform: Platform, override: string) => override || (asset(platform) ? `/download/${platform}` : "");
  const android = link("android", env.DOWNLOAD_ANDROID_URL);
  const windows = link("windows", env.DOWNLOAD_WINDOWS_URL);
  const version = env.DOWNLOAD_VERSION || release?.tag || "";
  const published = release?.publishedAt ? new Date(release.publishedAt) : null;

  // Somebody already signed in must not be sent to /login - middleware would bounce them straight
  // back to their dashboard, which looks like the download page refusing to open. Cookie presence
  // is enough here; this only decides where a link points.
  const signedIn = (await cookies()).has(sessionCookieName());

  // Somebody followed /download/<platform> before that app was published.
  const asked = (await searchParams).unavailable;
  const unavailable = asked === "android" ? "Android" : asked === "windows" ? "Windows" : null;
  const appHref = signedIn ? "/" : "/login";

  return (
    <main className="min-h-dvh px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <BrandMark />
          <Link href={appHref} className="text-sm font-semibold text-primary hover:underline">{signedIn ? `Open ${brand.name}` : "Sign in"}</Link>
        </div>

        <h1 className="mt-10 font-display text-[38px] leading-[1.08] sm:text-[46px]">Get {brand.name}</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          The apps are the same {brand.name} you use in the browser, in their own window.{" "}
          {signedIn ? "You are signed in already" : "Sign in with the account you already have"}{version ? ` · ${version}` : ""}{published ? ` · published ${published.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.
        </p>

        {unavailable && (
          <p className="mt-6 flex items-start gap-3 rounded-2xl bg-warning-soft px-5 py-4 text-[13.5px] leading-relaxed text-tile-warning-fg">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>The {unavailable} app has not been published yet. It will appear here as soon as it is built.</span>
          </p>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <PlatformCard
            tone="bg-[#2f6b3a]"
            icon={<Smartphone className="size-[22px]" />}
            title="Android"
            detail={["Phone or tablet, Android 7 and up", fileSize(asset("android")?.size)].filter(Boolean).join(" - ")}
            href={android}
            cta="Download APK"
            note="Your phone will ask you to allow installing from this source - that is expected for an app you install directly rather than from the Play Store."
          />
          <PlatformCard
            tone="bg-[#4f5d7a]"
            icon={<Monitor className="size-[22px]" />}
            title="Windows"
            detail={["Windows 10 and 11, 64-bit", fileSize(asset("windows")?.size)].filter(Boolean).join(" - ")}
            href={windows}
            cta="Download installer"
            note="Windows may show a blue &ldquo;Windows protected your PC&rdquo; screen. Choose More info, then Run anyway."
          />
        </div>

        <Card className="mt-4">
          <CardContent className="flex items-start gap-4 p-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
              <Globe className="size-[21px]" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">Or install straight from your browser</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
                Nothing to download. On a phone, open {brand.name} in Chrome and choose <b>Add to Home screen</b>.
                On a computer, open it in Chrome or Edge and click the <b>Install</b> icon in the address bar.
                You get the same app in its own window, and it updates by itself.
              </p>
              <Link href={appHref} className="mt-2.5 inline-block text-[13.5px] font-semibold text-primary hover:underline">
                Open {brand.name} in this browser
              </Link>
            </div>
          </CardContent>
        </Card>

        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-info-soft px-5 py-4 text-[13px] leading-relaxed text-tile-info-fg">
          <Apple className="mt-0.5 size-4 shrink-0" />
          <p>
            <b>iPhone and iPad:</b> open {brand.name} in Safari, tap Share, then <b>Add to Home Screen</b>.
            Apple only allows apps through the App Store, so there is no file to download.
          </p>
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} {brand.name}
        </p>
      </div>
    </main>
  );
}

/** Bytes as something a person reads, e.g. "92 MB". Absent size simply drops off the line. */
function fileSize(bytes?: number): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

function PlatformCard({ tone, icon, title, detail, href, cta, note }: {
  tone: string; icon: React.ReactNode; title: string; detail: string;
  href: string; cta: string; note: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <span className={`flex size-11 items-center justify-center rounded-full text-white ${tone}`}>{icon}</span>
        <p className="mt-3.5 text-[17px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{detail}</p>

        {href ? (
          <a
            href={href}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-[14.5px] font-bold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="size-[18px]" />
            {cta}
          </a>
        ) : (
          <p className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-muted text-[13.5px] font-semibold text-muted-foreground">
            <ShieldAlert className="size-4" />
            Not published yet
          </p>
        )}

        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}
