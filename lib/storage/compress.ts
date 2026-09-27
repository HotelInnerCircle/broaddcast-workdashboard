import sharp from "sharp";

/**
 * Shrinking an uploaded image before it is stored (A109).
 *
 * A phone takes a 12 megapixel photograph, four or five megabytes of it, and
 * every one of those bytes was being kept. An avatar shown at forty pixels was
 * stored at four thousand. Two work-proof pictures a day, fifty people, twenty
 * working days: eleven gigabytes a month to display images nobody ever views at
 * more than a few hundred pixels.
 *
 * So every image is resized and re-encoded on the way in. The original is not
 * kept - deliberately. Keeping both is how storage bills grow quietly, and there
 * is no use here that wants the raw file.
 *
 * Two things fall out of doing this that are worth having on their own:
 *
 * - **EXIF is dropped.** A photograph from a phone carries the coordinates it
 *   was taken at. A chat attachment should not quietly tell everybody in the
 *   channel where somebody lives. sharp writes no metadata unless asked, so
 *   re-encoding removes it.
 * - **Orientation is applied first.** `rotate()` with no argument bakes in the
 *   EXIF orientation, so a portrait photo is not stored sideways once the EXIF
 *   that described it has gone.
 */

export type ImagePreset = "avatar" | "proof" | "attachment" | "logo";

interface Recipe { width: number; quality: number; format: "jpeg" | "png" }

/**
 * What each kind of image is actually for, in pixels.
 *
 * Sized by where it is shown rather than by a single global number: an avatar
 * renders at forty pixels and never needs more than five hundred; a screenshot
 * of somebody's work has to stay readable, so it keeps more.
 */
const RECIPES: Record<ImagePreset, Recipe> = {
  avatar: { width: 512, quality: 82, format: "jpeg" },
  proof: { width: 1280, quality: 72, format: "jpeg" },
  attachment: { width: 1920, quality: 78, format: "jpeg" },
  // A logo keeps its transparency, so it stays PNG and is never flattened.
  logo: { width: 512, quality: 90, format: "png" },
};

export interface Compressed { buffer: Buffer; contentType: string; ext: string; width: number | null; height: number | null }

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Is this something we can and should re-encode? PDFs and documents pass through. */
export const isCompressibleImage = (mime: string) => IMAGE_TYPES.has(mime);

/**
 * Resize and re-encode. Returns the original untouched if it is not an image, or
 * if compressing somehow made it bigger.
 */
export async function compressImage(input: Buffer, mime: string, preset: ImagePreset): Promise<Compressed> {
  if (!isCompressibleImage(mime)) {
    return { buffer: input, contentType: mime, ext: mime === "application/pdf" ? "pdf" : "bin", width: null, height: null };
  }

  const recipe = RECIPES[preset];
  try {
    let pipeline = sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: recipe.width, withoutEnlargement: true });

    if (recipe.format === "png") {
      pipeline = pipeline.png({ compressionLevel: 9, palette: true });
    } else {
      // JPEG has no transparency: without flattening, anything see-through turns
      // black. White matches every surface this app puts an image on.
      pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: recipe.quality, mozjpeg: true });
    }

    const [{ data, info }, source] = await Promise.all([
      pipeline.toBuffer({ resolveWithObject: true }),
      sharp(input, { failOn: "none" }).metadata().catch(() => ({ width: 0 } as { width?: number })),
    ]);

    /*
     * A small, already-optimised image can come out *larger* after re-encoding -
     * an eight-pixel PNG icon becomes a bigger JPEG. Keep the original in that
     * case.
     *
     * "Did we actually shrink it" has to compare the output against the input,
     * not against the target: comparing to the target calls every image smaller
     * than 1920px "resized", which is every icon, and the guard never fires.
     * That is what the first version of this did, and it stored files three
     * times the size they arrived at.
     */
    const shrank = (info.width ?? 0) < (source.width ?? 0);
    if (data.length >= input.length && !shrank) {
      return { buffer: input, contentType: mime, ext: extFor(mime), width: source.width ?? null, height: null };
    }

    return {
      buffer: Buffer.from(data),
      contentType: recipe.format === "png" ? "image/png" : "image/jpeg",
      ext: recipe.format === "png" ? "png" : "jpg",
      width: info.width,
      height: info.height,
    };
  } catch {
    // A file that sharp cannot read has already passed the magic-byte check, so
    // it is stored as it came rather than refused: an upload that fails because
    // of the optimiser is worse than one that is a little large.
    return { buffer: input, contentType: mime, ext: extFor(mime), width: null, height: null };
  }
}

function extFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "application/pdf") return "pdf";
  return "jpg";
}

/** "2.4 MB to 118 KB", for a log line or a message to a person. */
export function savingLabel(before: number, after: number): string {
  const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);
  return `${kb(before)} to ${kb(after)}`;
}
