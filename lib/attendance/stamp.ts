import sharp from "sharp";

/**
 * Burns the time and place onto an attendance photo, server-side (A83, restyled A85).
 *
 * Doing this on the phone would be pointless: anything a client draws, a client can fake. The
 * server stamps from the same values it writes to the database, so the picture and the record can
 * never disagree - and a photo taken outside the app and uploaded later still carries the server's
 * timestamp, not one chosen by whoever sent it.
 *
 * The band sits at the **top**, where a face does not, and where every attendance app people
 * already know puts it.
 */
export interface StampInfo {
  brand: string;
  /** "Priya Nair - ON DUTY" */
  title: string;
  /** "25/09/2026 12:59:19 PM" - seconds always, because a minute is a long time at a gate. */
  when: string;
  /** "17.417131, 78.451736  +/-8 m" */
  coords: string;
  /** "Head Office - inside (42 m)" */
  place: string;
}
export interface StampResult { buffer: Buffer; contentType: string; width: number; height: number }

const MAX_WIDTH = 1080; // phone cameras produce 12 MP files; nobody needs that to see a face

const esc = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** A map pin drawn as a path: no emoji, so no dependency on which fonts the host happens to have. */
const pin = (x: number, y: number, size: number, fill: string) => {
  const k = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${k})" fill="${fill}">` +
    `<path d="M12 0C7 0 3 4 3 9c0 6.6 9 15 9 15s9-8.4 9-15c0-5-4-9-9-9zm0 12.2A3.2 3.2 0 1 1 12 5.8a3.2 3.2 0 0 1 0 6.4z"/></g>`;
};

export async function stampPhoto(input: Buffer, info: StampInfo): Promise<StampResult> {
  // `rotate()` with no argument applies the EXIF orientation, so portrait photos are not sideways.
  const base = await sharp(input).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).toBuffer();
  const meta = await sharp(base).metadata();
  const width = meta.width ?? MAX_WIDTH;
  const height = meta.height ?? MAX_WIDTH;

  const pad = Math.max(10, Math.round(width * 0.028));
  const size = Math.max(12, Math.round(width * 0.029));
  const line = Math.round(size * 1.4);
  const boxHeight = line * 4 + pad * 2;
  const font = `font-family="DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif"`;
  const pinSize = Math.round(size * 1.05);

  const y = (n: number) => pad + line * n + size;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${boxHeight}">` +
    `<rect width="${width}" height="${boxHeight}" fill="#000000" fill-opacity="0.55"/>` +
    // Brand, right-aligned on the first line.
    `<text x="${width - pad}" y="${y(0)}" text-anchor="end" font-size="${size}" font-weight="700" fill="#f6c46a" ${font}>${esc(info.brand)}</text>` +
    `<text x="${pad}" y="${y(0)}" font-size="${size}" font-weight="700" fill="#ffffff" ${font}>${esc(info.title)}</text>` +
    `<text x="${pad}" y="${y(1)}" font-size="${size}" font-weight="600" fill="#ffffff" ${font}>${esc(info.when)}</text>` +
    pin(pad, y(2) - size * 0.95, pinSize, "#6ee7a8") +
    `<text x="${pad + pinSize + Math.round(size * 0.35)}" y="${y(2)}" font-size="${size}" font-weight="500" fill="#e8f7ee" ${font}>${esc(info.coords)}</text>` +
    `<text x="${pad}" y="${y(3)}" font-size="${size}" font-weight="500" fill="#ffffff" fill-opacity="0.92" ${font}>${esc(info.place)}</text>` +
    `</svg>`;

  const buffer = await sharp(base)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return { buffer, contentType: "image/jpeg", width, height };
}
