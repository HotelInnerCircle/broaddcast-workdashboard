/**
 * Shrinking uploads before they are stored.
 *
 * Written against real images made by sharp rather than fixtures, so the sizes
 * below are what the code actually produces - the point of the whole exercise is
 * a number of kilobytes, and a test that asserts it in the abstract proves
 * nothing.
 *
 * The cases that matter are the awkward ones: a transparent PNG turning black
 * when flattened into a JPEG, a portrait photo ending up sideways once its EXIF
 * is dropped, a PDF being mangled by an image pipeline, and a tiny icon coming
 * out *larger* than it went in.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { compressImage, isCompressibleImage, savingLabel } from "@/lib/storage/compress";

/** A photograph-like image: noisy, so it does not compress unrealistically well. */
async function photo(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761) % 256;
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

const transparentPng = (size: number) =>
  sharp({ create: { width: size, height: size, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0 } } }).png().toBuffer();

describe("what gets compressed", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("compresses %s", (mime) => {
    expect(isCompressibleImage(mime)).toBe(true);
  });

  it.each(["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"])(
    "leaves %s alone", (mime) => { expect(isCompressibleImage(mime)).toBe(false); },
  );

  it("passes a PDF through byte for byte", async () => {
    const pdf = Buffer.from("%PDF-1.4\nnot really a pdf but close enough\n%%EOF");
    const out = await compressImage(pdf, "application/pdf", "attachment");
    expect(out.buffer.equals(pdf)).toBe(true);
    expect(out.contentType).toBe("application/pdf");
  });
});

describe("the size it actually comes out at", () => {
  it("turns a 12 megapixel photo into a couple of hundred kilobytes", async () => {
    const big = await photo(4000, 3000);
    const out = await compressImage(big, "image/jpeg", "proof");
    expect(big.length).toBeGreaterThan(1_000_000);
    expect(out.buffer.length).toBeLessThan(400 * 1024);
    expect(out.width).toBe(1280);
  });

  it("makes an avatar small enough to be irrelevant", async () => {
    const big = await photo(3000, 3000);
    const out = await compressImage(big, "image/jpeg", "avatar");
    expect(out.buffer.length).toBeLessThan(150 * 1024);
    expect(out.width).toBe(512);
  });

  it("keeps an attachment readable but not enormous", async () => {
    const big = await photo(4000, 2250);
    const out = await compressImage(big, "image/jpeg", "attachment");
    expect(out.width).toBe(1920);
    expect(out.buffer.length).toBeLessThan(900 * 1024);
  });

  it("does not enlarge something already smaller than the target", async () => {
    const small = await photo(300, 200);
    const out = await compressImage(small, "image/jpeg", "attachment");
    expect(out.width).toBe(300);
  });

  it("keeps the original when re-encoding would make it bigger", async () => {
    // A tiny flat image is already about as small as it gets; a JPEG of it is
    // often larger. Storing the bigger one would be absurd.
    const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer();
    const out = await compressImage(tiny, "image/png", "attachment");
    expect(out.buffer.length).toBeLessThanOrEqual(tiny.length);
  });
});

describe("the awkward cases", () => {
  it("does not turn a transparent PNG black", async () => {
    // Flattened onto white, not onto nothing: without it, everything
    // see-through becomes black and a logo turns into a rectangle.
    const png = await transparentPng(600);
    const out = await compressImage(png, "image/png", "avatar");
    const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = [data[0], data[1], data[2]];
    expect(info.channels).toBe(3);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeGreaterThan(240);
    expect(b).toBeGreaterThan(240);
  });

  it("keeps a logo as a PNG so its transparency survives", async () => {
    const png = await transparentPng(900);
    const out = await compressImage(png, "image/png", "logo");
    expect(out.contentType).toBe("image/png");
    const meta = await sharp(out.buffer).metadata();
    expect(meta.channels).toBeGreaterThanOrEqual(4);
    expect(meta.width).toBe(512);
  });

  it("applies the EXIF rotation before throwing the EXIF away", async () => {
    // Orientation 6 means "this is portrait, stored landscape". Drop the EXIF
    // without applying it and every phone photo is stored on its side.
    const landscape = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#884422" } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const out = await compressImage(landscape, "image/jpeg", "attachment");
    expect(out.width).toBe(400);
    expect(out.height).toBe(800);
  });

  it("strips the metadata, so a photo stops carrying where it was taken", async () => {
    const withExif = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#224488" } })
      .withMetadata({ exif: { IFD0: { Copyright: "somebody", Artist: "someone" } } }).jpeg().toBuffer();
    const out = await compressImage(withExif, "image/jpeg", "attachment");
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("stores a file sharp cannot read rather than refusing it", async () => {
    // It has already passed the magic-byte check by this point, so an upload
    // that fails because of the optimiser is worse than one that is a bit large.
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    const out = await compressImage(broken, "image/jpeg", "proof");
    expect(out.buffer.length).toBeGreaterThan(0);
  });
});

describe("saying what was saved", () => {
  it("reads in the units a person thinks in", () => {
    expect(savingLabel(5_200_000, 120_000)).toBe("5.0 MB to 117 KB");
    expect(savingLabel(40_000, 12_000)).toBe("39 KB to 12 KB");
  });
});
