# Contributing to Reflex

Use Node.js 22 or newer. Run `npm ci`, `npm test` and `npm run check`.
The preview (`npm run preview`) uses sample data and does not execute Photoshop
commands. Changes to the shared artwork require `npm run assets`.

The portable native engine can be tested without Adobe's SDK:

```sh
cmake -S native -B native/build-tests -DCMAKE_TRY_COMPILE_CONFIGURATION=Release
cmake --build native/build-tests --config Release
ctest --test-dir native/build-tests -C Release --output-on-failure
```

For the Photoshop addon, obtain the UXP Hybrid SDK from Adobe Developer
Console. Set `REFLEX_UXP_SDK` to its extracted directory, then run
`npm run native:build`. Windows requires Visual Studio's C++ desktop tools
and CMake. macOS requires Xcode, CMake and a supported Photoshop version.
Do not commit the SDK, credentials, signing certificates, connection files,
build directories, or generated `.ccx` installers.

Native callbacks must not retain UXP handles or touch the Photoshop DOM.
Transfer copied state through the runtime, bound input to the active Photoshop
process, and release every callback on unload. Keep tests for cancellation,
changed documents, expired gestures, modal dialogs, and shortcut capture.

Run the manual checks in docs/release-checklist.md before claiming host or
platform compatibility. A browser preview or fake host is not a Photoshop test.

Contributions to Reflex are made under its MIT license. Third-party code
keeps its original license and attribution.

## Layout

- Root JavaScript, HTML, and CSS: UXP interface, Photoshop command dispatch,
  settings, and the native bridge. `bridge.js` retains a tested legacy transport
  path; the hybrid manifest selects `native-bridge.js`.
- `native/`: shared C++ engine, Windows/macOS adapters, and native tests.
- `assets/` and `tools/`: shared artwork, generators, preview, and packaging.
- `tests/`: JavaScript regression tests, including saved-setting compatibility.
- `docs/`: usage, platform instructions, validation, and public screenshots.

The obsolete companion application and its packaging scripts remain outside
this repository. Public screenshots should use sample data, not private artwork
or account details. Source files follow the existing comment-free style.

GitHub checks run JavaScript tests and the SDK-free native tests on Windows,
macOS, and Linux. The workflow pins the official checkout v7 and setup-node v7
actions to commits. These checks do not build the Adobe addon on hosted runners
and do not establish Photoshop or Mac overlay compatibility.

## Packaging

After building the addon, create a Windows package with:

```sh
npm run package -- --target=win/x64
npm run package:source
```

The CCX belongs on a GitHub Release, not in the source tree. The source package
excludes build products, legacy companion code, and the Adobe SDK. Build and
validate Mac targets on a Mac before offering them as downloads.
