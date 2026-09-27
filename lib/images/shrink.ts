/**
 * Shrinking a picture in the browser, before it is uploaded (A109).
 *
 * The server shrinks everything it stores, so this is not about the storage
 * bill - it is about the upload. A phone camera produces four or five megabytes.
 * On a site with one bar of signal that is a minute of waiting, sometimes a
 * failure, for a photograph that is going to be stored at a couple of hundred
 * kilobytes anyway. Doing the resize here means the phone sends the couple of
 * hundred kilobytes.
 *
 * The presets deliberately match `lib/storage/compress.ts`. Sending the same
 * size the server would have produced means the second pass has almost nothing
 * left to do, and a picture is never resized twice to two different widths.
 *
 * Nothing here is allowed to break an upload. Every failure path - an old
 * browser, a codec the canvas cannot read, a blob that comes back larger -
 * returns the original file and lets the server deal with it.
 */

export type ShrinkPreset = "avatar" | "proof" | "attachment" | "logo";

interface Recipe { width: number; quality: number; type: "image/jpeg" | "image/png" }

const RECIPES: Record<ShrinkPreset, Recipe> = {
  avatar: { width: 512, quality: 0.82, type: "image/jpeg" },
  proof: { width: 1280, quality: 0.72, type: "image/jpeg" },
  attachment: { width: 1920, quality: 0.78, type: "image/jpeg" },
  // A logo keeps its transparency, so it stays a PNG and is never drawn onto white.
  logo: { width: 512, quality: 1, type: "image/png" },
};

/** Only these are re-encoded. A GIF would lose its animation and a PDF is not an image. */
const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Below this there is nothing worth doing, and re-encoding often makes it bigger. */
const FLOOR_BYTES = 120 * 1024;

export function shrinkable(file: File): boolean {
  return SHRINKABLE.has(file.type.toLowerCase());
}

/**
 * A smaller version of the file, or the file itself.
 *
 * The name's extension is rewritten to match the bytes, because the server
 * insists the two agree - a PNG re-encoded as a JPEG and still called `.png` is
 * refused as "unsupported file type".
 */
export async function shrinkImage(file: File, preset: ShrinkPreset): Promise<File> {
  if (!shrinkable(file)) return file;
  if (file.size <= FLOOR_BYTES && preset !== "logo") return file;
  if (typeof document === "undefined") return file;

  const recipe = RECIPES[preset];
  try {
    const bitmap = await decode(file);
    if (!bitmap) return file;

    const scale = Math.min(1, recipe.width / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gc = canvas.getContext("2d");
    if (!gc) return file;
    if (recipe.type === "image/jpeg") {
      // A JPEG has no transparency: without this, anything see-through comes out
      // black. White is what every surface in the app puts an image on.
      gc.fillStyle = "#ffffff";
      gc.fillRect(0, 0, width, height);
    }
    gc.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

    const blob = await encode(canvas, recipe);
    if (!blob) return file;
    // Bigger than what we started with means the original was already better.
    if (blob.size >= file.size && scale === 1) return file;

    return new File([blob], rename(file.name, recipe.type), { type: recipe.type, lastModified: Date.now() });
  } catch {
    return file;
  }
}

/**
 * Pixels, the right way up.
 *
 * `imageOrientation: "from-image"` applies the EXIF rotation, which matters
 * because the canvas writes no EXIF at all: without it a portrait photograph
 * from a phone is uploaded on its side, and the orientation flag that would have
 * explained why is gone.
 */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Falls through to the <img> path - Safari has refused some WEBPs here.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return img.naturalWidth > 0 ? img : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, recipe: Recipe): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), recipe.type, recipe.type === "image/jpeg" ? recipe.quality : undefined);
  });
}

/** `holiday.PNG` becomes `holiday.jpg` once the bytes are a JPEG. */
export function rename(name: string, type: string): string {
  const ext = type === "image/png" ? "png" : "jpg";
  const base = (name || "photo").replace(/\.[a-z0-9]{1,5}$/i, "");
  return `${base || "photo"}.${ext}`;
}

/** "4.8 MB to 180 KB", for the line under a preview. */
export function shrinkLabel(before: number, after: number): string {
  const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);
  return after < before ? `${kb(before)} to ${kb(after)}` : kb(after);
}
