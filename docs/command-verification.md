# Command and search verification

## Coverage

- 30 curated Photoshop commands, Missing ping, and 69 enabled tool shortcuts are
  indexed and assignable to wheels. Remove remains searchable but is disabled
  after a reported Photoshop crash; both the controller and host dispatch reject
  it before invoking Photoshop. Native wheel snapshots omit its executable ID,
  and stale native events are rejected. Saved bindings are preserved.
- The eight default slots resolve entirely from the built-in catalog. Delete
  targets the selected layers, including their current IDs, rather than clearing
  pixels or relying on a private saved action. Fill uses the foreground color
  without a dialog. Both descriptors match the original wheel's recorded
  actions, with recorded layer IDs replaced by current selected layer IDs.
  Older eight-slot starter wheels, including the reported Remove variant,
  migrate on load to the new default. A saved preset version prevents later edits
  from being reset. Other custom layouts, four-direction wheels, and action
  assignments remain intact. Startup tests cover upgrade and edit/save/reload.
- Visible actionable Photoshop menu entries are indexed; hidden branches are
  skipped. Repeated records and repeated native command IDs share one result.
  Explicit equivalent catalog/menu paths (including Gaussian Blur) share the
  catalog dispatch. Aliases preserve search paths, favorites, usage and existing
  wheel IDs. Different operations with identical labels remain separate. Long
  paths use compact stable identifiers.
- Open documents, nested layers in the active document, and loaded actions are
  indexed with their native identities. Duplicate actions are supported when
  Photoshop supplies distinct IDs.
- Search covers full names, aliases, menu/group paths, and categories. Non-Latin
  names and long queries are preserved. More results are reachable by button or
  arrow-key navigation, including when assigning a wheel slot.

This is the inventory Photoshop exposes to Reflex. It does not include controls
inside modal workspaces, arbitrary parameters inside another plugin, or menus
that Photoshop does not expose. A discovered menu or tool may still be unavailable
for the current document mode, layer type, selection, or Photoshop version.

## Corrected dispatch

The Remove safeguard is a mitigation, not a verified crash fix. No crash was
reproduced in the user's working Photoshop session. Adobe lists
[Remove tool crash workarounds](https://helpx.adobe.com/photoshop/desktop/repair-retouch/remove-objects-fill-space/remove-tool-known-issues-and-workarounds.html),
but the reported host's root cause remains unconfirmed. Re-enable only after a
disposable-document host test establishes a working dispatch on each platform.

Delete and Fill were checked against the original wheel's saved actions in the
local Actions Palette data, without executing Photoshop. Delete contains a
target-layer reference and a layer ID list; Fill specifies foreground color and
no dialog. No saved action file is distributed. Automated checks cover context
guards, selected IDs, the foreground fill descriptor, disabled Remove search and
blocked legacy wheel events. The new
Delete/Fill operations still require disposable-document Photoshop verification.

Object Selection targets `magicLassoTool`. Fit on Screen and Actual Pixels use
`select` with a `menuItemClass` reference. Reselect sets the selection channel
to the `previous` ordinal. These replace incorrect operation names.

Tool references were cross-checked against Photoshop 2026's installed tool
descriptions and tool mappings; no Adobe implementation or artwork is bundled.
Gaussian Blur, High Pass, Motion Blur, and Add Noise provide their required
radius/distance/noise settings even when opening a dialog. Initial values are
editable in Photoshop (10 px blur/high pass/motion, 0° motion, 1% uniform color
noise). They always request the dialog, and cancellation never retries silently.
Parameter names and units were checked against Photoshop 2026's installed UXP
API and this [Gaussian Blur dialog example](https://forums.creativeclouddeveloper.com/t/is-it-possible-to-open-the-gaussian-blur-dialog-box-through-code/8153).
The earlier dispatch-only tests accepted incomplete descriptors; regression
coverage now validates the required filter inputs before simulating cancellation.
The host reports Photoshop's own execution errors rather than recording usage
as though the command succeeded. Document guards reject a selection made before
the active document changed, including a no-document-to-document transition.

Menu checks use `getMenuCommandState` immediately before modal execution and
require `performMenuCommand` to confirm success. Cached menu-tree disabled flags
do not suppress valid commands or erase their wheel slots. Assignments never
silently fall back to a different same-name command.

Cancellation preserves batchPlay's `result: -128`, primitive and structured host
cancellation codes, and `executeAsModal` cancellation state. The callback latches
`onCancel` and reads the state before modal teardown, retaining the original error
if the outer rejection loses its payload. The controller shows “Action cancelled.”
in the existing footer for three seconds, skips usage updates, and resumes shortcuts.
An empty interactive rejection without a cancellation signal remains unsuccessful
and shows “Action not completed.” in the footer rather than claiming cancellation.
An unqualified `performMenuCommand: false` remains a failure. See Adobe's
[batchPlay result codes](https://developer.adobe.com/photoshop/uxp/ps_reference/media/batchplay/)
and [modal cancellation](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal).

Reference examples: [view menu descriptors](https://forums.creativeclouddeveloper.com/t/is-posible-to-set-a-zoom-event/5268/10)
and [previous selection descriptor](https://community.adobe.com/questions-712/fit-selection-to-screen-or-zoom-to-selection-1166365).

## Search palette

The 560 × 392 palette uses `showModal` with `titleVisibility: 'hide'`,
`lockDocumentFocus: true`, and `isTransparent: false`, matching the dialog options
used by Photoshop 2026's bundled adjustments panel. The plugin supplies a close
button and Escape handling. It suspends the native shortcuts while open and
disposes the palette before running the chosen command.

## Verification limits

Node tests exercise the real search, index, controller and dispatch code against
host fixtures. A headless browser can check the shared UI, but cannot establish
Photoshop's native dialog appearance or command behavior. No automated command
sweep should run against a user's working document: menus can close documents,
overwrite files, or launch dialogs.

Before release, use a disposable document in Photoshop to check the four corrected
commands, representative layer/filter operations, a loaded action, nested layers,
document switching, and a menu wheel assignment. Verify the title bar is hidden,
Escape/close cancel cleanly, and held wheel shortcuts resume after search closes.
Repeat the host checks on a Mac build before claiming macOS compatibility.
Also search “gaus” in All/Commands/Menus and in the wheel assignment picker,
cancel Gaussian Blur, then run it again. The fixture suite covers hidden menu
branches and cross-source duplicates; confirm the installed Photoshop version's
actual menu visibility and dialog cancellation on the host.
