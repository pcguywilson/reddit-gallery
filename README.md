# Reddit Gallery (personal)

Single-activity WebView app on `old.reddit.com` that injects your Gallery Scroller userscript on every listing page and starts it in gallery mode.

## Build

Easiest: push to GitHub. `.github/workflows/build.yml` builds the APK and publishes it as the `latest` release. Download `RedditGallery.apk` from the Releases page on the phone and install.

Local (optional):

1. Android Studio > Open > this folder. Let Gradle sync (AGP 8.7.3, Gradle 8.9, Kotlin 2.0.21, JDK 17).
2. Run on device, or `./gradlew assembleRelease` (signed with the bundled personal key `app/release.keystore` so updates install over each other).
3. APK: `app/build/outputs/apk/release/app-release.apk`

## Userscript

- Bundled copy: `app/src/main/assets/gallery.user.js`. Replace it and rebuild.
- No-rebuild override: push a file to the app's external files dir and relaunch:
  `adb push gallery.user.js /sdcard/Android/data/com.pcguywilson.redditgallery/files/gallery.user.js`
  Delete that file to fall back to the bundled one.

The userscript is not modified. Two shims wrap it:
- `assets/bootstrap.js` (runs before): mute-by-default, autoplay off, NSFW filter (drops `over_18` posts from listing JSON), disables element fullscreen (app is already immersive).
- `assets/autostart.js` (runs after): clicks the launcher to enter gallery mode, mobile CSS tweaks (top bar trimmed to Sort only, media filter applied from Settings, fullscreen title moved bottom-left and always visible so it clears the orange button), horizontal swipe and edge-tap options, back-button hook.

Injection happens in `onPageFinished` only for listing URLs (`/`, `/r/*`, `/all`, `/popular`, `/user/*`, `/u/*`, `/me/m/*`), mirroring the script's `@match` list.

## Panels

**Left (subreddits)**: swipe in from the left edge, or long-press the orange button.
- Pinned: frontpage, all, popular. Below that, your app-only list, alphabetical, with an A-Z index (tap or drag).
- Seeded on first run with a few defaults. **+** at the top adds a subreddit (`pics`, `pics+aww`, URL) or a multireddit URL. Suggestions drop down as you type; tap one to add it.
- Sort button (bottom left) toggles A-Z vs custom order. In custom order drag the ≡ handle to reorder; long-press for Move to top / bottom / Remove. In A-Z, long-press removes.
- Bottom bar: search (filters your list, offers "go to r/<text>", and searches Reddit; **+** on a result adds it), random (random pick from your list), settings.
- Stored only on the phone (SharedPreferences `feeds.xml`).

**Right (my reddit)**: tap the orange button.
- Multireddits at the top, then your subscriptions, pulled from your logged-in Reddit account. Refresh button at the top.
- Long-press a subscription to copy it into the left list.

## Settings

Log in (old.reddit login page in the WebView), log out (clears cookies), show (images and videos / images only / videos only), autoplay, mute by default, swipe direction (vertical, or vertical + horizontal), edge-tap navigation, NSFW, startup feed (last used / r/all / r/popular / front page / any saved feed), immersive mode, keep screen on, clear cache.

Changing settings reloads the current page so the new config is injected.

## Open in Reddit app

`shouldOverrideUrlLoading` catches any reddit.com URL containing `/comments/` (the grid "Comments" button and the fullscreen title both link to the permalink). It rewrites the host to `www.reddit.com` and fires `ACTION_VIEW` with package `com.reddit.frontpage`. If the Reddit app isn't installed it falls back to any app that handles the link.

Requirement: official Reddit app installed. If links open the browser instead, Android Settings > Apps > Reddit > Open by default > enable "Open supported links" and add `www.reddit.com`.

## Notes

- Videos: native controls are the way to unmute/play when Mute by default is on or Autoplay is off.
- RedGifs: the script's API call usually needs a token now, so it falls back to the embed iframe.
- NSFW off is enforced client-side even if your Reddit account pref allows NSFW.
