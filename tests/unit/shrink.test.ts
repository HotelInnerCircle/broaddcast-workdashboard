/**
 * Shrinking a picture in the browser, before it is uploaded.
 *
 * The tests run under node, where there is no canvas, so they cover the two
 * things that can actually break an upload rather than the encoder itself:
 *
 * - **The name and the type have to agree.** The server refuses a file whose
 *   extension does not match its MIME, so a PNG re-encoded as a JPEG and still
 *   called `.png` is a 400 - the upload fails and the person is told their file
 *   type is unsupported, which it is not.
 * - **Nothing may throw.** Every path out of `shrinkImage` returns a usable
 *   file. An old browser, a codec the canvas will not read, a missing context:
 *   all of them fall back to the original and let the server shrink it.
 *
 * The last case is what running under node exercises for free: with no
 * `document` at all, a five megabyte photograph must come back untouched rather
 * than blowing up.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { shrinkImage, shrinkable, rename, shrinkLabel } from "@/lib/images/shrink";

const file = (name: string, type: string, bytes: number) =>
  new File([new Uint8Array(bytes)], name, { type });

afterEach(() => { vi.unstubAllGlobals(); });

describe("what it will touch", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("shrinks %s", (mime) => {
    expect(shrinkable(file("a.jpg", mime, 10))).toBe(true);
  });

  it.each(["application/pdf", "image/gif", "text/plain", ""])("leaves %s alone", (mime) => {
    // A GIF matters: re-encoding it through a canvas would keep the first frame
    // and silently throw the animation away.
    expect(shrinkable(file("a.bin", mime, 10))).toBe(false);
  });

  it("matches on the type whatever the name says", () => {
    expect(shrinkable(file("screenshot.pdf", "image/png", 10))).toBe(true);
  });
});

describe("the naming, which the server is strict about", () => {
  it("rewrites the extension to match the bytes", () => {
    expect(rename("holiday.png", "image/jpeg")).toBe("holiday.jpg");
    expect(rename("scan.WEBP", "image/jpeg")).toBe("scan.jpg");
    expect(rename("logo.jpg", "image/png")).toBe("logo.png");
  });

  it("keeps the rest of the name, dots and all", () => {
    expect(rename("site.visit.2026.png", "image/jpeg")).toBe("site.visit.2026.jpg");
  });

  it("invents a name when there is not one", () => {
    expect(rename("", "image/jpeg")).toBe("photo.jpg");
    expect(rename(".png", "image/jpeg")).toBe("photo.jpg");
  });

  it("does not mistake a long word after a dot for an extension", () => {
    // Five characters is the longest extension we write; anything longer is
    // part of the name and must survive.
    expect(rename("report.september", "image/jpeg")).toBe("report.september.jpg");
  });
});

describe("never breaking an upload", () => {
  it("returns the original when there is no browser to do it in", async () => {
    const big = file("photo.jpg", "image/jpeg", 5_000_000);
    const out = await shrinkImage(big, "proof");
    expect(out).toBe(big);
  });

  it("returns the original for a document", async () => {
    const pdf = file("payslip.pdf", "application/pdf", 400_000);
    expect(await shrinkImage(pdf, "attachment")).toBe(pdf);
  });

  it("does not bother with something already small", async () => {
    const small = file("icon.png", "image/png", 4_000);
    expect(await shrinkImage(small, "attachment")).toBe(small);
  });

  it("still processes a small logo, because it is about the width not the bytes", async () => {
    // A 40 KB logo can still be 3000px wide. Under a stubbed browser this gets
    // as far as asking for a canvas; with none, it falls back to the original.
    const logo = file("logo.png", "image/png", 40_000);
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    vi.stubGlobal("createImageBitmap", async () => ({ width: 3000, height: 800, close() {} }));
    expect(await shrinkImage(logo, "logo")).toBe(logo);
  });

  it("returns the original when the canvas hands back nothing", async () => {
    const big = file("photo.jpg", "image/jpeg", 5_000_000);
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(_v: string) {} }),
        toBlob: (cb: (b: Blob | null) => void) => cb(null),
      }),
    });
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close() {} }));
    expect(await shrinkImage(big, "proof")).toBe(big);
  });

  it("returns the original when the decoder throws", async () => {
    const big = file("photo.jpg", "image/jpeg", 5_000_000);
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    vi.stubGlobal("createImageBitmap", async () => { throw new Error("unsupported codec"); });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    vi.stubGlobal("Image", class { decoding = "sync"; naturalWidth = 0; onerror: (() => void) | null = null; onload: (() => void) | null = null; set src(_v: string) { setTimeout(() => this.onerror?.(), 0); } });
    expect(await shrinkImage(big, "proof")).toBe(big);
  });
});

describe("what comes back when it works", () => {
  /** A canvas that reports whatever size it was asked for and returns `bytes`. */
  function stubCanvas(bytes: number) {
    let asked: { w: number; h: number } = { w: 0, h: 0 };
    vi.stubGlobal("document", {
      createElement: () => ({
        set width(v: number) { asked.w = v; },
        set height(v: number) { asked.h = v; },
        getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(_v: string) {} }),
        toBlob: (cb: (b: Blob | null) => void, type: string) => cb(new Blob([new Uint8Array(bytes)], { type })),
      }),
    });
    return () => asked;
  }

  it("comes back as a JPEG, named like one", async () => {
    stubCanvas(180_000);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close() {} }));
    const out = await shrinkImage(file("DSC_0491.PNG", "image/png", 5_000_000), "proof");
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("DSC_0491.jpg");
    expect(out.size).toBe(180_000);
  });

  it("scales to the preset width and keeps the shape", async () => {
    const asked = stubCanvas(120_000);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close() {} }));
    await shrinkImage(file("photo.jpg", "image/jpeg", 5_000_000), "proof");
    expect(asked()).toEqual({ w: 1280, h: 960 });
  });

  it("uses a smaller box for an avatar than for an attachment", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 3000, height: 3000, close() {} }));
    const a = stubCanvas(50_000);
    await shrinkImage(file("me.jpg", "image/jpeg", 4_000_000), "avatar");
    expect(a().w).toBe(512);
    const b = stubCanvas(50_000);
    await shrinkImage(file("x.jpg", "image/jpeg", 4_000_000), "attachment");
    expect(b().w).toBe(1920);
  });

  it("keeps a logo a PNG, so its transparency survives", async () => {
    stubCanvas(30_000);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 2000, height: 600, close() {} }));
    const out = await shrinkImage(file("brand.png", "image/png", 900_000), "logo");
    expect(out.type).toBe("image/png");
    expect(out.name).toBe("brand.png");
  });

  it("never enlarges an image that is already under the target", async () => {
    const asked = stubCanvas(90_000);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 800, height: 600, close() {} }));
    await shrinkImage(file("photo.jpg", "image/jpeg", 300_000), "attachment");
    expect(asked()).toEqual({ w: 800, h: 600 });
  });

  it("keeps the original when re-encoding at the same size made it bigger", async () => {
    // Already under the target width, and the re-encode came out larger: there
    // is nothing to gain by sending the bigger one.
    stubCanvas(400_000);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 900, height: 600, close() {} }));
    const original = file("photo.jpg", "image/jpeg", 300_000);
    expect(await shrinkImage(original, "attachment")).toBe(original);
  });

  it("accepts a bigger file when it did shrink the pixels", async () => {
    // A 4000px PNG re-encoded to 1920px can still be larger in bytes for a flat
    // graphic; the pixel count is the thing that was costing the storage.
    stubCanvas(400_000);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 2000, close() {} }));
    const out = await shrinkImage(file("chart.png", "image/png", 300_000), "attachment");
    expect(out.name).toBe("chart.jpg");
  });
});

describe("saying what it saved", () => {
  it("reads in the units a person thinks in", () => {
    expect(shrinkLabel(4_800_000, 180_000)).toBe("4.6 MB to 176 KB");
    expect(shrinkLabel(90_000, 90_000)).toBe("88 KB");
  });
});
