# Release verification

0.6.7 is a hybrid development build. Do not publish it as a stable release
until the following checks have been completed and recorded on each target.

- Unload older Reflex development copies and stop the legacy companion.
- Install the CCX through Creative Cloud on a clean machine.
- Confirm the panel loads, settings survive upgrade, and Shortcuts says Ready.
- In Settings, choose Pink. Check solid color accents in the panel, search, and
  native wheel at Minimal, Soft, and Bold. Upgrade saved Thermal settings and
  confirm they become Pink, with no gradient remaining. Check save/reload and
  custom colors, and confirm other settings are preserved.
- On fresh settings, check the eight default slots: New layer, Levels, Delete,
  Missing ping, Invert colors, Invert selection, Fill, Hue / Saturation. In a
  disposable document, verify Delete with single/multiple layers and groups,
  and foreground Fill with/without a selection. Confirm existing custom actions
  and wheel bindings survive the upgrade. Remove must be visibly disabled in
  search, absent from assignment, and unable to execute from old wheel slots.
- Upgrade from an older saved starter wheel and its Remove variant: the requested
  layout must appear immediately, with the same wheel name, colors and shortcuts.
  Edit the migrated wheel, save and restart; those edits must survive. Check a
  separate custom wheel and a four-direction wheel stay unchanged.
- Collapse the panel and verify its Reflex icon in light/dark Photoshop themes
  at standard and high DPI. Check the Plugins list icon as well.
- Search Missing ping, assign it to a wheel slot, and trigger individual pings.
  Each trigger must drop exactly one mark with inward rings. Repeated triggers
  must preserve earlier pings at their own locations until they fade.
  Confirm pings stay above Photoshop, pass clicks through, leave no document
  changes, fade away, and clear on Escape, switching apps, and unloading.
- Run search, layers/documents, tools, filters with dialogs, and saved actions.
- In Wheels, assign commands from Menus (Free Transform, an adjustment,
  Image Size and a panel). Browse past 80 results. Check disabled commands,
  cancelled dialogs, saved assignments after restart, and plugin menu entries.
- Hold the wheel binding, move to each of 4/8 sectors, and release each
  modifier/key in every order. Test very fast flicks before the first paint.
- Verify the wheel is visible over Photoshop at the cursor. Open wheel and
  the Photoshop menu command must use the same overlay, with click to select,
  center/right-click/Escape to cancel, and no click leaking to the canvas.
- Return to the center, press Escape, change documents, switch applications,
  or open a Photoshop modal while holding: no old gesture may run afterward.
- Record keyboard, middle-button and side-button shortcuts; release before
  Save; verify Escape, Cancel, timeout, focus loss and duplicate bindings.
- Close/reopen the panel and unload/reload the plugin. No leftover wheel,
  input listener, process, localhost listener or duplicated execution remains.
- Test DPI/Retina, monitors left/above the primary display, fullscreen/Spaces,
  keyboard layouts, sleep/wake and Photoshop restart.
- Check long and unbroken wheel labels in every direction, with 4/8 slots and
  each font. Text must wrap or end in an ellipsis without crossing dividers.
  With a document but no selected layer, Levels, Delete and Fill must keep their
  own dimmed icons. Empty slots alone use plus signs; disabled commands cannot run.
- Mac: build/test Intel and Apple Silicon, including Command/Option bindings.
  Sign and notarize the native binaries, and verify the signatures.
- Package the exact tested binaries; record their checksums in the release.

Automation excludes synthetic input by design on Windows. Physical shortcut
and mouse behavior therefore needs a person at the keyboard. Do not remove
this protection just to make a UI automation test pass.

Status from this development session: see dist/package-report.json for what
was actually built. Unchecked items are release work, not passing results.
