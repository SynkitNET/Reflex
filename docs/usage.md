# Using Reflex

## Search

Press Ctrl + Alt + K or choose **Open search palette**. Type a command, menu
path, tool, layer, document, or loaded Photoshop action. Use the arrow keys to
navigate and Enter to run a result. Escape closes search.

The category tabs narrow the results. Favorites stay available for quick access.
Menu paths are searchable too: try `Image Adjustments`. Use **Show more results**
to continue past the first page. Refresh the panel after loading new actions or
changing the available Photoshop menus.

Duplicate menu records and known equivalent commands share a result. Different
operations with the same name remain separate. Hidden menu entries are excluded.
Some Photoshop menu entries cannot be identified reliably; unavailable entries
and discovery failures are reported rather than guessed.

Menu assignments use their names and paths. Changing Photoshop's language or a
menu label may require reassignment. Ambiguous third-party plugin menu entries
may need reassignment after restarting Photoshop.

## Wheels

Open **Wheels**, select or create a named wheel, choose four or eight directions,
then select a slot to assign a command. Changes save automatically.

Hold the wheel shortcut, aim toward a section, and release to run it. You can
move beyond the visible ring. Return to the center or press Escape to cancel.
The **Open wheel** button opens the same native overlay; click a section to run
it, or click the center, right-click, or press Escape to dismiss it.

Long names wrap within their sections. A dimmed command keeps its icon but
cannot run in the current context. A plus indicates an empty or missing
assignment. Disabled commands can be assigned for use when a document or layer
supports them; the Remove tool is temporarily blocked entirely.

The default eight-slot wheel, clockwise from the top:

| Direction | Command |
| --- | --- |
| Up | New layer |
| Upper right | Levels |
| Right | Delete selected layers |
| Lower right | Missing ping |
| Down | Invert colors |
| Lower left | Invert selection |
| Left | Fill with foreground color |
| Upper left | Hue / Saturation |

Older starter wheels migrate once to this layout. Custom wheels, action
assignments, and later edits are preserved.

## Shortcuts

Open **Shortcuts**, choose the binding to change, press a key or supported mouse
button, release it, then choose **Save**. Search opens on press; the wheel selects
on release. Inputs assigned to Reflex replace their normal Photoshop behavior
while Reflex is connected and Photoshop is active.

The default bindings are Ctrl + Alt + K and Ctrl + Alt + W. On Mac the equivalent
modifiers are Control + Option, and Command bindings can be recorded. Mac host
behavior still needs validation. Command bindings are preserved when settings
move between operating systems; record a new binding to use it on Windows.

## Appearance

Use the gear button for **Appearance**. Choose Mono, Pink, Ice, Mint, Lime, Amber,
Coral, or Violet, or enter a custom hex color. Minimal, Soft, and Bold control
color coverage. Icon tint is optional. Trebuchet MS, Arial, and Verdana are
available as system-font choices.

All accents are solid colors. Saved Thermal settings switch to Pink. Reset
appearance leaves wheels, favorites, and shortcut assignments intact.

## Missing ping

Search for `Missing ping`, `enemy missing`, `league`, or `question mark`.
Assign it to a wheel slot to drop one gold question mark per activation.
Repeated triggers create independent pings at their own cursor positions.

The overlay is silent, passes clicks through, and never edits the document.
Pings fade automatically; Escape, switching apps, or unloading Reflex clears
them. It also works with no document open.

## Troubleshooting

If the wheel or shortcuts do not work, read **Shortcuts → Shortcut status**.
Unload older development copies and stop the old companion. Close Photoshop
before installing an updated CCX because it can keep the previous native
component loaded.

Cancelling a Photoshop dialog should briefly show **Action cancelled.** in the
footer. Genuine execution failures still show an error. An ambiguous menu API
failure cannot always be identified as cancellation.

When reporting a problem, include Reflex and Photoshop versions, the operating
system, the command or binding used, the document/layer type, and the exact error.
See [command verification](command-verification.md) for the tested behaviors
and [the release checklist](release-checklist.md) for outstanding host checks.
