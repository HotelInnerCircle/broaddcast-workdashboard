/**
 * Telling a face from a photograph of a face (A126).
 *
 * On somebody's own phone this barely mattered: the worst they could do with a
 * printed photo is fake their own attendance. A device at a door is different -
 * anybody can hold up a picture of a colleague, and the record it writes says
 * "verified", with a timestamp and a photograph, which is worse than no record
 * because it looks like evidence.
 *
 * The check is a blink. A photograph does not blink, and a person asked to blink
 * can do it in about a second without being taught anything. Held up to a video
 * on a second phone it can be beaten - that is a real limit and worth knowing -
 * but it stops the attack anybody would actually try, which is a photo.
 *
 * Nothing here talks to a model. It takes the 68 landmarks face-api already
 * produces and does arithmetic on them, so all of it can be tested without a
 * browser or a camera.
 */

/** A landmark, as face-api gives them. */
export interface Point { x: number; y: number }

/**
 * Eye aspect ratio: eye height over eye width.
 *
 * An open eye is round - the ratio sits near 0.3. A closed one is a line, and
 * the ratio collapses towards zero. Dividing by the width is what makes it work
 * at any distance from the camera: somebody stepping closer makes both numbers
 * bigger and leaves the ratio alone.
 *
 * The six points are face-api's, in its order: two corners and four lid points.
 */
export function eyeAspectRatio(eye: Point[]): number {
  if (eye.length !== 6) return 0;
  const [p0, p1, p2, p3, p4, p5] = eye;
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = dist(p0, p3);
  if (width === 0) return 0;
  return (dist(p1, p5) + dist(p2, p4)) / (2 * width);
}

/** Both eyes together, which is steadier than either alone. */
export function blinkRatio(left: Point[], right: Point[]): number {
  return (eyeAspectRatio(left) + eyeAspectRatio(right)) / 2;
}

/**
 * Below this the eyes are shut, above it they are open.
 *
 * Between the two is the hysteresis that stops a half-lidded frame being
 * counted as a blink: a blink has to go properly closed and properly open
 * again, not hover.
 */
export const EYES_SHUT = 0.19;
export const EYES_OPEN = 0.25;

/** How long somebody is given to blink before the attempt is abandoned. */
export const BLINK_WINDOW_MS = 6000;

export type LivenessState = "waiting" | "closing" | "alive" | "timeout";

export interface LivenessProgress {
  state: LivenessState;
  /** What to put in front of the person, in their terms. */
  message: string;
}

/**
 * Watches a run of frames for a blink.
 *
 * A blink is open, then shut, then open again - three phases, in that order.
 * Counting "shut" alone would let a photograph of somebody with their eyes
 * closed through, and counting "open" alone is every photograph ever taken.
 *
 * Deliberately a small state machine rather than a frame buffer: it holds two
 * booleans, so it cannot leak and cannot be fooled by replaying old frames.
 */
export class BlinkWatcher {
  private sawOpen = false;
  private sawShut = false;
  private startedAt: number;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = this.now();
  }

  /** Start again - a new person at the door, or a fresh attempt. */
  reset(): void {
    this.sawOpen = false;
    this.sawShut = false;
    this.startedAt = this.now();
  }

  /** Feed one frame's ratio. Returns where the attempt stands. */
  push(ratio: number): LivenessProgress {
    if (this.now() - this.startedAt > BLINK_WINDOW_MS) {
      return { state: "timeout", message: "Did not see a blink. Look at the camera and try again." };
    }
    if (ratio >= EYES_OPEN) {
      // Open after shut is the far side of a blink, and the only way to finish.
      if (this.sawShut && this.sawOpen) return { state: "alive", message: "Thank you" };
      this.sawOpen = true;
      return { state: this.sawShut ? "closing" : "waiting", message: "Blink once" };
    }
    if (ratio <= EYES_SHUT && this.sawOpen) {
      this.sawShut = true;
      return { state: "closing", message: "Blink once" };
    }
    return { state: this.sawOpen ? "waiting" : "waiting", message: "Blink once" };
  }
}
