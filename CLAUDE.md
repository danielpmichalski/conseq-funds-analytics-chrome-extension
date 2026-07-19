# CLAUDE.md

Guidance for Claude Code sessions working in this repo.

## What this is

A personal, unpublished Chrome extension (Manifest V3) for the Conseq Funds client portal (`*.conseq.pl`, private, requires login). The portal's own investment chart shows only totals — amount paid in vs. current portfolio value. This extension injects a second chart directly below it showing actual performance: `current value − amount paid in`, over time.

It does **not** scrape, transmit, or store any data off-page — it reads chart data already embedded in the portal's HTML and renders a new chart in-page using the portal's own already-loaded Highcharts instance.

Management fees appear to already be netted into the `Wartość wpłat` (amount paid in) series itself: the portal's account summary header labels the equivalent figure "Wpłaty po odliczeniu odkupów i opłat" ("deposits after deducting redemptions **and fees**"), and that value matches the series. So `current − paid` is likely already net of fees, not gross — there's no separate fee figure to subtract, and no fee logic to add. This is inferred from the label/figure match, not from an itemized fee breakdown, so treat it as a reasonable working assumption rather than a certainty.

## Architecture

No bundler, no build tool — the extension itself is plain vanilla JS loaded directly by Chrome. There is a root `package.json`, but it exists purely to run the Node-based unit tests below (`"scripts": { "test": ... }`, no dependencies) — it plays no part in loading or building the extension.

```
extension/
  manifest.json   — MV3 config: host_permissions + content_scripts only (no background, no popup/action)
  content.js       — all logic: extraction, diffing, chart injection, rendering
  images/          — extension icons (flat placeholder PNGs, fine as-is for a personal tool)
tests/
  content.test.js  — unit tests for the pure functions exported from content.js
build.sh           — zips extension/ into conseq-performance-chart.zip at repo root
package.json       — `npm test` only; no dependencies, no build/bundle scripts
```

`content.js` is a single `'use strict'` IIFE, organized into commented sections: Config / Extraction / Rendering / Injection / Observer + Init / Exports. Keep new code in the matching section rather than adding new files — this project deliberately stays single-file.

The **Exports** section at the bottom guards a `module.exports` assignment behind `typeof module !== 'undefined'`, and the **Observer + Init** section guards its DOM-touching startup code behind `typeof document !== 'undefined'`. Together these let `tests/content.test.js` `require('../extension/content.js')` under Node with zero side effects (no `module` global in the browser, no `document` global in Node), while the browser still runs exactly as before. When adding a new pure function worth testing, add it to that `module.exports` object rather than creating a parallel copy for tests.

## Key page structure it depends on

```html
<figure class="chart">
  <div class="highchart fund-compare" data-height="422" data-id="fund_chart">
    <div class="chart-definitions">
      <div class="chart-definition" data-chart-data="[[ts,val],...]" data-fundname="Aktualna wartość inwestycji" data-unit="PLN"></div>
      <div class="chart-definition" data-chart-data="[[ts,val],...]" data-fundname="Wartość wpłat" data-unit="PLN"></div>
    </div>
    <div id="fund_chart" data-highcharts-chart="16"><!-- rendered by the portal's own Highcharts Stock 6.1.0 --></div>
  </div>
</figure>
```

- `data-chart-data` is present in server-rendered HTML — no need to wait for the portal's own chart to render, only for `window.Highcharts` to exist.
- Always match series by the exact `data-fundname` string (`Wartość wpłat` / `Aktualna wartość inwestycji`), never by child order — order isn't guaranteed.
- The block is duplicated for desktop/mobile carousels (ids `fund_chart` / `fund_chart2`) with identical structure. Process every match found; CSS visibility handles which one is actually shown to the user. Never assume a container `id` is unique — pass DOM elements to `Highcharts.chart()`, never string ids.
- Timestamps between the two series may not perfectly overlap in general — build a `Map` and diff by timestamp lookup, don't zip arrays positionally.
- The original chart has its own Highcharts Stock range selector (the YTD / 1R / 3L / 5L / Max buttons, labeled "Okres" in Polish). Clicking one just calls `setExtremes()` on the original chart's own xAxis — it doesn't touch the DOM or reload data, so our chart has no way to observe it except through the Highcharts API. `findOriginalChart()` locates the live chart instance via the `data-highcharts-chart="<index>"` attribute Highcharts stamps on its target div (`window.Highcharts.charts[index]`), and `syncPeriodSelection()` mirrors its extremes onto our chart's xAxis, both on initial render and via an `afterSetExtremes` listener for subsequent clicks. If the original chart instance can't be found (bounded retries, same pattern as the `window.Highcharts` poll), sync is skipped with a `console.warn` — the performance chart still renders, just unsynced. Don't try to duplicate the range-selector buttons on our own chart; mirroring the original's extremes is simpler and keeps a single source of truth for the selected period.

