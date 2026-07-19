'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseChartDataAttr,
  extractSeriesFromRecords,
  computePerformanceSeries,
  formatAxisAmount,
  computeDrawdownSeries,
  formatPercent,
  computeRunningPeakSeries,
  computePeriodChangeSeries,
  bucketPointsByPeriod
} = require('../extension/content.js');

test('parseChartDataAttr', async (t) => {
  await t.test('parses a valid array of points', () => {
    assert.deepEqual(parseChartDataAttr('[[1,2],[3,4]]'), [[1, 2], [3, 4]]);
  });

  await t.test('returns null for malformed JSON', () => {
    assert.equal(parseChartDataAttr('not json'), null);
  });

  await t.test('returns null for valid JSON that is not an array', () => {
    assert.equal(parseChartDataAttr('{"a":1}'), null);
  });

  await t.test('returns null for a missing attribute (null input)', () => {
    assert.equal(parseChartDataAttr(null), null);
  });
});

test('extractSeriesFromRecords', async (t) => {
  await t.test('matches paid/current series by fundname regardless of order', () => {
    const records = [
      { fundname: 'Aktualna wartość inwestycji', unit: 'PLN', rawChartData: '[[1,10]]' },
      { fundname: 'Wartość wpłat', unit: 'PLN', rawChartData: '[[1,5]]' }
    ];

    assert.deepEqual(extractSeriesFromRecords(records), {
      paidPoints: [[1, 5]],
      currentPoints: [[1, 10]],
      unit: 'PLN'
    });
  });

  await t.test('ignores unrelated definitions mixed in', () => {
    const records = [
      { fundname: 'Something else', unit: 'PLN', rawChartData: '[[9,9]]' },
      { fundname: 'Wartość wpłat', unit: 'PLN', rawChartData: '[[1,5]]' },
      { fundname: 'Aktualna wartość inwestycji', unit: 'PLN', rawChartData: '[[1,10]]' }
    ];

    assert.deepEqual(extractSeriesFromRecords(records), {
      paidPoints: [[1, 5]],
      currentPoints: [[1, 10]],
      unit: 'PLN'
    });
  });

  await t.test('returns null when the paid-in series is missing', () => {
    const records = [
      { fundname: 'Aktualna wartość inwestycji', unit: 'PLN', rawChartData: '[[1,10]]' }
    ];
    assert.equal(extractSeriesFromRecords(records), null);
  });

  await t.test('returns null when the current-value series is missing', () => {
    const records = [
      { fundname: 'Wartość wpłat', unit: 'PLN', rawChartData: '[[1,5]]' }
    ];
    assert.equal(extractSeriesFromRecords(records), null);
  });

  await t.test('returns null when either series has malformed chart data', () => {
    const records = [
      { fundname: 'Aktualna wartość inwestycji', unit: 'PLN', rawChartData: 'nope' },
      { fundname: 'Wartość wpłat', unit: 'PLN', rawChartData: '[[1,5]]' }
    ];
    assert.equal(extractSeriesFromRecords(records), null);
  });

  await t.test('falls back to the current series unit when paid unit is missing', () => {
    const records = [
      { fundname: 'Aktualna wartość inwestycji', unit: 'PLN', rawChartData: '[[1,10]]' },
      { fundname: 'Wartość wpłat', unit: null, rawChartData: '[[1,5]]' }
    ];
    assert.equal(extractSeriesFromRecords(records).unit, 'PLN');
  });

  await t.test('defaults unit to PLN when neither series has one', () => {
    const records = [
      { fundname: 'Aktualna wartość inwestycji', unit: null, rawChartData: '[[1,10]]' },
      { fundname: 'Wartość wpłat', unit: null, rawChartData: '[[1,5]]' }
    ];
    assert.equal(extractSeriesFromRecords(records).unit, 'PLN');
  });
});

