# conseq-funds-analytics-chrome-extension

A personal, unpublished Chrome extension for the Conseq Funds client portal (`*.conseq.pl`). The portal's own investment chart only shows totals — amount paid in vs. current portfolio value. This extension adds a second chart directly below it showing the actual investment performance: **current value − amount paid in**, over time, so real gains/losses are visible at a glance.

It reads the chart data that's already present in the page's HTML (`data-chart-data` attributes) and renders the new chart using the portal's own already-loaded Highcharts instance — no external libraries, no data leaves the page, no build step.

> **Note:** the management fee deducted from invested amounts is not shown separately — no fee figure could be found in the chart data available to the extension. The performance chart is therefore *before* fees, not net of them.

## Install / use locally

This extension is not published on the Chrome Web Store — it's loaded as an unpacked extension:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `extension/` folder in this repo.
4. Log in to your Conseq Funds client portal as usual and open the page with your fund chart. A second chart, titled "Wynik (zysk / strata)", should appear directly below the existing one — green where you're in profit, red where you're at a loss.

To pick up code changes, click the refresh icon on the extension's card in `chrome://extensions` and reload the portal page.

## Build

```sh
./build.sh
```

Zips the contents of `extension/` into `conseq-performance-chart.zip` at the repo root (e.g. for backing up a specific version, or sideloading elsewhere). This isn't required for local use — "Load unpacked" reads `extension/` directly.

## How it works

- `extension/content.js` runs on every `https://*.conseq.pl/*` page (see `extension/manifest.json`).
- It looks for `.highchart.fund-compare[data-id]` chart containers, and inside each one reads the two `.chart-definition` elements by their `data-fundname` attribute: `Wartość wpłat` (amount paid in) and `Aktualna wartość inwestycji` (current value).
- It computes `current − paid` for every matching timestamp and renders the result as a new chart, inserted right after the original chart's `<figure>`, using the portal's own global `Highcharts` object.
- A `MutationObserver` re-scans the page as it changes (e.g. carousel slides loading), so the chart appears even if the original loads asynchronously. Each processed chart is marked to avoid inserting duplicates.
- The original chart's period buttons (YTD / 1R / 3L / 5L / Max) are Highcharts' own range selector — they zoom the original chart's x-axis, nothing more. The extension finds that chart instance (via the `data-highcharts-chart` index Highcharts stamps on it) and mirrors its visible date range onto the new chart whenever it changes, so both charts stay in sync.

## Project structure

```
extension/
  manifest.json   — Manifest V3 config (host permissions, content script)
  content.js      — all extraction/rendering logic
  images/         — extension icons
build.sh          — zips extension/ for packaging
```
