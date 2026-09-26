# Flexyn native app (iOS and Android)

Flexyn ships to the App Store and Google Play as a **Capacitor 8** wrapper
around the same web bundle Netlify serves. `npm run build` produces `dist/`;
`npx cap sync` copies it into the two native projects, which are committed
at `ios/` and `android/`.

The bundle is **inside** the app. `capacitor.config.json` has no
`server.url`, on purpose: Apple rejects apps that are a thin shell around a
remote website (App Review guideline 4.2). A consequence is that a web
deploy does not reach the app. Store users get new code when a new build
ships through the stores.

| | |
|---|---|
| App ID / bundle ID | `app.flexyn` (change it before registering, see below) |
| App name | Flexyn |
| Web dir | `dist` |
| Deep link for sign-in | `app.flexyn://auth-callback` |
| iOS minimum | 15.0, Swift Package Manager (no CocoaPods) |
| Android minimum / target | API 24 / API 36 |

## Building

Everything below works today with no developer accounts.

```bash
npm ci
npm run cap:sync              # vite build + copy into ios/ and android/
```

The web bundle reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at
**build** time, exactly like Netlify. Put them in `.env.local` before a build
you intend to run on a device, or the app starts with no backend.

### Android (any OS)

Needs JDK 21 and the Android SDK (Android Studio installs both).

```bash
npm run cap:open:android      # opens Android Studio; Run on a device or emulator
# or, headless:
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

### iOS (macOS only)

Needs Xcode 26 or newer. There is no Podfile: plugins come in through Swift
Package Manager (`ios/App/CapApp-SPM/Package.swift`, which `cap sync`
rewrites; do not edit it by hand).

```bash
npm run cap:open:ios          # opens Xcode; pick a simulator and Run
```

A simulator needs no signing. A physical iPhone needs a signing team
(step 1 below).

### Icons and splash screens

Generated from `public/favicon.svg`, so the store icon is the same mark as
the PWA icon. Only re-run this when the artwork changes; the output is
committed.

```bash
npm run cap:assets
```

### CI

`.github/workflows/native-build.yml` runs on pull requests that touch the
native projects, the Capacitor config, dependencies or the native helpers,
and on demand (Actions → Native build → Run workflow). It builds an
**unsigned** Android debug APK (uploaded as an artifact) and an **unsigned**
iOS simulator build. That proves both projects compile. The signed release
steps are commented placeholders in the same file until the secrets in
steps 8 and 9 exist.

## How sign-in works in the app

Google refuses OAuth inside an embedded web view, so the web's full-page
redirect cannot be reused. On native (`src/lib/nativeAuth.js`):

1. `signInWithOAuth` is called with `skipBrowserRedirect: true` and
   `redirectTo: app.flexyn://auth-callback`, and the returned URL opens in
   the system browser (`@capacitor/browser`: SFSafariViewController on iOS,
   a Custom Tab on Android).
2. After the provider, Supabase redirects to `app.flexyn://auth-callback?code=…`.
   The OS hands that to the app and `@capacitor/app` fires `appUrlOpen`.
3. The code is exchanged with `exchangeCodeForSession`. The native client
   uses the **PKCE** flow (`src/api/supabaseClient.js`); the web client is
   unchanged and stays on the implicit flow.
4. The browser is closed and the normal `SIGNED_IN` handling in
   `AuthContext` takes over.

Magic links do the same: on native the email link returns to
`app.flexyn://auth-callback`, so it signs in when tapped **on the same
phone** that asked for it.

**Sign in with Apple** on iOS uses Apple's native sheet through a small
plugin in the app target (`ios/App/App/FlexynBridgeViewController.swift`),
then `signInWithIdToken({ provider: 'apple', token, nonce })`. Apple is given
the SHA-256 of a random nonce and Supabase the raw one. On Android and the
web, Apple is the ordinary OAuth redirect.

The sign-in screen shows only the providers `/auth/v1/settings` reports as
enabled (`src/lib/authProviders.js`). **Apple is not enabled on the Supabase
project yet, so the Apple button is hidden everywhere until step 4.**

App Review guideline 4.8: an app that offers Google sign-in must also offer
Sign in with Apple. So Apple must be enabled **before** the first iOS
submission, or the build will be rejected.

## What needs Kegan's accounts

Nothing below can be done from the repo. In order:

1. **Apple Developer Program.** Enrol at developer.apple.com ($99 a year).
   Note the **Team ID** (Membership details). Decide the bundle ID now:
   `app.flexyn` is a default. If it changes, change `appId` in
   `capacitor.config.json`, `PRODUCT_BUNDLE_IDENTIFIER` in
   `ios/App/App.xcodeproj/project.pbxproj`, `applicationId` and `namespace`
   in `android/app/build.gradle`, the strings in
   `android/app/src/main/res/values/strings.xml`, and the scheme in
   `src/lib/native.js` (`NATIVE_URL_SCHEME`), `ios/App/App/Info.plist`
   (`CFBundleURLTypes`) and the Supabase redirect URL in step 5. The Android
   `applicationId` can never change once the app is on Play.

