'use strict';

(function () {
  // ─── Config ───────────────────────────────────────────────────────────────

  var WRAPPER_SELECTOR = '.highchart.fund-compare[data-id]';
  var FUNDNAME_PAID = 'Wartość wpłat';
  var FUNDNAME_CURRENT = 'Aktualna wartość inwestycji';
  var PROCESSED_ATTR = 'data-conseq-perf-injected';
  var HIGHCHARTS_POLL_MS = 250;
  var HIGHCHARTS_POLL_MAX_TRIES = 20;
  var ORIGINAL_CHART_SELECTOR = '[data-highcharts-chart]';
  var SYNC_POLL_MS = 250;
  var SYNC_POLL_MAX_TRIES = 20;

  // ─── Extraction ───────────────────────────────────────────────────────────

  // Pure: parses a raw data-chart-data string into a point array, or null if
  // it's missing/malformed. No DOM involved, so this is unit-testable as-is.
  function parseChartDataAttr(raw) {
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  // Impure: the only part of extraction that actually touches the DOM.
  function readDefinitionRecords(wrapper) {
    var records = [];
    wrapper.querySelectorAll('.chart-definitions .chart-definition').forEach(function (el) {
      records.push({
        fundname: el.getAttribute('data-fundname'),
        unit: el.getAttribute('data-unit'),
        rawChartData: el.getAttribute('data-chart-data')
      });
    });
    return records;
  }

  // Pure: given plain { fundname, unit, rawChartData } records (in any order,
  // with any extras), picks out the paid-in/current-value pair by name and
  // parses their chart data. This is where the actual matching/validation
  // rules live, so it's the piece most worth unit testing.
  function extractSeriesFromRecords(records) {
    var paid = null;
    var current = null;

    records.forEach(function (record) {
      if (record.fundname === FUNDNAME_PAID) paid = record;
      if (record.fundname === FUNDNAME_CURRENT) current = record;
    });

    if (!paid || !current) return null;

    var paidPoints = parseChartDataAttr(paid.rawChartData);
    var currentPoints = parseChartDataAttr(current.rawChartData);

    if (!paidPoints || !currentPoints) return null;

    var unit = paid.unit || current.unit || 'PLN';

    return { paidPoints: paidPoints, currentPoints: currentPoints, unit: unit };
  }

  function extractSeries(wrapper) {
    var series = extractSeriesFromRecords(readDefinitionRecords(wrapper));
    if (!series) {
      console.warn('[Conseq Performance Chart] could not find both series in', wrapper);
    }
    return series;
  }

  function computePerformanceSeries(paidPoints, currentPoints) {
    var currentByTimestamp = new Map();
    currentPoints.forEach(function (point) {
      currentByTimestamp.set(point[0], point[1]);
    });

    var result = [];
    var skipped = 0;

    paidPoints.forEach(function (point) {
      var timestamp = point[0];
      var paidValue = point[1];
      if (!currentByTimestamp.has(timestamp)) {
        skipped += 1;
        return;
      }
      var currentValue = currentByTimestamp.get(timestamp);
      result.push([timestamp, currentValue - paidValue]);
    });

    if (skipped > 0) {
      console.warn('[Conseq Performance Chart] ' + skipped + ' point(s) skipped due to timestamp mismatch');
    }

    if (result.length === 0) {
      return null;
    }

    result.sort(function (a, b) {
      return a[0] - b[0];
    });

    return result;
  }

  // Pure: for each point, how far below the running peak-so-far it is, as a
  // percentage (always <= 0). Divides by the peak itself (which only ever
  // rises) rather than by the current value, so unlike a raw profit-percent
  // series this never blows up near a zero crossing. Guards peak <= 0 (only
  // possible before the very first positive point) to avoid a division that
  // would flip the sign the wrong way.
  function computeDrawdownSeries(points) {
    if (!points || points.length === 0) return null;

    var sorted = points.slice().sort(function (a, b) {
      return a[0] - b[0];
    });

    var peak = null;
    var result = [];

    sorted.forEach(function (point) {
      var timestamp = point[0];
      var value = point[1];
      if (peak === null || value > peak) {
        peak = value;
      }
      var drawdown = peak > 0 ? ((value - peak) / peak) * 100 : 0;
      result.push([timestamp, drawdown]);
    });

    return result;
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  // Pure: formats an axis value as "1 000 PLN" — space-grouped every 3
  // digits, no decimals, unit suffix — matching the original chart's axis
  // label style. Not locale-based: pl-PL's Intl grouping only kicks in at
  // 5+ digits (CLDR leaves 4-digit numbers ungrouped), which doesn't match
  // the "1 000" style wanted here, so digits are grouped by hand instead.
  function formatAxisAmount(value, unit) {
    var rounded = Math.round(value);
    var digits = Math.abs(rounded).toString();
    var grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    var sign = rounded < 0 ? '-' : '';
    return sign + grouped + ' ' + unit;
  }

  // Pure: formats a drawdown value as "-12%". No decimals, matching the
  // integer-PLN style of formatAxisAmount. Relies on JS stringifying -0 as
  // "0" (no minus sign), so no special-casing is needed for values that
  // round to zero.
  function formatPercent(value) {
    return Math.round(value) + '%';
  }

  function findOriginalChart(wrapper) {
    var target = wrapper.querySelector(ORIGINAL_CHART_SELECTOR);
    if (!target || !window.Highcharts || !Array.isArray(window.Highcharts.charts)) {
      return null;
    }
    var index = Number(target.getAttribute('data-highcharts-chart'));
    if (isNaN(index)) return null;

    var chart = window.Highcharts.charts[index];
    return (chart && chart.xAxis && chart.xAxis[0]) ? chart : null;
  }

  // Mirrors the original chart's range-selector (YTD / 1R / 3L / 5L / Max)
  // onto our chart, since those buttons only call setExtremes() on the
  // original chart's own xAxis and have no idea we exist.
  function syncPeriodSelection(wrapper, ourChart) {
    var tries = 0;

    function trySync() {
      var originalChart = findOriginalChart(wrapper);
      if (!originalChart) {
        tries += 1;
        if (tries >= SYNC_POLL_MAX_TRIES) {
          console.warn('[Conseq Performance Chart] original chart never found; period buttons will not affect this chart');
          return;
        }
        setTimeout(trySync, SYNC_POLL_MS);
        return;
      }

      var originalAxis = originalChart.xAxis[0];
      var ourAxis = ourChart.xAxis[0];

      var extremes = originalAxis.getExtremes();
      if (typeof extremes.min === 'number' && typeof extremes.max === 'number') {
        ourAxis.setExtremes(extremes.min, extremes.max, true, false);
      }

      Highcharts.addEvent(originalAxis, 'afterSetExtremes', function (e) {
        ourAxis.setExtremes(e.min, e.max);
      });
    }

    trySync();
  }

  // Polls for window.Highcharts (only available once the portal's own script
  // has run) and calls back once it exists, capped at HIGHCHARTS_POLL_MAX_TRIES
  // attempts. Shared by every renderer here so each doesn't reimplement the
  // same wait loop.
  function withHighcharts(callback) {
    var tries = 0;

    function attempt() {
      if (window.Highcharts) {
        callback(window.Highcharts);
        return;
      }

      tries += 1;
      if (tries >= HIGHCHARTS_POLL_MAX_TRIES) {
        console.error('[Conseq Performance Chart] window.Highcharts never became available, giving up');
        return;
      }
      setTimeout(attempt, HIGHCHARTS_POLL_MS);
    }

    attempt();
  }

  function renderChart(container, performanceData, unit, wrapper) {
    var formatter = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: unit });

    withHighcharts(function (Highcharts) {
      var chart = Highcharts.chart(container, {
        chart: { type: 'area' },
        title: { text: null },
        credits: { enabled: false },
        xAxis: {
          type: 'datetime',
          labels: {
            formatter: function () {
              return Highcharts.dateFormat('%d.%m.%Y', this.value);
            }
          }
        },
        yAxis: {
          title: { text: null },
          labels: {
            formatter: function () {
              return formatAxisAmount(this.value, unit);
            }
          },
          plotLines: [{ value: 0, width: 1, color: '#999' }]
        },
        tooltip: {
          formatter: function () {
            return Highcharts.dateFormat('%Y-%m-%d', this.x) + '<br/>' + formatter.format(this.y);
          }
        },
        legend: { enabled: false },
        plotOptions: {
          area: {
            threshold: 0,
            zoneAxis: 'y',
            marker: { enabled: false }
          }
        },
        series: [
          {
            name: 'Wynik',
            data: performanceData,
            zones: [
              { value: 0, color: '#d9534f' },
              { color: '#5cb85c' }
            ]
          }
        ]
      });

      syncPeriodSelection(wrapper, chart);
    });
  }

  function renderDrawdownChart(container, drawdownData, wrapper) {
    withHighcharts(function (Highcharts) {
      var chart = Highcharts.chart(container, {
        chart: { type: 'area' },
        title: { text: null },
        credits: { enabled: false },
        xAxis: {
          type: 'datetime',
          labels: {
            formatter: function () {
              return Highcharts.dateFormat('%d.%m.%Y', this.value);
            }
          }
        },
        yAxis: {
          title: { text: null },
          max: 0,
          labels: {
            formatter: function () {
              return formatPercent(this.value);
            }
          }
        },
        tooltip: {
          formatter: function () {
            return Highcharts.dateFormat('%Y-%m-%d', this.x) + '<br/>' + formatPercent(this.y);
          }
        },
        legend: { enabled: false },
        plotOptions: {
          area: {
            threshold: 0,
            color: '#d9534f',
            fillOpacity: 0.3,
            marker: { enabled: false }
          }
        },
        series: [
          { name: 'Obsunięcie', data: drawdownData }
        ]
      });

      syncPeriodSelection(wrapper, chart);
    });
  }

  // ─── Injection ────────────────────────────────────────────────────────────

  function buildChartContainer(afterElement, height, options) {
    var figure = document.createElement('figure');
    figure.className = 'chart ' + options.figureClass;

    var title = document.createElement('div');
    title.className = 'chart-performance__title';
    title.textContent = options.title;
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '8px';

    var chartDiv = document.createElement('div');
    chartDiv.className = options.chartClass;
    chartDiv.style.height = height + 'px';
    chartDiv.style.width = '100%';

    figure.appendChild(title);
    figure.appendChild(chartDiv);

    afterElement.insertAdjacentElement('afterend', figure);

    return { figure: figure, chartDiv: chartDiv };
  }

  function processChart(wrapper) {
    wrapper.setAttribute(PROCESSED_ATTR, 'true');

    var series = extractSeries(wrapper);
    if (!series) {
      wrapper.setAttribute(PROCESSED_ATTR, 'skipped-missing-series');
      return;
    }

    var performanceData = computePerformanceSeries(series.paidPoints, series.currentPoints);
    if (!performanceData) {
      wrapper.setAttribute(PROCESSED_ATTR, 'skipped-no-overlap');
      return;
    }

    var originalFigure = wrapper.closest('figure.chart') || wrapper.parentElement;
    var height = wrapper.getAttribute('data-height') || '300';

    var performanceContainer = buildChartContainer(originalFigure, height, {
      figureClass: 'chart--conseq-performance',
      chartClass: 'conseq-performance-chart',
      title: 'Wynik (zysk / strata)'
    });
    renderChart(performanceContainer.chartDiv, performanceData, series.unit, wrapper);

    var drawdownData = computeDrawdownSeries(series.currentPoints);
    if (!drawdownData) {
      console.warn('[Conseq Performance Chart] could not compute drawdown series, skipping drawdown chart');
      return;
    }

    var drawdown = buildChartContainer(performanceContainer.figure, height, {
      figureClass: 'chart--conseq-drawdown',
      chartClass: 'conseq-drawdown-chart',
      title: 'Obsunięcie kapitału (drawdown)'
    });
    renderDrawdownChart(drawdown.chartDiv, drawdownData, wrapper);
  }

  function processAll(root) {
    (root || document).querySelectorAll(WRAPPER_SELECTOR).forEach(function (wrapper) {
      if (wrapper.hasAttribute(PROCESSED_ATTR)) return;
      processChart(wrapper);
    });
  }

  // ─── Observer + Init ──────────────────────────────────────────────────────

  // Guarded so this file can be require()'d under Node (see Exports below)
  // for unit tests without needing a DOM.
  if (typeof document !== 'undefined') {
    processAll();

    var debounceTimer = null;
    var observer = new MutationObserver(function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        processAll();
      }, 200);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Exports ──────────────────────────────────────────────────────────────

  // No-op in the browser (no `module` global there). Lets tests/ require()
  // the pure functions above directly, with no bundler and no build step.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseChartDataAttr: parseChartDataAttr,
      extractSeriesFromRecords: extractSeriesFromRecords,
      computePerformanceSeries: computePerformanceSeries,
      formatAxisAmount: formatAxisAmount,
      computeDrawdownSeries: computeDrawdownSeries,
      formatPercent: formatPercent
    };
  }
})();
