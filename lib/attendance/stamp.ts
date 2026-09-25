import sharp from "sharp";

/**
 * Burns the time and place onto an attendance photo, server-side (A83).
 *
 * Doing this on the phone would be pointless: anything the client draws, the client can fake. The
 * server stamps from the same values it writes to the database, so the picture and the record can
 * never disagree - and a photo taken out of the app and uploaded later still carries the server's
 * timestamp, not one chosen by whoever sent it.
 */
export interface StampResult { buffer: Buffer; contentType: string; width: number; height: number }

const MAX_WIDTH = 1080; // phone cameras produce 12 MP files; nobody needs that to see a face

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export async function stampPhoto(input: Buffer, lines: string[]): Promise<StampResult> {
  // `rotate()` with no argument applies the EXIF orientation, so portrait photos are not sideways.
  const base = await sharp(input).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).toBuffer();
  const meta = await sharp(base).metadata();
  const width = meta.width ?? MAX_WIDTH;
  const height = meta.height ?? MAX_WIDTH;

  const pad = Math.max(10, Math.round(width * 0.028));
  const size = Math.max(13, Math.round(width * 0.031));
  const lineHeight = Math.round(size * 1.42);
  const boxHeight = lines.length * lineHeight + pad * 2;

  const text = lines
    .map((line, i) => {
      const y = pad + lineHeight * i + size;
      const weight = i === 0 ? "700" : "500";
      return `<text x="${pad}" y="${y}" font-size="${size}" font-weight="${weight}" fill="#ffffff" font-family="DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif">${escapeXml(line)}</text>`;
    })
    .join("");

  const banner = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${boxHeight}">` +
      `<rect x="0" y="0" width="${width}" height="${boxHeight}" fill="#000000" fill-opacity="0.62"/>` +
      text +
      `</svg>`,
  );

  const buffer = await sharp(base)
    .composite([{ input: banner, top: Math.max(0, height - boxHeight), left: 0 }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return { buffer, contentType: "image/jpeg", width, height };
}