## Coding conventions

- Plain ES5/ES6-safe vanilla JS (no build step to transpile, and the host page runs an old Highcharts Stock 6.1.0 — keep chart options compatible with that API surface).
- No dependencies, no `chrome.storage`/`chrome.tabs`/`chrome.scripting` APIs unless a feature actually needs them — don't add a `permissions` array speculatively.
- Mark processed DOM nodes (`data-conseq-perf-injected`) before doing async work (e.g. waiting for `Highcharts` to load), so the `MutationObserver` re-scan never double-injects.
- Fail quiet but visible: on missing/malformed data, `console.warn`/`console.error` and skip that chart — never throw, since one broken chart block shouldn't break the rest of the page.
- Keep `manifest.json` `host_permissions`/`matches` scoped to `*.conseq.pl` — don't broaden it.
- Prefer separating pure logic (string/array/object in, value out — e.g. `parseChartDataAttr`, `extractSeriesFromRecords`, `computePerformanceSeries`) from DOM/Highcharts-touching wrappers (e.g. `readDefinitionRecords`, `extractSeries`, `renderChart`). The pure half is what's actually worth unit testing; the DOM half is thin enough to only need a fixture/manual check (see Testing below).
- `content_scripts` must keep `"world": "MAIN"` in `manifest.json`. Content scripts default to an isolated JS world that shares the DOM with the page but *not* page-defined JS globals — `window.Highcharts` (set by the portal's own script) is invisible from the default isolated world, so `renderChart`'s poll for it silently times out (`console.error`, container stays empty) even though extraction/diffing succeed. `"world": "MAIN"` runs `content.js` in the page's own context so it can see `window.Highcharts` directly. Don't remove this to "sandbox" the script — it will break rendering silently, and the failure mode looks like a Highcharts config bug rather than a world-isolation one.

## Testing / verification

The target site is private and requires login, so there's no way to test end-to-end without the user's own session.

**Unit tests** — `npm test` (or `node --test tests/`) runs `tests/content.test.js` against the pure functions `content.js` exports (see Architecture above): chart-data parsing, series matching/validation, and the paid-vs-current diffing math. No dependencies, no jsdom — these functions take/return plain values, not DOM nodes. When you touch any of `parseChartDataAttr`/`extractSeriesFromRecords`/`computePerformanceSeries`, or extract a new pure function, add/update cases here first. Edge cases already covered: malformed/non-array JSON, missing series, out-of-order records, non-positional timestamp alignment, no-overlap → `null`.

**DOM/Highcharts logic** (extraction from real elements, chart injection, range-selector sync) isn't covered by the unit tests and still needs a fixture or the live site:

1. Pull a real (or representative) `data-chart-data` pair for both series — either from the user or from a previous scratch capture.
2. Build a minimal local fixture HTML file replicating the DOM structure above, with a `<script>` tag loading Highcharts from a CDN.
3. Load the unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → `extension/`) and open the fixture directly in Chrome to confirm the injected chart renders correctly and the console is clean.
4. `node --check extension/content.js` catches syntax errors quickly without needing a browser at all.

Real end-to-end confirmation (does it look right in the actual portal) is always the user's job — say so explicitly rather than claiming full verification.

## Notes on stray files

- `tmp.txt` / `tmp*.*` (gitignored) may appear in the working tree — these are scratch HTML captures the user pastes in for reference when discussing page structure. Treat them as read-only research material, never as something to copy into the extension verbatim or to commit.
