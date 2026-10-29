# Feedback Alley

Block-and-layer feedback displays for [Bitfocus Companion](https://bitfocus.io/companion).
Inspired by [Companion Dashboard](https://github.com/tomhillmeyer/companion-dashboard), with a different layout model.

## User guide

The full [user guide](public/guide/index.html) is built into the app (the **?** button in the editor's top bar, or **Help → Feedback Alley User Guide**) and attached to each release as a PDF.

## Install

Download the installer for your computer from the project's **Releases** page:

| | |
|---|---|
| macOS (Apple Silicon: M1 and later) | `Feedback-Alley-<version>-mac-arm64.dmg` |
| macOS (Intel) | `Feedback-Alley-<version>-mac-x64.dmg` |
| Windows | `Feedback-Alley-<version>-windows-setup.exe` |
| Linux | `Feedback-Alley-<version>-linux-x86_64.AppImage` |

The app isn't code-signed yet, so the first launch shows a warning:

- **macOS:** open the app once and dismiss the warning, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
  If that button doesn't appear, run this once in Terminal instead: `xattr -dr com.apple.quarantine "/Applications/Feedback Alley.app"`
- **Windows:** on the SmartScreen prompt click **More info → Run anyway**.

Opening the app starts the editor in a window, and the server that displays connect to.
- **Displays** open in any browser, on this machine or others on the network. **File → Copy Network Address** gives the address to use. Every screen can also have its own port (see below).
- **Closing:** on macOS, closing the window keeps Feedback Alley running for your displays; quit it with ⌘Q. On Windows and Linux, closing the window quits the app.
- **Port:** the app uses port 8090, or the next free one if 8090 is taken (it warns when that happens). To pick another port, put `{"port": 9000}` in `app-settings.json` next to the data folder.
- **Your project** is saved in the app's data folder (**File → Show Data Folder**):
  `~/Library/Application Support/Feedback Alley/data` on macOS, `%APPDATA%\Feedback Alley\data` on Windows.
  Use **⚙ Settings → Export / Import** to move a project between machines.

## Run from source

```bash
npm install
npm run dev          # editor at http://localhost:5173 (API included)
npm run app          # the desktop app, from source
```

Without the desktop app, on a show machine with Node installed:

```bash
npm run build
npm start            # http://<this-machine>:8090  (PORT, HOST, DATA_DIR env vars)
```

From source, the project is saved in `data/` (`data/store.json`, uploaded images in `data/assets/`). Set `DATA_DIR` to use another folder (works for `npm run dev`, `npm start` and `npm run app`).

## Displays

- Editor: `http://host:8090/`
- Display output: give a screen its own port (Screen → Display output → *Serve this screen on its own port*),
  and it is shown at `http://host:<port>/` with nothing after the port. Change the port, or move it to
  another screen, at any time; open displays follow. Every screen is also available at
  `http://host:8090/#/display/<screenId>`. Double-click a display to go full screen. The cursor hides when idle,
  and edits show up live.

Open **⚙ Settings** to point connection `[0]` at Companion (usually `http://<ip>:8000`).
The server talks to Companion, so browsers never hit CORS problems.

## Releasing

1. Bump `version` in `package.json` and commit.
2. `git tag v<version> && git push && git push --tags`
3. GitHub Actions builds the macOS, Windows and Linux installers and attaches them to a **draft release**. Review it on GitHub and click **Publish**.

To build locally: `npm run dist:mac`, `npm run dist:win` or `npm run dist:linux` (output in `release/`).

## Concepts

| | |
|---|---|
| **Screen** | A layout with a fixed aspect ratio (16:9, 4:3, 32:9, 9:16, custom…). It is resolution-independent: the same 16:9 screen fills 1280×720, 1920×1080 or 3840×2160 exactly. |
| **Block** | A positioned box on the screen (fill, border, radius, opacity, feedback rules, optional Companion button press). |
| **Layer** | Content inside a block: **Text**, **Shape**, **Image** or **Bar/meter**. Layers are positioned in % of their block, so they resize with it, or set **Sizing → Fixed** to keep a layer's size, pinned to an anchor point. Any layer except a group can have a **header**: a strip on one side with its own fill and text, resized by dragging its divider. Text can auto-fit its layer. Every layer can have its own background color and/or image and rounded corners. |
| **Group** | A layer that holds other layers: a block within a block. Its children are positioned in % of the group, so they follow it, and groups can be nested. A group has its own background, border, corners, clipping and feedback rules (e.g. hide or color a whole cluster at once). |
| **Template** | One or more blocks saved with their layers and rules. **Drag** a template onto the screen to place it (it snaps like a move), or click **Insert** to put it where it was saved. When the aspect ratio differs, blocks keep their real proportions. |

**% or px.** Layouts are stored relative to their parent so they scale to any output, but you can work in either unit: switch **% / px** in the toolbar (or above any position fields). Each screen has a **pixel size** (e.g. 1920×1080 or 3840×2160, set in the screen's settings). In px mode, block positions are pixels from the screen's top-left, and layer positions are pixels from their block's or group's top-left. Dragging and resizing land on whole pixels, arrows nudge 1px (Shift 10px), and the grid is in pixels. Border widths and corner radii are always in screen pixels. Changing the pixel size scales them so the layout looks the same.

## Feedback (from Companion Dashboard, extended)

- Variables in any text, color or image field: `$(internal:time_hms)`, `[1]$(atem:pgm)` for other connections, `\$(…)` for literal output (no markdown).
- **Tidy inspector:** a block's or layer's sections start collapsed the first time you select it, and each remembers which sections you opened.
- **Find & Replace** (block inspector, above Layers): every variable and piece of text a block uses, each with an editable copy. Rename a connection once (`device1` → `device2`), find and replace across all of them, or edit one by one, with a live check of each new name; then **Duplicate with changes** or **Apply**. Works on several blocks at once.
- Text formatting for any selected words or variables, using the toolbar above the text box (⌘B / ⌘I / ⌘U):
  `**bold**`, `_italic_` (or `*italic*`), `++underline++`, `~~strike~~`, `{color:#f00}…{/color}`,
  `{bg:#ff0}…{/bg}` (highlight), `{size:150%}…{/size}` (relative to the layer's text), plus `{weight:300}` and
  `{font:Oswald}`. **Clear** removes formatting.
- Line spacing (× text size) and paragraph spacing per text layer. Enter (or `\n`) is a new line; a blank line
  starts a new paragraph.
- Colors can come from variables, including Companion's decimal color integers.
- **Rules** on screens, blocks and layers: *when* one or more conditions match (`= ≠ > ≥ < ≤ contains`, `is empty` …, compared against a literal or another variable, all/any), *then* set fill, text color, border color, layer background color, opacity, visibility, flash (the whole item, or its fill, border, text, background or header; blinking or alternating with a color; slow, normal or fast) or replacement text, and for layers with a header, the header's fill, text color, text and visibility. Rules are checked top to bottom, and the first match wins per property. A green dot shows which rules match right now.
- "Hidden" items stay hidden unless a rule shows them, e.g. an ON AIR tag.
- Bar layers turn a numeric variable (min–max) into a progress bar or meter in any direction.
  - **Countdown / elapsed:** set *Shows* to *Countdown (time left)* and give it the time-left variable and the duration (a variable, or typed like `2:20`). The bar fills from empty to full as the time counts down to 0. *Time elapsed* does the same for a clock that counts up. Times can be `ss`, `m:ss`, `h:mm:ss`, `hh:mm:ss:ff` (frames ignored) or a bare number of seconds or milliseconds. *Smooth* keeps the bar gliding between once-a-second updates; if playback pauses it stops within one update.
  - **Reverse** starts the bar full and empties it instead.
  - **Color thresholds:** e.g. at 80 turn amber, at 90 turn red. Measure them in the bar's own values (numbers, or time left/elapsed such as `0:30`) or in % of the bar. The furthest threshold reached wins; a feedback rule that sets the fill overrides thresholds.
- Clicking a block on a display can press a Companion button (`page/row/column`).
- Color fade transitions and poll rate are set in Settings.

## Editor shortcuts

| | |
|---|---|
| Drag / handles | Move and resize. **Shift** keeps proportions, **Alt** disables snapping |
| Shift/⌘-click, drag on empty space | Multi-select / marquee |
| Double-click a block, or Enter | Edit its layers. Double-click a group (or Enter) to work inside it |
| Esc | Step out one level: layer selection → group → block → screen |
| Shift/⌘-click layers, ⌘A | Select several layers in the same block or group |
| ⌘G / ⇧⌘G | Group the selected layers / ungroup (on-screen positions are kept) |
| Arrows (+Shift) | Nudge 0.1% (1%), or 1px (10px) when working in px |
| Pinch, or ⌘/Ctrl + scroll | Zoom toward the pointer (10%–800%; 100% = whole screen fits) |
| ⌘+ / ⌘− / ⌘0 | Zoom in / out / back to 100%. The toolbar also has −/+, a slider and a typed % |
| Scroll, Space+drag, middle-drag | Pan while zoomed |
| ⌘Z / ⇧⌘Z, ⌘D, ⌘C / ⌘V, ⌫ | Undo/redo, duplicate, copy/paste, delete |

## Layout

```
server/api.js        storage, Companion proxy (variables, button press), image uploads
server/index.js      production server
src/types.ts         data model
src/lib/             variables, rules, defaults/templates, store + undo, polling
src/render/          ScreenView: the renderer shared by the editor and displays
src/editor/          canvas, inspector, rules editor, panels, settings
src/Display.tsx      full-screen output
```

## License

[MIT](LICENSE)
