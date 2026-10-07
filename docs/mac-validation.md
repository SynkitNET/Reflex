# Mac Apple Silicon preview validation

Recorded 2026-10-07 for `Reflex-0.6.7-mac-arm64-dev.ccx`, published under
the `v0.6.7-mac.1` release tag. The plugin version remains 0.6.7. The separate
Mac tag includes its platform fix without changing the original Windows tag
or installer.

## Package and signing

- Architecture: arm64 (Apple Silicon), with a macOS 12.0 native deployment
  target. The installed Photoshop version also determines macOS requirements.
- Photoshop minimum: 26.0. The tester used 27.10.0 on an M4 Mac.
- Developer ID signature, hardened runtime, and Apple timestamp were verified
  on the Mac. Apple notarization returned **Accepted**, with no issues.
- The exact signed addon was packaged at `mac/arm64/reflex.uxpaddon`.
- The handoff package CRC, addon checksum, architecture, and CodeDirectory hash
  were rechecked against the accepted notarization record on Windows. Apple
  signature trust verification was performed on the Mac, not repeated on Windows.
- The shared plugin runtime files match the published Windows 0.6.7 CCX.

| File | SHA256 |
| --- | --- |
| Mac CCX | `be4dae35dae93645a51ca315deb3184f3594d153442efbdf73e7d687d7ee7294` |
| Packaged addon | `2567eba708527fec3b2421486132b3a250382e5e6c11d3ca88a4bc52dbc5d5c8` |

## Automated checks on Mac

- 183 JavaScript tests passed, with no failures or skipped tests.
- Syntax, manifest, 101 commands, SVGs, and panel icon checks passed.
- The arm64 Release build passed with Xcode 27.0 and CMake 4.4.4.
- Five native suites passed: engine, runtime, ping, Mac lifecycle, and addon.
- Two AppKit deprecated-constant warnings remain.

The Mac lifecycle regression exercises the real adapter without opening
windows. It verifies that requests before startup and after repeated stop
calls are refused. It does not exercise a running Photoshop plugin's unload
cycle. The addon ABI suite uses platform stubs.

## Photoshop checks reported by the tester

Installation and loading, Ctrl + Option + K floating search, hold/aim/release
with Ctrl + Option + W, and cancelling Levels with Escape all worked. These
results were reported by the tester, not directly observed by the build agent.

## Still to verify

Wheel ordering above Photoshop and its floating panels; one Missing ping per
trigger and its cleanup; live addon unload/reload; focus loss and physical key
release order; Spaces and multiple displays; and installation on a separate
clean machine. Intel Mac support is not included in this release.

## Included fix

The Mac adapter now refuses a wheel request while stopped instead of accessing
destroyed views. This fixes a crash reproduced by the standalone adapter test.
The JavaScript bridge already guards stopped requests; normal wheel behavior
is unchanged.
