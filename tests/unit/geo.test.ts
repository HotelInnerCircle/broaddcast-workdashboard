import { describe, expect, it } from "vitest";
import { distanceMeters, isValidCoord } from "@/lib/geo";

const BLR = { lat: 12.9716, lng: 77.5946 };

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    expect(distanceMeters(BLR, BLR)).toBe(0);
  });

  it("makes 0.001 degrees of latitude about 111 m", () => {
    const d = distanceMeters(BLR, { lat: 12.9726, lng: 77.5946 });
    expect(d).toBeGreaterThanOrEqual(105);
    expect(d).toBeLessThanOrEqual(118);
  });

  it("measures the straight line to Mysuru, not the road", () => {
    // ~128 km as the crow flies; the ~140 km figure people quote is the drive.
    const d = distanceMeters(BLR, { lat: 12.2958, lng: 76.6394 });
    expect(d).toBeGreaterThan(125_000);
    expect(d).toBeLessThan(131_000);
  });

  it("is symmetric", () => {
    const b = { lat: 12.29, lng: 76.63 };
    expect(distanceMeters(BLR, b)).toBe(distanceMeters(b, BLR));
  });

  it("stays sane across the equator and the date line", () => {
    expect(distanceMeters({ lat: -1, lng: 179.9 }, { lat: 1, lng: -179.9 })).toBeLessThan(250_000);
  });
});

describe("isValidCoord", () => {
  it("accepts a real coordinate", () => {
    expect(isValidCoord(12.97, 77.59)).toBe(true);
  });

  it("rejects null island, which is a device with no fix", () => {
    expect(isValidCoord(0, 0)).toBe(false);
  });

  it("rejects NaN, out-of-range and non-numbers", () => {
    expect(isValidCoord(NaN, 10)).toBe(false);
    expect(isValidCoord(91, 10)).toBe(false);
    expect(isValidCoord(10, 181)).toBe(false);
    expect(isValidCoord("12.9" as unknown as number, 77)).toBe(false);
  });
});
