/**
 * Single place for product branding (spec section 1). Change the name/logo/colors here only.
 * Colors are also declared as CSS variables in app/globals.css (keep them in sync).
 */
export const brand = {
  name: "WorkPulse",
  tagline: "Work management & time tracking for modern teams",
  logoText: "WP",
  /** Public URL of a logo image, or null to render the text mark. */
  logoUrl: null as string | null,
  supportEmail: "support@workpulse.local",
  primaryHex: "#8a5a3c",
} as const;
