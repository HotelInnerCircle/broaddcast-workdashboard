# WorkPulse for Windows (Electron)

The desktop app is a **native window around the deployed site** (`https://app.broaddcast.com`), the
same decision the mobile app made in [MOBILE.md](MOBILE.md). Nothing is bundled: the window loads
the live app, so **every Vercel deploy updates every installed copy at once** - no new installer to
hand out for an ordinary change.

Because it loads the real origin, the session cookie is first-party exactly as in a browser. Login,
roles, uploads, downloads and the realtime transport all work unchanged.

It lives in `desktop/`, with its own `package.json`, so `npm install` at the repo root and the
Vercel build never see Electron.

| File | What it is |
|---|---|
| `desktop/main.js` | window, menu, offline fallback, external-link handling |
| `desktop/preload.js` | exposes `window.workpulseDesktop` (read-only) and nothing else |
| `desktop/offline.html` | shown when the server cannot be reached; returns by itself when the network comes back |
| `desktop/build/icon.ico` | app icon, generated from `public/icons/icon-512.png` |

What it adds over a browser tab: its own taskbar entry and icon, the window size remembered between
sessions, no address bar, `Alt+Left` / `Alt+Right` to go back and forward, and Windows notifications
attributed to WorkPulse rather than to the browser.

---

## Building the installer

**In CI (recommended, and free):** the Actions tab → **Build apps** → *Run workflow*. It builds on a
clean `windows-latest` runner and uploads `WorkPulse-Setup-<version>.exe` as an artifact. Pushing a
tag like `v1.0.0` also publishes a release with the file attached.

**On a Windows PC:**

```bash
cd desktop
npm install
npm run dist        # -> desktop/dist/WorkPulse-Setup-<version>.exe
npm run pack        # packages without building the installer (faster while developing)
npm start           # runs the app straight from source
```

Point it somewhere else while testing: `WORKPULSE_URL=http://localhost:3000 npm start`.

### Two things that will bite you on a developer machine

- **`EPERM ... rename 'win-unpacked.tmp'`** - electron-builder 26 renames the freshly extracted
  Electron folder while a virus scanner still holds a handle on it. The repo pins **electron-builder
  25**, which does not hit this.
- **`Cannot create symbolic link ... libcrypto.dylib`** - electron-builder unpacks its code-signing
  tool into a new folder on every run, and that archive contains macOS symlinks. Creating a symlink
  on Windows needs a privilege a normal account does not have. Turn on **Settings → System → For
  developers → Developer Mode** (then reopen the terminal), or run the build from an Administrator
  prompt. Without it the app is packaged but keeps Electron's icon and version strings, and no
  installer is produced. CI has the privilege, so it never hits this.
- Running the build **from a VS Code terminal** can fail oddly: VS Code exports
  `ELECTRON_RUN_AS_NODE=1`, which makes any Electron binary run as plain Node and exit immediately.
  `unset ELECTRON_RUN_AS_NODE` first.

### Code signing

The installer is **unsigned**, so Windows SmartScreen shows *"Windows protected your PC"* the first
time; the person clicks **More info → Run anyway**. Removing that warning needs a paid
code-signing certificate (an OV certificate is roughly $200-400 a year; SmartScreen reputation also
builds up over time). The `/download` page tells people what to expect.

---

## Handing it out

`https://app.broaddcast.com/download` is the one public link. It works signed out, offers the
Android APK and the Windows installer, and also explains installing straight from the browser
(and from Safari on iPhone, where Apple allows nothing else).

The page reads `DOWNLOAD_ANDROID_URL`, `DOWNLOAD_WINDOWS_URL` and `DOWNLOAD_VERSION` from the
environment, so where the files are hosted can change without touching the code. A platform whose
URL is empty reads *"Not published yet"* rather than offering a link that 404s.
