import { describe, expect, it } from 'vitest';

import { limitChartResults, MAX_CHART_RESULTS, type Chart } from './answer-chart-data';

describe('answer chart result limits', () => {
  it('keeps only the ten highest categorical results without mutating the answer', () => {
    const chart: Chart = {
      id: 'brands',
      title: 'Brand sales',
      kind: 'bar',
      data: [
        {
          type: 'bar',
          orientation: 'h',
          x: Array.from({ length: 15 }, (_, index) => index + 1),
          y: Array.from({ length: 15 }, (_, index) => `Brand ${index + 1}`),
        },
      ],
      layout: {},
    };
    const before = JSON.stringify(chart);
    const limited = limitChartResults(chart);

    expect(limited[0].x).toHaveLength(MAX_CHART_RESULTS);
    expect(limited[0].x).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
    expect(limited[0].y).toEqual([
      'Brand 15',
      'Brand 14',
      'Brand 13',
      'Brand 12',
      'Brand 11',
      'Brand 10',
      'Brand 9',
      'Brand 8',
      'Brand 7',
      'Brand 6',
    ]);
    expect(JSON.stringify(chart)).toBe(before);
  });

  it('does not truncate time-series charts', () => {
    const chart: Chart = {
      id: 'trend',
      title: 'Trend',
      kind: 'line',
      data: [{ x: Array.from({ length: 30 }, (_, index) => index), y: Array.from({ length: 30 }, (_, index) => index) }],
      layout: {},
    };
    expect(limitChartResults(chart)).toBe(chart.data);
  });
});
