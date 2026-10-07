# Reflex on macOS

The 0.6.7 source contains an in-process UXP Hybrid adapter in
`native/src/platform_mac.mm`. It uses an AppKit local event monitor inside
Photoshop, a nonactivating transparent NSPanel, and the shared gesture,
capture, and command-delivery engine. It has no separate app, login item,
pairing file, HTTP server, or WinForms/.NET dependency.

**Status: an Apple Silicon development preview is available, signed with
Developer ID and accepted by Apple notarization. Intel builds are unavailable.**

[Download the Apple Silicon CCX](https://github.com/SynkitNET/Reflex/releases/download/v0.6.7-mac.1/Reflex-0.6.7-mac-arm64-dev.ccx).
Install it while running Photoshop natively on an M-series Mac. This arm64
package does not support Intel Macs or Photoshop running under Rosetta.

On 2026-10-07, an arm64 Release build with Xcode 27.0, CMake 4.4.4, and the
local Adobe Hybrid SDK passed 183 JavaScript tests, `npm run check`, and all
five native suites: engine, runtime, ping, Mac lifecycle, and addon. Installed
Photoshop 27.10.0 meets Reflex's 26.0 minimum. A tester reported successful
installation, loading, floating search, hold/release wheel commands, and
dialog cancellation. These host checks were not directly observed by the
build agent. Overlay ordering, Missing ping, live unload/reload, and broader
host testing remain pending. [Full validation record](mac-validation.md).

The Mac lifecycle suite covers a reproduced crash when requesting a native
wheel while the adapter is stopped. The adapter now refuses that request
without accessing destroyed views. The JavaScript bridge already guards
stopped calls; the fix preserves normal wheel behavior. The real AppKit
adapter is tested without opening windows. The addon ABI suite uses platform
stubs, so it does not substitute for host testing.

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

For a controlled Apple Silicon development package, sign and notarize the
final arm64 addon, then run:

```sh
node tools/package-hybrid.js --target=mac/arm64
```

Keep `REFLEX_UXP_SDK` set when packaging so the Adobe license is included.
This package contains `mac/arm64/reflex.uxpaddon` and does not support Intel
or Windows. Rebuilding the addon invalidates its previous signing and
notarization evidence; sign and notarize the new bytes before packaging.

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
