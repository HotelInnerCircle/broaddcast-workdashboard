"use client";

import { DESCRIPTOR_LENGTH } from "./match";

/**
 * Turning a camera frame into 128 numbers, in the browser (A108).
 *
 * The models are served from this origin rather than a CDN, because the
 * Content-Security-Policy allows `connect-src 'self'` and nothing else - a CDN
 * fetch would simply be blocked. They are 6.5 MB in total and the browser caches
 * them, so it is one download per device rather than one per swipe.
 *
 * Everything here is lazy. Nobody who never swipes should pay for a face model,
 * so the library and the weights are fetched the first time a face is actually
 * needed, not when the app starts.
 */

type FaceApi = typeof import("@vladmandic/face-api");

let apiPromise: Promise<FaceApi> | null = null;
let modelsPromise: Promise<void> | null = null;

const MODEL_URL = "/models/face";

/** The weight files, largest first so the slow one starts immediately. */
const WEIGHTS = ["face_recognition_model.bin", "tiny_face_detector_model.bin", "face_landmark_68_tiny_model.bin"];

/**
 * How long to wait before calling it dead (A113).
 *
 * A stalled download on a phone never rejects on its own - the promise simply
 * stays pending, and the screen sits on "loading" until somebody force-closes
 * the app. Better to give up out loud after two minutes than to spin silently.
 */
const LOAD_TIMEOUT_MS = 120_000;

async function loadApi(): Promise<FaceApi> {
  apiPromise ??= import("@vladmandic/face-api").catch((e) => {
    // A rejected promise must not be cached, or every retry replays the same
    // failure without so much as attempting the download again.
    apiPromise = null;
    throw e;
  });
  return apiPromise;
}

/**
 * Downloads the weights, reporting progress.
 *
 * face-api's own `loadFromUri` gives no progress and 6.5 MB on mobile data is a
 * minute or more of a screen that appears to be doing nothing - which is
 * indistinguishable from broken, so people close the app and report it as
 * broken. The bytes are pulled here first, counted as they arrive, and then
 * `loadFromUri` is called and reads them straight out of the HTTP cache.
 */
async function fetchWeights(onProgress: (pct: number) => void, signal: AbortSignal): Promise<void> {
  let total = 0;
  let done = 0;

  await Promise.all(WEIGHTS.map(async (file) => {
    const res = await fetch(`${MODEL_URL}/${file}`, { signal });
    if (!res.ok) throw new Error(`${file} ${res.status}`);
    // The size comes off this same response rather than a HEAD beforehand: one
    // request per file instead of two, and no second round trip on a connection
    // slow enough for any of this to matter. The total grows as the three
    // responses arrive, so the early percentage is a little pessimistic and
    // never goes backwards by more than that.
    total += Number(res.headers.get("content-length") ?? 0);

    // Read to the end whether or not anyone is watching the number: an
    // unconsumed body is what the browser reports as an aborted request, and it
    // would leave nothing in the cache for loadFromUri to find.
    if (!res.body) { await res.arrayBuffer(); return; }
    const reader = res.body.getReader();
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      done += value?.length ?? 0;
      if (total) onProgress(Math.min(0.99, done / total));
    }
  }));
  onProgress(1);
}

/**
 * Fetches the three models once, and remembers that it did.
 *
 * `onProgress` runs from 0 to 1 while the weights come down. A failure clears
 * the cached promise so that pressing the button again is a real second attempt.
 */
export async function loadFaceModels(onProgress: (pct: number) => void = () => {}): Promise<void> {
  const api = await loadApi();
  modelsPromise ??= (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), LOAD_TIMEOUT_MS);
    try {
      await fetchWeights(onProgress, abort.signal);
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        api.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      await warmUp(api);
    } catch {
      // Cleared, so that pressing the button again is a real second attempt.
      // Left set, a rejected promise is handed straight back to every retry and
      // nothing is ever downloaded again until the page is reloaded.
      modelsPromise = null;
      throw new FaceModelError(abort.signal.aborted
        ? "The face model is taking too long to download. Check your connection and try again."
        : "The face model could not be downloaded. Try again in a moment.");
    } finally {
      clearTimeout(timer);
    }
  })();
  return modelsPromise;
}

/** Distinguishes a model that would not download from a camera that would not open. */
export class FaceModelError extends Error {
  constructor(message: string) { super(message); this.name = "FaceModelError"; }
}

/**
 * One throwaway inference on a blank square, while the screen still says it is
 * getting ready (A115).
 *
 * The first run of a model is far slower than every run after it: the shaders
 * are compiled and the weights are pushed to the GPU on that pass, and on a
 * phone it is the difference between twenty seconds and half a second. Paying
 * that during setup - where there is already a progress line and a person who
 * knows they are waiting - means the first Capture answers immediately instead
 * of appearing to hang on the one tap that matters.
 *
 * Its own failure is not fatal. If the warm-up cannot finish, the read that
 * follows has its own clock on it and will say so in the person's terms.
 */
