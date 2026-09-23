# WorkPulse mobile app (Capacitor)

The native apps are a **shell around the deployed web app** (`https://app.broaddcast.com`). Nothing
is bundled offline: the app loads the live site, so every deploy updates all installed apps instantly
and the website keeps working exactly as before.

Why remote mode and not `output: "export"`: the app has 76 API routes, middleware, Auth.js sessions
and a Socket.IO server. A static export cannot run any of those.

**Session cookies:** `capacitor.config.ts` sets `androidScheme/iosScheme: "https"` **and**
`hostname: app.broaddcast.com`, so the WebView origin is the real domain. The `SameSite=Lax`
session cookie stays first-party and login works unchanged - no auth changes were needed.

---

## Prerequisites (one time)

| Tool | For | Notes |
|---|---|---|
| Node 20+ | everything | already installed |
| **JDK 21** | Android builds | https://adoptium.net (Temurin 21) |
| **Android Studio** | SDK, emulator, signing | https://developer.android.com/studio - install "Android SDK Platform 35" + "Build-Tools" |
| Xcode 15+ (macOS only) | iOS | App Store Connect account |

Set `JAVA_HOME` and `ANDROID_HOME` (`%LOCALAPPDATA%\Android\Sdk` on Windows) after installing.

---

## Development

```bash
# 1. Run the app against production (nothing to configure)
npx cap open android            # opens Android Studio; press Run

# 2. Or run against your local dev server on a phone on the same Wi-Fi
#    (put your PC's LAN IP in .env, then re-sync so the native config picks it up)
#    MOBILE_URL=http://192.168.1.5:3000
npm run dev                      # in one terminal
npx cap sync android             # re-writes the native config
npx cap run android              # builds + installs on the connected device
```

Enable **USB debugging** on the phone (Settings → About → tap Build number 7x → Developer options).
Check it is visible: `adb devices`.

---

## Android builds

```bash
npx cap sync android                     # after any config/plugin change

# Debug APK (install directly, no signing setup)
cd android && ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk

# Release APK (needs a keystore, see below)
cd android && ./gradlew assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk

# Signed AAB for Google Play
cd android && ./gradlew bundleRelease
# -> android/app/build/outputs/bundle/release/app-release.aab
```

### Signing key (create once, never lose it)

```bash
keytool -genkey -v -keystore workpulse.keystore -alias workpulse \
        -keyalg RSA -keysize 2048 -validity 10000
```

Put it outside the repo and add `android/key.properties` (already git-ignored):

```properties
storeFile=C:/keys/workpulse.keystore
storePassword=********
keyAlias=workpulse
keyPassword=********
```

`android/app/build.gradle` is already wired to read that file when it exists.

Get the fingerprint for app links:

```bash
keytool -list -v -keystore workpulse.keystore -alias workpulse | findstr SHA256
```

### Remove the browser address bar (verified app links)

Set these on the server (Vercel → Settings → Environment Variables) and redeploy:

```
ANDROID_PACKAGE_NAME=com.broaddcast.workpulse
ANDROID_CERT_SHA256=<SHA-256 from the command above>
```

Android then verifies `https://app.broaddcast.com/.well-known/assetlinks.json` and the app runs
full-screen. With Google Play app-signing, also add the fingerprint from
**Play Console → App integrity → App signing key** (comma-separated, both are allowed).

### Google Play deployment

1. Play Console → **Create app** (name WorkPulse, app or game: App, free/paid).
2. **Testing → Internal testing → Create release** → upload `app-release.aab` → add testers.
3. Fill **Store listing** (icon 512×512, feature graphic 1024×500, screenshots - see
   `public/screenshots/`), **Content rating**, **Data safety**, **Target audience**, **Privacy policy URL**.
4. **Production → Create release** → upload the AAB → roll out. Review takes 1-3 days.
5. Updates: bump `versionCode`/`versionName` in `android/app/build.gradle`, rebuild the AAB, upload.

---

## iOS (needs a Mac)

```bash
npx cap sync ios
npx cap open ios          # opens Xcode
```

In Xcode: select the **App** target → **Signing & Capabilities** → choose your Team (bundle id
`com.broaddcast.workpulse`) → add the **Push Notifications** capability → add **Associated Domains**
with `applinks:app.broaddcast.com`.

- **Run on a device:** select the device → ⌘R.
- **TestFlight:** Product → Archive → Distribute App → App Store Connect → Upload. The build
  appears in App Store Connect → TestFlight after processing.
- **App Store:** App Store Connect → create the app record → fill listing + screenshots →
  submit the TestFlight build for review.
- Set `IOS_TEAM_ID` on the server so `/.well-known/apple-app-site-association` serves the app id.

---

## Push notifications (Firebase Cloud Messaging)

Push is **wired but inactive** until configured - the app works fine without it.

1. https://console.firebase.google.com → **Add project** (any name).
2. **Add app → Android**, package `com.broaddcast.workpulse` → download **`google-services.json`** →
   put it in `android/app/google-services.json` (git-ignored).
3. (iOS) **Add app → iOS**, bundle `com.broaddcast.workpulse` → download `GoogleService-Info.plist`
   → drop into `ios/App/App/`. Upload an **APNs auth key** in Firebase → Project settings → Cloud Messaging.
4. **Project settings → Service accounts → Generate new private key** → paste the JSON (or its
   base64) into the server env as `FIREBASE_SERVICE_ACCOUNT` → redeploy.

Delivery is automatic from then on: every existing notification type (task assigned, task update,
mention, chat message, deadline/follow-up reminder, manager and system notifications) already goes
through `notify()`, which now also sends FCM to the user's registered devices. Tokens are stored per
device in `DeviceToken`, registered on app start and removed on logout; tokens FCM rejects are pruned.

---

## Permissions requested

Only these, nothing else: `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS` (Android 13+, for push).

---

## Limitations / notes

- **Android/iOS builds cannot be produced on this machine** - no JDK or Android SDK installed. All
  code and native projects are ready; install the prerequisites above and the Gradle commands work.
- Push requires the Firebase files above; until then `pushEnabled()` is false and the app silently
  skips push (in-app + socket notifications still work).
- The app needs a network connection (it loads the live site); the service worker shows a branded
  offline page when there is none.
- Because the shell loads the deployed site, **a bad deploy affects installed apps immediately** -
  the usual trade-off of remote-URL mode.