test('computePerformanceSeries', async (t) => {
  await t.test('subtracts paid from current for each matching timestamp', () => {
    const result = computePerformanceSeries([[1, 100], [2, 200]], [[1, 150], [2, 180]]);
    assert.deepEqual(result, [[1, 50], [2, -20]]);
  });

  await t.test('skips timestamps missing from the current series', () => {
    const result = computePerformanceSeries([[1, 100], [2, 200], [3, 50]], [[1, 150], [3, 60]]);
    assert.deepEqual(result, [[1, 50], [3, 10]]);
  });

  await t.test('does not assume positional alignment between the two arrays', () => {
    const paid = [[3, 10], [1, 10], [2, 10]];
    const current = [[2, 12], [1, 11], [3, 13]];
    assert.deepEqual(computePerformanceSeries(paid, current), [[1, 1], [2, 2], [3, 3]]);
  });

  await t.test('sorts output by timestamp ascending', () => {
    const result = computePerformanceSeries([[3, 10], [1, 10]], [[3, 15], [1, 12]]);
    assert.deepEqual(result, [[1, 2], [3, 5]]);
  });

  await t.test('returns null when no timestamps overlap at all', () => {
    assert.equal(computePerformanceSeries([[1, 10]], [[2, 20]]), null);
  });

  await t.test('returns null for two empty arrays', () => {
    assert.equal(computePerformanceSeries([], []), null);
  });
});

test('formatAxisAmount', async (t) => {
  await t.test('groups thousands with a plain space and appends the unit', () => {
    assert.equal(formatAxisAmount(1000, 'PLN'), '1 000 PLN');
  });

  await t.test('groups larger numbers at every thousand', () => {
    assert.equal(formatAxisAmount(1234567, 'PLN'), '1 234 567 PLN');
  });

  await t.test('preserves the minus sign for negative values', () => {
    assert.equal(formatAxisAmount(-3000, 'PLN'), '-3 000 PLN');
  });

  await t.test('rounds to whole numbers (no decimals)', () => {
    assert.equal(formatAxisAmount(1000.6, 'PLN'), '1 001 PLN');
  });

  await t.test('handles values below the grouping threshold', () => {
    assert.equal(formatAxisAmount(500, 'PLN'), '500 PLN');
  });

  await t.test('handles zero', () => {
    assert.equal(formatAxisAmount(0, 'PLN'), '0 PLN');
  });
});

test('computeDrawdownSeries', async (t) => {
  await t.test('is zero while at or above the running peak, negative below it, with absolute distance as a third element', () => {
    const result = computeDrawdownSeries([[1, 100], [2, 150], [3, 120], [4, 150], [5, 90]]);
    assert.deepEqual(result, [[1, 0, 0], [2, 0, 0], [3, -20, -30], [4, 0, 0], [5, -40, -60]]);
  });

  await t.test('does not assume the input is already sorted by timestamp', () => {
    const result = computeDrawdownSeries([[3, 90], [1, 100], [2, 150]]);
    assert.deepEqual(result, [[1, 0, 0], [2, 0, 0], [3, -40, -60]]);
  });

  await t.test('a single point has zero drawdown', () => {
    assert.deepEqual(computeDrawdownSeries([[1, 100]]), [[1, 0, 0]]);
  });

  await t.test('returns null for an empty array', () => {
    assert.equal(computeDrawdownSeries([]), null);
  });

  await t.test('returns null for null input', () => {
    assert.equal(computeDrawdownSeries(null), null);
  });

  await t.test('guards against a non-positive peak instead of dividing by it', () => {
    const result = computeDrawdownSeries([[1, -50], [2, -100]]);
    assert.deepEqual(result, [[1, 0, 0], [2, 0, 0]]);
  });
});

test('formatPercent', async (t) => {
  await t.test('formats a negative drawdown', () => {
    assert.equal(formatPercent(-12), '-12.0%');
  });

  await t.test('keeps one decimal of precision', () => {
    assert.equal(formatPercent(-2.449), '-2.4%');
    assert.equal(formatPercent(-0.3), '-0.3%');
  });

  await t.test('handles zero without a stray minus sign', () => {
    assert.equal(formatPercent(-0.04), '0.0%');
    assert.equal(formatPercent(0), '0.0%');
  });
});

test('computeRunningPeakSeries', async (t) => {
  await t.test('tracks the running maximum seen so far', () => {
    const result = computeRunningPeakSeries([[1, 100], [2, 150], [3, 120], [4, 150], [5, 90]]);
    assert.deepEqual(result, [[1, 100], [2, 150], [3, 150], [4, 150], [5, 150]]);
  });

  await t.test('does not assume the input is already sorted by timestamp', () => {
    const result = computeRunningPeakSeries([[3, 90], [1, 100], [2, 150]]);
    assert.deepEqual(result, [[1, 100], [2, 150], [3, 150]]);
  });

  await t.test('a single point is its own peak', () => {
    assert.deepEqual(computeRunningPeakSeries([[1, 100]]), [[1, 100]]);
  });

  await t.test('returns null for an empty array', () => {
    assert.equal(computeRunningPeakSeries([]), null);
  });

  await t.test('returns null for null input', () => {
    assert.equal(computeRunningPeakSeries(null), null);
  });

  await t.test('carries negative peaks through unchanged (no positivity guard, unlike drawdown)', () => {
    const result = computeRunningPeakSeries([[1, -50], [2, -100], [3, -20]]);
    assert.deepEqual(result, [[1, -50], [2, -50], [3, -20]]);
  });
});

