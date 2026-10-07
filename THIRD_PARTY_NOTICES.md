# Third-party components

Reflex-authored source and artwork are licensed under MIT (see LICENSE).

The Adobe UXP Hybrid Plugin SDK is a separate, Adobe-licensed build dependency.
Its headers, sample code and utilities are not relicensed by Reflex. Obtain
your own copy from Adobe Developer Console and review the terms supplied with
it. `native/sdk/` is excluded from the Git repository and source archive.
The addon links the SDK's UxpAddon and UxpValue utilities; binary packages
include Adobe's accompanying terms. Photoshop and the UXP runtime are Adobe
products and are not part of this project.

Development-only npm dependencies (not included in the installed plugin):

- acorn: MIT — https://github.com/acornjs/acorn
- postcss: MIT — https://github.com/postcss/postcss
- JSZip: MIT or GPLv3; Reflex uses the MIT option — https://github.com/Stuk/jszip

The generated wheel drawings originate in `tools/icon-source.js` and use
the same source as the UXP SVG assets. No external font or icon package is
required by the native wheel; it uses system fonts.