2. **Register the App ID** `app.flexyn` (Certificates, Identifiers & Profiles
   → Identifiers → App IDs) with the **Sign in with Apple** capability
   enabled. The entitlement is already in `ios/App/App/App.entitlements`.

3. **Create what Supabase's Apple provider needs**:
   - a **Services ID** (Identifiers → Services IDs), for example
     `app.flexyn.web`, with Sign in with Apple enabled, the domain
     `<project-ref>.supabase.co`, and the return URL
     `https://<project-ref>.supabase.co/auth/v1/callback`
     (this is what web and Android use). The project ref is in the
     Supabase dashboard URL; the full URL is kept out of the repo because
     Netlify's secrets scan fails any build whose files contain the value
     of `VITE_SUPABASE_URL`;
   - a **Key** (Keys → +) with Sign in with Apple enabled. Download the
     `.p8` once and note its **Key ID**;
   - the **Team ID** from step 1.

4. **Enable Apple in Supabase** (Authentication → Sign In / Providers →
   Apple). Client IDs: the Services ID **and** the bundle ID, comma
   separated (`app.flexyn.web,app.flexyn`); the bundle ID is what a native
   iOS identity token carries, and without it native sign-in is refused.
   Secret key: the JWT generated from the `.p8`, Key ID and Team ID
   (Supabase's docs link a generator). **That secret expires after six
   months** and has to be regenerated, or web and Android Apple sign-in stop
   working; put a reminder in a calendar. The Apple button appears in the
   app and on the web as soon as this is saved.

5. **Allow the deep link in Supabase**: Authentication → URL Configuration
   → Redirect URLs → add `app.flexyn://auth-callback`. Without it Supabase
   ignores the app's redirect and sends people to the Site URL (the web app,
   in the system browser), and the app never hears back. Google needs no
   change: its redirect is Supabase's callback, which is the same for the
   app.

6. **App Store Connect**: create the app record for `app.flexyn`, fill in
   the privacy nutrition labels, and point the privacy policy URL at
   `/privacy` on the live site. The app already offers in-app account
   deletion (profile menu → Delete account), which Apple requires; also make sure
   deleting an account that signed in with Apple **revokes the Apple token**
   (Apple's `/auth/revoke` endpoint, server side). That is not built yet.

7. **Google Play Console** ($25 one-off). Create the app with package
   `app.flexyn`, and let Play App Signing hold the app signing key.

8. **Android upload keystore** as GitHub secrets. Create one with
   `keytool -genkeypair -v -keystore upload.keystore -alias flexyn-upload
   -keyalg RSA -keysize 2048 -validity 10000`, keep a backup outside GitHub,
   then add repository secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0
   upload.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and
   `ANDROID_KEY_PASSWORD`. `android/app/build.gradle` already signs a
   release from `FLEXYN_KEYSTORE_*` environment variables when they are
   set, and the workflow placeholder maps the secrets onto them.

9. **iOS signing** as GitHub secrets: an Apple Distribution certificate
   exported as `.p12` (`IOS_DIST_CERT_P12_BASE64`,
   `IOS_DIST_CERT_PASSWORD`), an App Store provisioning profile for
   `app.flexyn` (`IOS_PROVISIONING_PROFILE_BASE64`), `APPLE_TEAM_ID`, and an
   App Store Connect API key (`APP_STORE_CONNECT_API_KEY_ID`,
   `APP_STORE_CONNECT_API_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_P8`) for
   uploading to TestFlight.

10. **Build-time env for store builds**: `VITE_SUPABASE_URL` and
    `VITE_SUPABASE_ANON_KEY` (and the optional `VITE_*` keys Netlify has) as
    repository secrets or variables, so a CI release build talks to
    production. They are public values, but they must be present.

## Known gaps, not blockers for a first TestFlight build

- **Push notifications** in the app need APNs (iOS) and FCM (Android),
  which is separate work. Web Push is switched off inside the app, and every
  web opt-in surface hides itself because `usePushSubscription` reports
  unsupported there.
- **Universal Links / App Links** (https links that open the app) need the
  domain to serve `apple-app-site-association` and `assetlinks.json`. The
  custom scheme covers sign-in until then.
- **Outdoor cardio tracking stops when the phone locks.** The web view's
  geolocation pauses in the background; a native background-location plugin
  would fix it.
- **Info.plist permission strings are English only.** Add
  `InfoPlist.strings` for es and fr before those storefronts.
- **Session storage** is the web view's `localStorage`, as on the web. If
  sign-outs show up after iOS clears storage under pressure, move the
  Supabase auth storage to `@capacitor/preferences`.
