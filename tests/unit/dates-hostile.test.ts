/**
 * Date formatters must not throw, whatever they are handed.
 *
 * This is here because of a production incident. `RelativeTime` called
 * `.toISOString()` on whatever it was given, and `relativeTime` handed the same
 * value to date-fns. Both raise on an unparseable date - `RangeError: Invalid
 * time value` - and the component renders on a list of thirty audit entries, so
 * **one bad timestamp anywhere in a page's data replaced the whole page with a
 * server-side exception**. The employee detail page went down that way.
 *
 * The rule these tests hold: a record with a bad date should *look* wrong, never
 * be unreachable. Every case below is one that threw before the fix.
 */
import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, relativeTime, isoOrNull } from "@/lib/utils/dates";

/** Values that have all reached a formatter at some point, or plausibly could. */
const HOSTILE: Array<[string, unknown]> = [
  ["null", null],
  ["undefined", undefined],
  ["an empty string", ""],
  ["an Invalid Date", new Date("not a date")],
  ["an unparseable string", "N/A"],
  ["a stored timestamp as a number", 1759000000000],
  ["a number that is not a time", Number.NaN],
  ["an object", {}],
  ["an array", []],
  ["a boolean", true],
  ["whitespace", "   "],
];

describe("nothing a formatter is handed can take a page down", () => {
  it.each(HOSTILE)("formatDate survives %s", (_label, value) => {
    expect(() => formatDate(value as never)).not.toThrow();
    expect(typeof formatDate(value as never)).toBe("string");
  });

  it.each(HOSTILE)("formatDateTime survives %s", (_label, value) => {
    expect(() => formatDateTime(value as never)).not.toThrow();
  });

  it.each(HOSTILE)("relativeTime survives %s", (_label, value) => {
    expect(() => relativeTime(value as never)).not.toThrow();
    expect(typeof relativeTime(value as never)).toBe("string");
  });

  it.each(HOSTILE)("isoOrNull survives %s", (_label, value) => {
    expect(() => isoOrNull(value as never)).not.toThrow();
  });

  it("survives a hostile value with a timezone too", () => {
    expect(() => formatDate(new Date("x"), "Asia/Kolkata")).not.toThrow();
    expect(() => formatDateTime("nonsense", "Asia/Kolkata")).not.toThrow();
  });
});

describe("and they still do their job", () => {
  const when = new Date("2026-09-26T09:30:00.000Z");

  it("formats a real date", () => {
    expect(formatDate(when, "UTC")).toBe("26 Sep 2026");
    expect(formatDateTime(when, "UTC")).toBe("26 Sep 2026, 09:30 AM");
  });

  it("accepts a timestamp as readily as a Date", () => {
    expect(formatDate(when.getTime(), "UTC")).toBe("26 Sep 2026");
    expect(isoOrNull(when.getTime())).toBe(when.toISOString());
  });

  it("accepts an ISO string", () => {
    expect(isoOrNull("2026-09-26T09:30:00.000Z")).toBe(when.toISOString());
  });

  it("says 'never' when there is nothing, not a broken date", () => {
    expect(relativeTime(null)).toBe("never");
    expect(relativeTime(new Date("x"))).toBe("never");
  });

  it("gives null rather than a bad ISO string", () => {
    expect(isoOrNull(new Date("x"))).toBeNull();
    expect(isoOrNull("N/A")).toBeNull();
  });

  it("reads the clock for something recent", () => {
    expect(relativeTime(new Date())).toBe("Just now");
  });
});