test('computePeriodChangeSeries', async (t) => {
  await t.test('diffs each point against the previous one', () => {
    const result = computePeriodChangeSeries([[1, 100], [2, 150], [3, 120], [4, 150]]);
    assert.deepEqual(result, [[2, 50], [3, -30], [4, 30]]);
  });

  await t.test('does not assume the input is already sorted by timestamp', () => {
    const result = computePeriodChangeSeries([[3, 120], [1, 100], [2, 150]]);
    assert.deepEqual(result, [[2, 50], [3, -30]]);
  });

  await t.test('output has one fewer point than the input', () => {
    const result = computePeriodChangeSeries([[1, 10], [2, 20], [3, 15]]);
    assert.equal(result.length, 2);
  });

  await t.test('returns null when there is only a single point (nothing to diff against)', () => {
    assert.equal(computePeriodChangeSeries([[1, 100]]), null);
  });

  await t.test('returns null for an empty array', () => {
    assert.equal(computePeriodChangeSeries([]), null);
  });

  await t.test('returns null for null input', () => {
    assert.equal(computePeriodChangeSeries(null), null);
  });

  await t.test('with a "month" period, diffs month-end values instead of every raw point', () => {
    const points = [
      [Date.UTC(2024, 0, 5), 100],
      [Date.UTC(2024, 0, 20), 110],
      [Date.UTC(2024, 1, 10), 130],
      [Date.UTC(2024, 2, 25), 125]
    ];
    const result = computePeriodChangeSeries(points, 'month');
    assert.deepEqual(result, [
      [Date.UTC(2024, 1, 10), 20],
      [Date.UTC(2024, 2, 25), -5]
    ]);
  });

  await t.test('with a "quarter" period, points in the same quarter collapse into one bucket', () => {
    const points = [
      [Date.UTC(2024, 0, 5), 100],
      [Date.UTC(2024, 1, 10), 130],
      [Date.UTC(2024, 2, 25), 125],
      [Date.UTC(2024, 3, 15), 140]
    ];
    const result = computePeriodChangeSeries(points, 'quarter');
    assert.deepEqual(result, [[Date.UTC(2024, 3, 15), 15]]);
  });

  await t.test('with a "year" period, points in the same year collapse into one bucket', () => {
    const points = [
      [Date.UTC(2023, 5, 1), 50],
      [Date.UTC(2023, 11, 31), 80],
      [Date.UTC(2024, 2, 1), 100]
    ];
    const result = computePeriodChangeSeries(points, 'year');
    assert.deepEqual(result, [[Date.UTC(2024, 2, 1), 20]]);
  });

  await t.test('with a "week" period, buckets by epoch-relative 7-day windows', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const points = [[0, 10], [3 * dayMs, 15], [10 * dayMs, 25]];
    const result = computePeriodChangeSeries(points, 'week');
    assert.deepEqual(result, [[10 * dayMs, 10]]);
  });

  await t.test('returns null when a period has too few buckets to diff', () => {
    const points = [[Date.UTC(2024, 0, 5), 100], [Date.UTC(2024, 0, 20), 110]];
    assert.equal(computePeriodChangeSeries(points, 'month'), null);
  });
});

test('bucketPointsByPeriod', async (t) => {
  await t.test('with no periodType, every point is its own bucket (identity)', () => {
    const points = [[3, 30], [1, 10], [2, 20]];
    assert.deepEqual(bucketPointsByPeriod(points), [[1, 10], [2, 20], [3, 30]]);
  });

  await t.test('keeps the last (chronologically latest) point per bucket', () => {
    const points = [
      [Date.UTC(2024, 0, 5), 100],
      [Date.UTC(2024, 0, 20), 110],
      [Date.UTC(2024, 1, 10), 130]
    ];
    const result = bucketPointsByPeriod(points, 'month');
    assert.deepEqual(result, [
      [Date.UTC(2024, 0, 20), 110],
      [Date.UTC(2024, 1, 10), 130]
    ]);
  });

  await t.test('returns null for an empty array', () => {
    assert.equal(bucketPointsByPeriod([]), null);
  });

  await t.test('returns null for null input', () => {
    assert.equal(bucketPointsByPeriod(null), null);
  });
});
