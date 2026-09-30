/**
 * The two things a device at a door needs that a phone does not: working out
 * *who* walked up, and telling a face from a photograph of one.
 *
 * Both are arithmetic over numbers a model already produced, so both can be
 * tested without a camera. What is pinned here is the judgement in them - when
 * to refuse rather than guess - because that is the part that decides whether a
 * day lands against the right name.
 */
import { describe, it, expect } from "vitest";
import { identifyFace, DEFAULT_MARGIN, type Candidate } from "@/lib/face/match";
import { eyeAspectRatio, blinkRatio, BlinkWatcher, EYES_OPEN, EYES_SHUT, type Point } from "@/lib/face/liveness";

/** A descriptor that is all one value - far enough from another to be a different person. */
const face = (v: number): number[] => Array.from({ length: 128 }, () => v);
/** Nudge every value, so the distance from the original is predictable. */
const near = (base: number[], by: number): number[] => base.map((n) => n + by);

describe("picking a person out of everybody", () => {
  const priya = face(0.1);
  const arjun = face(0.5);
  const people: Candidate[] = [
    { userId: "priya", descriptor: priya },
    { userId: "arjun", descriptor: arjun },
  ];

  it("recognises somebody who is enrolled", () => {
    const out = identifyFace(near(priya, 0.001), people);
    expect(out.reason).toBe("matched");
    expect(out.userId).toBe("priya");
  });

  it("refuses a face nobody enrolled", () => {
    // Far from everyone: a visitor, a delivery driver, somebody's friend.
    const out = identifyFace(face(5), people);
    expect(out.reason).toBe("no-match");
    expect(out.userId).toBeNull();
  });

  it("says so rather than guessing between two people who look alike", () => {
    /*
     * The case this whole margin exists for. Two enrolled faces almost equally
     * close is what siblings and bad light produce, and picking the nearer of
     * the two would mark the wrong person present - with a photograph and a
     * timestamp to make it look deliberate.
     */
    const twin = near(priya, 0.0005);
    const out = identifyFace(near(priya, 0.0002), [
      { userId: "priya", descriptor: priya },
      { userId: "twin", descriptor: twin },
    ]);
    expect(out.reason).toBe("ambiguous");
    expect(out.userId).toBeNull();
  });

  it("does not call one enrolled person ambiguous", () => {
    // With nobody to be confused with, there is nothing to be unsure about.
    const out = identifyFace(near(priya, 0.001), [{ userId: "priya", descriptor: priya }]);
    expect(out.reason).toBe("matched");
  });

  it("reports the margin so a refusal can be explained afterwards", () => {
    const out = identifyFace(near(priya, 0.001), people);
    expect(typeof out.margin).toBe("number");
    expect(out.margin as number).toBeGreaterThan(DEFAULT_MARGIN);
  });

  it("refuses nonsense in place of a face", () => {
    expect(identifyFace("not a face", people).reason).toBe("no-face");
    expect(identifyFace([1, 2, 3], people).reason).toBe("no-face");
  });

  it("says when nobody has enrolled at all", () => {
    expect(identifyFace(priya, []).reason).toBe("nobody-enrolled");
  });

  it("a stricter threshold refuses what a loose one accepts", () => {
    const far = near(priya, 0.05);
    expect(identifyFace(far, people, { threshold: 0.9 }).reason).toBe("matched");
    expect(identifyFace(far, people, { threshold: 0.1 }).reason).toBe("no-match");
  });
});

describe("telling a face from a photograph of one", () => {
  /** Six points around an eye, `open` tall and 1 wide. */
  const eye = (open: number): Point[] => [
    { x: 0, y: 0 }, { x: 0.3, y: -open / 2 }, { x: 0.7, y: -open / 2 },
    { x: 1, y: 0 }, { x: 0.7, y: open / 2 }, { x: 0.3, y: open / 2 },
  ];

  it("reads an open eye as round and a shut one as a line", () => {
    expect(eyeAspectRatio(eye(0.6))).toBeGreaterThan(EYES_OPEN);
    expect(eyeAspectRatio(eye(0.02))).toBeLessThan(EYES_SHUT);
  });

  it("does not change when somebody steps closer to the camera", () => {
    /*
     * The ratio is height over width, so moving nearer scales both and leaves
     * it alone. Without that, walking towards the door would read as a blink.
     */
    const near2 = eye(0.6);
    const far = near2.map((p) => ({ x: p.x * 3, y: p.y * 3 }));
    expect(eyeAspectRatio(far)).toBeCloseTo(eyeAspectRatio(near2), 6);
  });

  it("averages both eyes", () => {
    expect(blinkRatio(eye(0.6), eye(0.6))).toBeCloseTo(eyeAspectRatio(eye(0.6)), 6);
  });

  it("ignores a wrong number of points instead of throwing", () => {
    expect(eyeAspectRatio([{ x: 0, y: 0 }])).toBe(0);
  });

  it("a photograph never passes, however long it is held up", () => {
    // Eyes open in every frame, for ever: that is what a picture is.
    const w = new BlinkWatcher();
    let last = w.push(0.3);
    for (let i = 0; i < 50; i++) last = w.push(0.3);
    expect(last.state).not.toBe("alive");
  });

  it("a photograph of somebody with their eyes shut never passes either", () => {
    const w = new BlinkWatcher();
    let last = w.push(0.05);
    for (let i = 0; i < 50; i++) last = w.push(0.05);
    expect(last.state).not.toBe("alive");
  });

  it("a real blink passes", () => {
    // Open, shut, open - three phases, in that order, which is what a blink is.
    const w = new BlinkWatcher();
    w.push(0.3); w.push(0.3);
    w.push(0.05);
    const out = w.push(0.3);
    expect(out.state).toBe("alive");
  });

  it("gives up rather than waiting for ever", () => {
    let clock = 0;
    const w = new BlinkWatcher(() => clock);
    w.push(0.3);
    clock = 7000;
    expect(w.push(0.3).state).toBe("timeout");
  });

  it("starts again cleanly for the next person", () => {
    let clock = 0;
    const w = new BlinkWatcher(() => clock);
    w.push(0.3); w.push(0.05); w.push(0.3);
    clock = 100;
    w.reset();
    // A fresh attempt must not inherit the last person's blink.
    expect(w.push(0.3).state).toBe("waiting");
  });
});
