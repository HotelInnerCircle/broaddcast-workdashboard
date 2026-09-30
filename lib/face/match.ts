/**
 * Deciding whether two faces are the same person (A108).
 *
 * A face is reduced, in the browser, to a **descriptor**: 128 numbers that
 * describe it. Two descriptors of the same face sit close together; two people
 * sit far apart. "Close" is a euclidean distance below a threshold.
 *
 * **The comparison happens here, on the server, and that is the point.** The
 * browser could just as easily do the arithmetic, but then it would be telling
 * the server "yes, it matched", and a browser can say anything. Sending the 128
 * numbers and deciding here means the client reports an observation, not a
 * verdict.
 *
 * What this does *not* defend against, stated plainly because it matters: a
 * descriptor captured once can be replayed, and a photograph held up to the
 * camera produces a perfectly good descriptor of the person in the photograph.
 * Face matching raises the effort of clocking in for somebody else; it does not
 * make it impossible. The photo, the GPS fix and the approval queue remain the
 * real evidence - which is why a mismatch goes for review rather than being
 * thrown away.
 */

/** face-api.js and every model like it produce 128 numbers. */
export const DESCRIPTOR_LENGTH = 128;

/**
 * Below this distance, the same person; above, somebody else.
 *
 * 0.6 is the value face-api.js documents and the one most deployments start
 * from. It is a company setting because it is a trade: lower rejects the person
 * who grew a beard, higher accepts their brother.
 */
export const DEFAULT_THRESHOLD = 0.6;

export type FaceVerdict = "matched" | "mismatch" | "unverified";

export interface FaceComparison {
  verdict: FaceVerdict;
  /** Euclidean distance, or null when there was nothing to compare against. */
  distance: number | null;
  threshold: number;
}

/**
 * Is this actually a descriptor?
 *
 * Length and finiteness, and a sane range - the values a face model emits sit
 * near zero, so anything wild is a client sending nonsense rather than a face.
 */
export function isDescriptor(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === DESCRIPTOR_LENGTH &&
    value.every((n) => typeof n === "number" && Number.isFinite(n) && n >= -10 && n <= 10)
  );
}

/** Straight-line distance between two descriptors. Smaller is more alike. */
export function distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < DESCRIPTOR_LENGTH; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * The average of several captures, which is what gets enrolled.
 *
 * One photograph carries whatever that moment happened to be - a shadow, an odd
 * angle, a blink. Averaging three or four gives something closer to the face
 * rather than to one picture of it, and measurably fewer false rejections later.
 */
export function averageDescriptors(samples: number[][]): number[] {
  if (samples.length === 0) throw new Error("No samples to average");
  const out = new Array<number>(DESCRIPTOR_LENGTH).fill(0);
  for (const s of samples) for (let i = 0; i < DESCRIPTOR_LENGTH; i++) out[i] += s[i];
  return out.map((n) => n / samples.length);
}

/**
 * Compare a fresh capture against what was enrolled.
 *
 * Returns "unverified" rather than "mismatch" when there is nothing enrolled or
 * nothing was captured. The difference matters: nobody should be treated as an
 * impostor because they have not enrolled yet, or because their phone could not
 * find a face in poor light.
 */
export function compareFace(
  captured: unknown,
  enrolled: unknown,
  threshold = DEFAULT_THRESHOLD,
): FaceComparison {
  if (!isDescriptor(captured) || !isDescriptor(enrolled)) {
    return { verdict: "unverified", distance: null, threshold };
  }
  const d = distance(captured, enrolled);
  return { verdict: d <= threshold ? "matched" : "mismatch", distance: Math.round(d * 1000) / 1000, threshold };
}

/** How close it was, for a person rather than a machine. */
export function confidenceLabel(c: FaceComparison): string {
  if (c.verdict === "unverified" || c.distance === null) return "Not checked";
  if (c.verdict === "matched") return c.distance < c.threshold * 0.6 ? "Confident match" : "Match";
  return c.distance > c.threshold * 1.5 ? "Clearly somebody else" : "Not recognised";
}

/**
 * Which of these people is this (A126)?
 *
 * The phone never needs this: somebody is signed in, so the question is only
 * whether the face matches the one account. A device at a door has nobody
 * signed in and has to pick a person out of everybody - a different problem
 * that gets harder with every hire, because more faces means more chances that
 * two of them are close enough to confuse.
 *
 * Two guards, and the second matters more than the first:
 *
 * - **A stricter threshold than the phone uses.** Being wrong here marks the
 *   wrong person present, where being wrong on a phone only fails to confirm
 *   somebody who is already signed in.
 * - **A margin.** The closest face must be clearly closer than the second
 *   closest. Two candidates nearly as good as each other is exactly what
 *   siblings, cousins and bad light produce, and the honest answer then is "I
 *   do not know" - which sends somebody to their phone instead of recording a
 *   day against the wrong name.
 */
export interface Candidate { userId: string; descriptor: number[] }

export interface Identification {
  /** Who it is, or null when nobody was close enough or two were too alike. */
  userId: string | null;
  distance: number | null;
  /** How much better the best was than the next best; null when there is no next. */
  margin: number | null;
  reason: "matched" | "no-match" | "ambiguous" | "no-face" | "nobody-enrolled";
}

/**
 * How much clearer the winner has to be than the runner-up.
 *
 * Small enough that an ordinary face with an ordinary second-place is accepted,
 * large enough that two genuinely similar faces are refused rather than guessed
 * between.
 */
export const DEFAULT_MARGIN = 0.08;

export function identifyFace(
  captured: unknown,
  candidates: Candidate[],
  opts: { threshold?: number; margin?: number } = {},
): Identification {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const margin = opts.margin ?? DEFAULT_MARGIN;

  if (!isDescriptor(captured)) return { userId: null, distance: null, margin: null, reason: "no-face" };
  const usable = candidates.filter((c) => isDescriptor(c.descriptor));
  if (usable.length === 0) return { userId: null, distance: null, margin: null, reason: "nobody-enrolled" };

  const ranked = usable
    .map((c) => ({ userId: c.userId, d: distance(captured, c.descriptor) }))
    .sort((a, b) => a.d - b.d);

  const best = ranked[0];
  const next = ranked[1] ?? null;
  const gap = next ? Math.round((next.d - best.d) * 1000) / 1000 : null;
  const dist = Math.round(best.d * 1000) / 1000;

  if (best.d > threshold) return { userId: null, distance: dist, margin: gap, reason: "no-match" };
  // Only when there is somebody to be confused with. One enrolled person cannot
  // be ambiguous, and refusing them for having no runner-up would be absurd.
  if (next && next.d - best.d < margin) return { userId: null, distance: dist, margin: gap, reason: "ambiguous" };

  return { userId: best.userId, distance: dist, margin: gap, reason: "matched" };
}
