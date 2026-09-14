export interface Chart {
  id: string;
  title: string;
  kind: string;
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
}

export const MAX_CHART_RESULTS = 10;

/** Return a display-only top ten for categorical charts; stored evidence stays complete. */
export function limitChartResults(chart: Chart): Record<string, unknown>[] {
  const kind = chart.kind.trim().toLowerCase();
  if (kind !== 'bar' && kind !== 'pie') return chart.data;
  const first = chart.data[0];
  if (!first) return chart.data;
  const horizontal = kind === 'bar' && String(first.orientation ?? '').toLowerCase() === 'h';
  const measureKey = kind === 'pie' ? 'values' : horizontal ? 'x' : 'y';
  const measures = Array.isArray(first[measureKey]) ? first[measureKey] : [];
  if (measures.length <= MAX_CHART_RESULTS) return chart.data;
  const indices = measures
    .map((value, index) => ({ index, value: Number(value) }))
    .sort((left, right) => {
      const leftValue = Number.isFinite(left.value) ? left.value : Number.NEGATIVE_INFINITY;
      const rightValue = Number.isFinite(right.value) ? right.value : Number.NEGATIVE_INFINITY;
      return rightValue - leftValue || left.index - right.index;
    })
    .slice(0, MAX_CHART_RESULTS)
    .map((entry) => entry.index);
  return chart.data.map((trace) => {
    const copy = { ...trace };
    for (const [key, value] of Object.entries(copy)) {
      if (Array.isArray(value) && value.length === measures.length) copy[key] = indices.map((index) => value[index]);
    }
    const marker =
      copy.marker && typeof copy.marker === 'object' && !Array.isArray(copy.marker)
        ? (copy.marker as Record<string, unknown>)
        : null;
    const colors = marker && Array.isArray(marker.color) ? marker.color : null;
    if (marker && colors?.length === measures.length) {
      copy.marker = { ...marker, color: indices.map((index) => colors[index]) };
    }
    return copy;
  });
}

function measurement(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Charts with no measurable points are rows, not empty Plotly panels. */
export function chartHasRenderableData(chart: Chart): boolean {
  return chart.data.some((trace) => {
    const type = (typeof trace.type === 'string' ? trace.type : chart.kind).toLowerCase();
    const key =
      type === 'pie'
        ? 'values'
        : type === 'histogram'
          ? 'x'
          : type === 'bar' && typeof trace.orientation === 'string' && trace.orientation.toLowerCase() === 'h'
            ? 'x'
            : 'y';
    const values = trace[key];
    if (!Array.isArray(values)) return false;
    const measured = values.map(measurement).filter((value): value is number => value !== null);
    return measured.some((value) => value !== 0);
  });
}

export function renderableCharts(charts: Chart[] | undefined): Chart[] {
  return charts?.filter(chartHasRenderableData) ?? [];
}
