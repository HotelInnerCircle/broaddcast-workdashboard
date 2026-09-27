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

async function loadApi(): Promise<FaceApi> {
  apiPromise ??= import("@vladmandic/face-api");
  return apiPromise;
}

/** Fetches the three models once, and remembers that it did. */
export async function loadFaceModels(): Promise<void> {
  const api = await loadApi();
  modelsPromise ??= (async () => {
    await Promise.all([
      api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      api.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
  })();
  return modelsPromise;
}

export type FaceReadFailure = "no-face" | "many-faces" | "too-small" | "failed";

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

    const found = await api
      .detectAllFaces(input, new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
      .withFaceLandmarks(true)
      .withFaceDescriptors();

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
