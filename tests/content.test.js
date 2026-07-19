'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseChartDataAttr,
  extractSeriesFromRecords,
  computePerformanceSeries
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
