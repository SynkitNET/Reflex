# Reflex on macOS

The 0.6.7 source contains an in-process UXP Hybrid adapter in
`native/src/platform_mac.mm`. It uses an AppKit local event monitor inside
Photoshop, a nonactivating transparent NSPanel, and the shared gesture,
capture, and command-delivery engine. It has no separate app, login item,
pairing file, HTTP server, or WinForms/.NET dependency.

**Status: source implemented; not compiled or validated on macOS.**
Do not advertise Mac downloads until both architecture builds and the
manual Photoshop checks have passed.

## Build

Install Xcode and CMake, obtain Adobe's UXP Hybrid Plugin SDK separately,
and point `REFLEX_UXP_SDK` at its extracted root. From the project root:

```sh
npm ci
REFLEX_ARCH=arm64 npm run native:build
REFLEX_ARCH=x64 npm run native:build
```

This writes `mac/arm64/reflex.uxpaddon` and `mac/x64/reflex.uxpaddon`.
The minimum native deployment target is 12.0; the minimum usable macOS
version is also constrained by the installed Photoshop 26+ release.

Build the Windows addon separately, then bring the three platform binaries
into the same source checkout. Before distribution, sign and notarize the
Mac addons using your Apple Developer ID. `npm run package` verifies that
all three files exist but does **not** certify signatures or notarization.
Adobe's current instructions are authoritative:
https://developer.adobe.com/uxp/guides/how-to/hybrid-plugins/build

## Input model

The local event monitor observes only events dispatched to the current
Photoshop process. It consumes configured shortcut keys or the explicitly
recorded candidate; unrelated events continue normally. Focus loss cancels
a gesture. A main-run-loop timer also closes stale wheels if UXP stops
publishing state, and monitors/timers/windows are removed on addon unload.

The adapter uses AppKit screen points, including negative display origins,
and converts the Y axis at the shared-engine boundary. Retina scaling is
handled by AppKit. Keyboard layout translation preserves physical letter
bindings under Control/Option; Command is stored as its own modifier.

Verify Command key release, native dialogs, foreign-app focus, input tools,
Spaces/fullscreen, multiple monitors, and Intel/Apple Silicon on real Macs.
Windows filters injected input; equivalent macOS synthetic-event handling
is still a validation item. See docs/release-checklist.md.

The supported architecture is the native component inside a single CCX.
