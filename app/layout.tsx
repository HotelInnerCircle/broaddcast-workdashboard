import type { Metadata, Viewport } from "next";
import { DM_Sans, Instrument_Serif } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { NativeBridge } from "@/components/layout/native-bridge";
import Script from "next/script";
import { brand } from "@/config/brand";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s | ${brand.name}` },
  description: brand.tagline,
  applicationName: brand.name,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: brand.name },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192" }, { url: "/icons/icon-512.png", sizes: "512x512" }], apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f0e8" }, { media: "(prefers-color-scheme: dark)", color: "#1a1714" }],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${dmSans.variable} ${instrumentSerif.variable}`}>
      <body className="min-h-dvh">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster richColors position="top-right" closeButton />
          <NativeBridge />
          {process.env.NODE_ENV === "production" && (
            // Inline so PWA scanners detect the registration on the page itself (A64).
            <Script id="wp-sw" strategy="afterInteractive">{`if("serviceWorker" in navigator){var r=function(){navigator.serviceWorker.register("/sw.js",{scope:"/"}).catch(function(){})};if(document.readyState==="complete"){r()}else{window.addEventListener("load",r)}}`}</Script>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
