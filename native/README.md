# Reflex native addon

The shared C++20 gesture/capture engine and platform adapters implement the
0.6.7 UXP Hybrid plugin. Windows uses Win32 input hooks and a transparent
GDI+ wheel. macOS source uses an AppKit local event monitor and NSPanel.

The Windows and macOS arm64 addons compile. The Apple Silicon preview is
signed and notarized; automated checks pass and a tester confirmed basic
Photoshop use. Broader host validation and Intel builds remain outstanding.
See docs/mac-validation.md and docs/release-checklist.md before a stable release.

## Build

Obtain Adobe's UXP Hybrid Plugin SDK yourself. The folder must contain
`src/api/UxpAddonTypes.h`, `src/api/UxpAddonShared.h`, and `src/utilities`.
Place it in `native/sdk/uxp-hybrid-plugin-sdk-main`, or set REFLEX_UXP_SDK.
The SDK remains under Adobe's license and must not be committed.

```sh
npm run native:build
```

The script uses CMake and native compiler tools and copies the resulting
addon to `win/x64`, `mac/arm64`, or `mac/x64`. Those build products are ignored
by Git. The Windows runtime is linked statically, so .NET is not required.

Photoshop locks a loaded Windows addon. Unload Reflex before replacing
`win/x64/reflex.uxpaddon`. To package a staged build without replacing the
loaded file, pass `--native-root=path/to/stage` to the package script; the
stage must contain the usual `win/x64` or `mac/arm64` / `mac/x64` folders.

Portable checks, without the SDK:

```sh
cmake -S native -B native/build-tests -DCMAKE_TRY_COMPILE_CONFIGURATION=Release
cmake --build native/build-tests --config Release
ctest --test-dir native/build-tests -C Release --output-on-failure
```

On macOS, these checks also compile the real AppKit adapter and verify that
wheel and ping requests before startup and after repeated stop calls are
refused safely. They do not open windows or test Photoshop interaction.

## Boundaries

- `engine.cpp`: gesture geometry, once-only delivery, freshness and context.
- `runtime.cpp`: serialized access and transactional shortcut capture.
- `addon.cpp`: UXP conversion and the small method/payload interface.
- `platform_win.cpp` / `platform_mac.mm`: input, foreground checks, drawing,
  and lifecycle cleanup; no Photoshop commands or document access.
- `wheel_layout.hpp`: shared 4/8-sector content bounds with room for an icon and
  two text lines, padded from dividers, the logo and the outer rim. Each platform
  wraps/truncates its text and clips content to the owning section. Disabled
  commands retain the assigned icon in gray instead of an empty-slot plus.
- `native-bridge.js`: allowed-command/document checks, modal suspension,
  capture flow, and acknowledgement before resuming input.

Native methods consume copied standard values. Native input threads never
retain UXP values, invoke JavaScript, or read Photoshop documents. The addon
requires no listener port or credentials. `icons.hpp` is generated from the
same MIT artwork as the JavaScript panel; regenerate with `npm run assets`.

The Windows overlay is owned by Photoshop's root window and starts topmost.
Showing it and maintaining its window order are checked separately from
drawing: the active gesture restores lost topmost status or a floating
Photoshop panel above the wheel even when the selected sector has not changed.
It never activates the wheel or moves Photoshop's windows. Failures appear in
Shortcut status instead of reporting Ready. The automated regression uses
only its own hidden windows on separate threads; it cannot establish actual
Photoshop visibility. The host checks in the release checklist still apply.

The Windows paint suite compares long-label renders against blank-label renders
for all directions, fonts and 100/150/200% DPI. Every changed pixel must belong
to its intended section. It also renders every shared icon in a disabled slot
and rejects replacement by a plus. Portable geometry checks exercise the same
content boxes used by the Mac renderer; AppKit rendering still needs Mac testing.
