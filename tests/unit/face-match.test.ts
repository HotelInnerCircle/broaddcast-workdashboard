/**
 * Deciding whether two faces are the same person.
 *
 * This decides whether somebody's attendance is accepted, questioned or sent
 * for review, so both ways of being wrong cost something real: too strict and a
 * person who grew a beard cannot clock in, too loose and their brother can.
 *
 * The cases below are about the *shape* of the decision rather than about real
 * faces - whether a malformed descriptor is refused, whether "nothing enrolled"
 * is distinguished from "not you", whether the threshold does what it says.
 * Those are the parts that can be got wrong silently.
 */
import { describe, it, expect } from "vitest";
import {
  compareFace, distance, isDescriptor, averageDescriptors,
  confidenceLabel, DESCRIPTOR_LENGTH, DEFAULT_THRESHOLD,
} from "@/lib/face/match";

/** A descriptor filled with one value, for arithmetic that is easy to check. */
const flat = (v: number) => new Array(DESCRIPTOR_LENGTH).fill(v);
/** A descriptor a known distance away from another. */
const offsetBy = (base: number[], d: number) => base.map((n, i) => (i === 0 ? n + d : n));

describe("what counts as a descriptor", () => {
  it("accepts 128 sensible numbers", () => {
    expect(isDescriptor(flat(0.1))).toBe(true);
    expect(isDescriptor(flat(-0.4))).toBe(true);
  });

  it.each([
    ["too short", new Array(127).fill(0)],
    ["too long", new Array(129).fill(0)],
    ["empty", []],
    ["not an array", { 0: 1 }],
    ["null", null],
    ["undefined", undefined],
    ["a string", "0.1,0.2"],
    ["strings inside", new Array(DESCRIPTOR_LENGTH).fill("0.1")],
    ["a NaN", [Number.NaN, ...new Array(127).fill(0)]],
    ["an Infinity", [Number.POSITIVE_INFINITY, ...new Array(127).fill(0)]],
    ["wildly out of range", [1e9, ...new Array(127).fill(0)]],
  ])("refuses %s", (_why, value) => {
    expect(isDescriptor(value)).toBe(false);
  });
});

describe("distance", () => {
  it("is zero between a descriptor and itself", () => {
    expect(distance(flat(0.2), flat(0.2))).toBe(0);
  });

  it("grows with the difference", () => {
    const base = flat(0);
    expect(distance(base, offsetBy(base, 0.3))).toBeCloseTo(0.3, 6);
    expect(distance(base, offsetBy(base, 0.9))).toBeCloseTo(0.9, 6);
  });

  it("does not care which way round the two are given", () => {
    const a = flat(0.1), b = offsetBy(a, 0.45);
    expect(distance(a, b)).toBeCloseTo(distance(b, a), 9);
  });
});

describe("the verdict", () => {
  const enrolled = flat(0);

  it("matches a face close to the enrolled one", () => {
    const c = compareFace(offsetBy(enrolled, 0.2), enrolled);
    expect(c.verdict).toBe("matched");
    expect(c.distance).toBeCloseTo(0.2, 3);
  });

  it("refuses one that is far away", () => {
    expect(compareFace(offsetBy(enrolled, 1.2), enrolled).verdict).toBe("mismatch");
  });

  it("treats exactly the threshold as a match, not a rejection", () => {
    // Somebody standing exactly on the line should be let in, not accused.
    const c = compareFace(offsetBy(enrolled, DEFAULT_THRESHOLD), enrolled);
    expect(c.verdict).toBe("matched");
  });

  it("follows a threshold the company has changed", () => {
    const captured = offsetBy(enrolled, 0.5);
    expect(compareFace(captured, enrolled, 0.4).verdict).toBe("mismatch");
    expect(compareFace(captured, enrolled, 0.8).verdict).toBe("matched");
  });

  /*
   * The distinction that matters most. "Unverified" is not "mismatch": somebody
   * who has never enrolled, or whose phone could not find a face in bad light,
   * has not been caught doing anything. Collapsing the two would accuse them.
   */
  it("says unverified when nothing is enrolled", () => {
    const c = compareFace(flat(0.1), null);
    expect(c.verdict).toBe("unverified");
    expect(c.distance).toBeNull();
  });

  it("says unverified when no face was captured", () => {
    expect(compareFace(null, enrolled).verdict).toBe("unverified");
    expect(compareFace(undefined, enrolled).verdict).toBe("unverified");
  });

  it("says unverified rather than throwing on rubbish from a client", () => {
    for (const junk of ["", 0, [], {}, [1, 2, 3], new Array(128).fill("x")]) {
      expect(() => compareFace(junk, enrolled)).not.toThrow();
      expect(compareFace(junk, enrolled).verdict).toBe("unverified");
    }
  });

  it("reports the threshold it used, so a decision can be explained later", () => {
    expect(compareFace(flat(0.1), enrolled, 0.42).threshold).toBe(0.42);
  });
});

describe("enrolling from several captures", () => {
  it("averages them", () => {
    const avg = averageDescriptors([flat(0), flat(1), flat(2)]);
    expect(avg.every((n) => Math.abs(n - 1) < 1e-9)).toBe(true);
  });

  it("is closer to all of the samples than any single one is to the others", () => {
    // Which is the reason for averaging: one capture carries whatever that
    // moment happened to be, and the average carries the face.
    // Spread in one direction, as a run of captures in changing light tends to
    // be. Symmetric samples would make the average equal the first one and the
    // test would prove nothing.
    const samples = [flat(0), offsetBy(flat(0), 0.4), offsetBy(flat(0), 0.8)];
    const avg = averageDescriptors(samples);
    const worstFromAverage = Math.max(...samples.map((s) => distance(s, avg)));
    const worstFromFirst = Math.max(...samples.map((s) => distance(s, samples[0])));
    expect(worstFromAverage).toBeLessThan(worstFromFirst);
  });

  it("refuses to average nothing", () => {
    expect(() => averageDescriptors([])).toThrow();
  });
});

describe("what a person is told", () => {
  const enrolled = flat(0);
  it("puts it in words rather than a number", () => {
    expect(confidenceLabel(compareFace(offsetBy(enrolled, 0.1), enrolled))).toBe("Confident match");
    expect(confidenceLabel(compareFace(offsetBy(enrolled, 0.5), enrolled))).toBe("Match");
    expect(confidenceLabel(compareFace(offsetBy(enrolled, 0.8), enrolled))).toBe("Not recognised");
    expect(confidenceLabel(compareFace(offsetBy(enrolled, 2), enrolled))).toBe("Clearly somebody else");
    expect(confidenceLabel(compareFace(null, enrolled))).toBe("Not checked");
  });
});
