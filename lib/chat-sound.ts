/**
 * Incoming-message sound and desktop alerts (A73).
 *
 * The chime is synthesised with the Web Audio API rather than shipped as an audio file: it is a few
 * lines, adds nothing to the download, and cannot 404. Browsers refuse to make noise before the
 * person has interacted with the page, so the context is created lazily on the first play attempt
 * and a refusal is simply swallowed.
 */
const SOUND_KEY = "wp.chat.sound";

export function soundEnabled(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; }
}
export function setSoundEnabled(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* private window */ }
}

type Ctor = typeof AudioContext;
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctx: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!Ctx) return null;
  try { ctx = new Ctx(); } catch { return null; }
  return ctx;
}

/** Two short notes, quiet and quick - a notification, not an alarm. */
export function playMessageChime(force = false) {
  if (!force && !soundEnabled()) return;
  const ac = audio();
  if (!ac) return;
  try {
    if (ac.state === "suspended") void ac.resume();
    const now = ac.currentTime;
    [[880, 0], [1174.7, 0.11]].forEach(([freq, offset]) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // A quick swell and decay; a raw gate would click.
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.13, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.24);
    });
  } catch { /* audio is a nicety - never let it break the chat */ }
}

/** Ask once, when the person turns the sound on. Never on page load - that prompt is hostile. */
export async function askDesktopPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try { return (await Notification.requestPermission()) === "granted"; } catch { return false; }
}

/** A desktop banner, only while the tab is in the background - on screen the toast is enough. */
export function showDesktopAlert(title: string, body: string, onClick?: () => void) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    const n = new Notification(title, { body, tag: "workpulse-chat", icon: "/icons/icon-192.png" });
    n.onclick = () => { window.focus(); n.close(); onClick?.(); };
  } catch { /* some browsers only allow this from a service worker */ }
}
