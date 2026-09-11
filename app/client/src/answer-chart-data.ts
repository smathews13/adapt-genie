export interface Chart {
  id: string;
  title: string;
  kind: string;
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
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
    return type === 'bar' || type === 'pie' ? measured.some((value) => value !== 0) : measured.length > 0;
  });
}

export function renderableCharts(charts: Chart[] | undefined): Chart[] {
  return charts?.filter(chartHasRenderableData) ?? [];
}
