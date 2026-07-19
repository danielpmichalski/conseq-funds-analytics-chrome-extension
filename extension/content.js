'use strict';

(function () {
  // ─── Config ───────────────────────────────────────────────────────────────

  var WRAPPER_SELECTOR = '.highchart.fund-compare[data-id]';
  var FUNDNAME_PAID = 'Wartość wpłat';
  var FUNDNAME_CURRENT = 'Aktualna wartość inwestycji';
  var PROCESSED_ATTR = 'data-conseq-perf-injected';
  var HIGHCHARTS_POLL_MS = 250;
  var HIGHCHARTS_POLL_MAX_TRIES = 20;

  // ─── Extraction ───────────────────────────────────────────────────────────

  function parseChartData(el) {
    try {
      return JSON.parse(el.getAttribute('data-chart-data'));
    } catch (e) {
      console.warn('[Conseq Performance Chart] failed to parse data-chart-data', e);
      return null;
    }
  }

  function extractSeries(wrapper) {
    var definitions = wrapper.querySelectorAll('.chart-definitions .chart-definition');
    var paidEl = null;
    var currentEl = null;

    definitions.forEach(function (el) {
      var name = el.getAttribute('data-fundname');
      if (name === FUNDNAME_PAID) paidEl = el;
      if (name === FUNDNAME_CURRENT) currentEl = el;
    });

    if (!paidEl || !currentEl) {
      console.warn('[Conseq Performance Chart] could not find both series in', wrapper);
      return null;
    }

    var paidPoints = parseChartData(paidEl);
    var currentPoints = parseChartData(currentEl);

    if (!Array.isArray(paidPoints) || !Array.isArray(currentPoints)) {
      return null;
    }

    var unit = paidEl.getAttribute('data-unit') || currentEl.getAttribute('data-unit') || 'PLN';

    return { paidPoints: paidPoints, currentPoints: currentPoints, unit: unit };
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

  // ─── Rendering ────────────────────────────────────────────────────────────

  function renderChart(container, performanceData, unit) {
    var formatter = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: unit });
    var tries = 0;

    function tryRender() {
      if (window.Highcharts) {
        window.Highcharts.chart(container, {
          chart: { type: 'area' },
          title: { text: null },
          credits: { enabled: false },
          xAxis: { type: 'datetime' },
          yAxis: {
            title: { text: unit },
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
        return;
      }

      tries += 1;
      if (tries >= HIGHCHARTS_POLL_MAX_TRIES) {
        console.error('[Conseq Performance Chart] window.Highcharts never became available, giving up');
        return;
      }
      setTimeout(tryRender, HIGHCHARTS_POLL_MS);
    }

    tryRender();
  }

  // ─── Injection ────────────────────────────────────────────────────────────

  function buildPerformanceContainer(wrapper) {
    var originalFigure = wrapper.closest('figure.chart') || wrapper.parentElement;

    var figure = document.createElement('figure');
    figure.className = 'chart chart--conseq-performance';

    var title = document.createElement('div');
    title.className = 'chart-performance__title';
    title.textContent = 'Wynik (zysk / strata)';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '8px';

    var chartDiv = document.createElement('div');
    chartDiv.className = 'conseq-performance-chart';
    var height = wrapper.getAttribute('data-height') || '300';
    chartDiv.style.height = height + 'px';
    chartDiv.style.width = '100%';

    figure.appendChild(title);
    figure.appendChild(chartDiv);

    originalFigure.insertAdjacentElement('afterend', figure);

    return chartDiv;
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

    var container = buildPerformanceContainer(wrapper);
    renderChart(container, performanceData, series.unit);
  }

  function processAll(root) {
    (root || document).querySelectorAll(WRAPPER_SELECTOR).forEach(function (wrapper) {
      if (wrapper.hasAttribute(PROCESSED_ATTR)) return;
      processChart(wrapper);
    });
  }

  // ─── Observer + Init ──────────────────────────────────────────────────────

  processAll();

  var debounceTimer = null;
  var observer = new MutationObserver(function () {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      processAll();
    }, 200);
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