async function warmUp(api: FaceApi): Promise<void> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = DETECT_SIZE;
    canvas.height = DETECT_SIZE;
    const gc = canvas.getContext("2d");
    if (!gc) return;
    gc.fillStyle = "#808080";
    gc.fillRect(0, 0, DETECT_SIZE, DETECT_SIZE);
    await withTimeout(
      () => api.detectAllFaces(canvas, new api.TinyFaceDetectorOptions({ inputSize: DETECT_SIZE, scoreThreshold: 0.4 }))
        .withFaceLandmarks(true)
        .withFaceDescriptors()
        .run(),
      READ_TIMEOUT_MS,
    );
  } catch {
    // Warming up is an optimisation. Never let it stop an enrolment.
  }
}

export type FaceReadFailure = "no-face" | "many-faces" | "too-small" | "slow" | "failed";

/**
 * How long one face read may take before it is abandoned (A115).
 *
 * Twenty seconds is far longer than the half-second this takes when the GPU
 * path is working, and short enough that somebody holding a phone up to their
 * face gets an answer rather than a spinner.
 */
const READ_TIMEOUT_MS = 20_000;

/**
 * The detector's input square. 320 rather than 416: a third less work for a
 * face that fills the frame, which is the only kind this accepts anyway - the
 * "too small" guard below rejects anything under 15% of the width.
 */
const DETECT_SIZE = 320;

const TIMED_OUT = Symbol("timed-out");

/**
 * Resolves to the work's value, or to TIMED_OUT if it takes too long or throws.
 *
 * It takes a thunk rather than a promise so the caller can hand over a chained
 * face-api task by its own `run()` - the task type is a thenable of its own and
 * is not assignable to PromiseLike.
 */
function withTimeout<T>(work: () => Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    work().then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(TIMED_OUT); },
    );
  });
}

export interface FaceRead {
  ok: boolean;
  descriptor: number[] | null;
  reason: FaceReadFailure | null;
  /** Something to show the person, in their terms rather than the model's. */
  message: string | null;
}

const MESSAGES: Record<FaceReadFailure, string> = {
  "no-face": "No face found. Hold the camera at arm's length in good light.",
  "many-faces": "More than one face in the picture. Make sure it is only you.",
  "too-small": "Come a little closer so your face fills more of the frame.",
  slow: "This device is struggling to read faces. Try once more, or use a different phone.",
  failed: "The face could not be read. Try once more.",
};

const fail = (reason: FaceReadFailure): FaceRead => ({ ok: false, descriptor: null, reason, message: MESSAGES[reason] });

/**
 * Reads the single face in an image.
 *
 * Refuses when there is more than one, deliberately: two faces in frame means
 * it is ambiguous whose attendance this is, and quietly picking the largest is
 * how somebody ends up marked present because they walked past a colleague's
 * camera.
 *
 * Never throws. A face that cannot be read is a thing to tell somebody about,
 * not an exception to handle - and the swipe still has to be possible.
 */
export async function readFace(input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<FaceRead> {
  try {
    const api = await loadApi();
    await loadFaceModels();

    /*
     * Raced against a clock (A115).
     *
     * On iOS every browser is WebKit, and tf.js on WebKit's WebGL can stop
     * dead inside an inference - not slowly, not with an error, simply never
     * resolving. The await above it then never returns, the Capture button
     * spins for ever and the only way out is to kill the app. Whatever the
     * cause, a face read that has not finished in this long is not going to,
     * and saying so is infinitely better than a spinner with no end.
     */
    const found = await withTimeout(
      () => api
        .detectAllFaces(input, new api.TinyFaceDetectorOptions({ inputSize: DETECT_SIZE, scoreThreshold: 0.4 }))
        .withFaceLandmarks(true)
        .withFaceDescriptors()
        .run(),
      READ_TIMEOUT_MS,
    );
    if (found === TIMED_OUT) return fail("slow");

    if (found.length === 0) return fail("no-face");
    if (found.length > 1) return fail("many-faces");

    const [only] = found;
    // A face smaller than this in the frame gives an unreliable descriptor, and
    // an unreliable descriptor is worse than none: it produces false mismatches.
    const box = only.detection.box;
    const frame = "videoWidth" in input ? input.videoWidth : input.width;
    if (frame && box.width < frame * 0.15) return fail("too-small");

    const descriptor = Array.from(only.descriptor as Float32Array);
    if (descriptor.length !== DESCRIPTOR_LENGTH) return fail("failed");
    return { ok: true, descriptor, reason: null, message: null };
  } catch {
    return fail("failed");
  }
}

/**
 * Reads the face out of a photo that has already been taken.
 *
 * The swipe captures its photograph first and that picture is the record, so the
 * face is read from the very same image rather than from a second look at the
 * camera - otherwise the descriptor could describe a different moment from the
 * one stored, which is precisely the gap somebody would use.
 *
 * Returns null instead of throwing: a photo whose face cannot be read must still
 * be allowed to become a swipe.
 */
export async function describePhoto(file: Blob): Promise<FaceRead | null> {
  let url: string | null = null;
  try {
    url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable"));
      el.src = url as string;
    });
    return await readFace(img);
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/** Whether this device can do any of it at all - no camera, no face check. */
export function cameraSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}
