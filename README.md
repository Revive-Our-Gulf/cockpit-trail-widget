# cockpit-trail-widget

## How to setup
1. Go to the [Releases](https://github.com/Revive-Our-Gulf/cockpit-trail-widget/releases).
2. Download the latest trail_widget_config.json file.
3. Import the .json into your Cockpit interface:
    * In Cockpit go to 'Edit Interface'
    * Select the 'Regular' widget type in the widgets menu
    * Add a new DIY widget
    * At the bottom of the newly added DIY widget click 'Import'
    * Import the .json file downloaded from the release section

## How to use
- Click <img src="./icons/file-import.svg" width="16" height="16" style="vertical-align: middle; background: white; border-radius: 50%;" /> to import a .kml or .gpx.
- Use <img src="./icons/compass.svg" width="16" height="16" style="vertical-align: middle; background: white; border-radius: 50%;" /> / <img src="./icons/navigation.svg" width="16" height="16" style="vertical-align: middle; background: white; border-radius: 50%;" /> to toggle between North-up and ROV-up modes.
- Use <img src="./icons/chevron-up.svg" width="16" height="16" style="vertical-align: middle; background: white; border-radius: 50%;" /> / <img src="./icons/chevron-down.svg" width="16" height="16" style="vertical-align: middle; background: white; border-radius: 50%;" />  to open and close the targets menu.
- Click <img src="./icons/map-marker-remove.svg" width="16" height="16" style="vertical-align: middle; background: white; border-radius: 50%;" /> to erase all targets.
- Click <img src="./icons/eraser.svg" width="16" height="16" style="vertical-align: middle; background: white; border-radius: 50%;" /> to clear the ROV trail.
- In the target menu:
    - Click <img src="./icons/target.svg" width="16" height="16" style="vertical-align: middle; background: white; border-radius: 50%;" /> to set corresponding target to the current target.
    - Click <img src="./icons/close.svg" width="16" height="16" style="vertical-align: middle; background: white; border-radius: 50%;" /> to remove corresponding target.
    - Use <img src="./icons/drag.svg" width="16" height="16" style="vertical-align: middle; background: white; border-radius: 50%;" /> to reorder targets if needed.

## Developer workflow (modular + testable + BlueOS export)

BlueOS DIY widgets need one HTML, one CSS, and one JS blob. This repo now supports a split workflow:

1. Write reusable logic in normal module files (example: `src/lib/geo.js`).
2. Unit test those modules with Vitest.
3. Build BlueOS-ready single-file snippets and a generated widget config JSON.

Current widget source files are:

- `src/widget.html`
- `src/widget.css`
- `src/main.js`

### Install dependencies

```bash
npm install
```

### Run tests

```bash
npm run unit-test:all-files
```

Run tests for only one file:

```bash
npm run unit-test:current-file -- test/unit/geo.test.js
```

### Run local preview (with mocked datalake)

```bash
npm run run-locally
```

Then open http://localhost:5173.

### Build BlueOS outputs

```bash
npm run generate-json
```

Outputs are written to `dist/`:

- `dist/widget-snippets.json` (single HTML/CSS/JS strings)
- `dist/cockpit-trail-widget-config.generated.json` (ready to import into Cockpit)
- `dist/blueos-copy-paste.md` (copy/paste-friendly snippets)

### Optional module-first JS entry

The build script supports both modes:

- If `src/main.js` exists, it bundles modules with esbuild into one JS output.
- Otherwise it uses `src/widget.js` directly as the JS source.

This lets you migrate from a monolithic script to module files gradually without breaking releases.
