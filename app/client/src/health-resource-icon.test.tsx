import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HealthResourceIcon } from './HealthResourceIcon';
import {
  KNOWN_HEALTH_RESOURCE_KINDS,
  healthResourceIconSpec,
  type HealthResourceIconSpec,
} from './health-resource-icon';

const EXPECTED: Readonly<Record<(typeof KNOWN_HEALTH_RESOURCE_KINDS)[number], HealthResourceIconSpec>> = {
  'sql-warehouse': { type: 'brand', product: 'databricks-sql' },
  'genie-space': { type: 'brand', product: 'genie' },
  catalog: { type: 'brand', product: 'unity-catalog' },
  schema: { type: 'brand', product: 'unity-catalog' },
  table: { type: 'brand', product: 'unity-catalog' },
  'serving-endpoint': { type: 'brand', product: 'mosaic-ai' },
  app: { type: 'brand', product: 'apps' },
  lakebase: { type: 'brand', product: 'lakebase' },
  observability: { type: 'brand', product: 'mlflow' },
  manifest: { type: 'table' },
};

describe('Ops Health resource icons', () => {
  it.each(KNOWN_HEALTH_RESOURCE_KINDS)('maps the known %s kind to a settled icon', (kind) => {
    expect(healthResourceIconSpec(kind)).toEqual(EXPECTED[kind]);
    expect(renderToStaticMarkup(<HealthResourceIcon kind={kind} />)).toContain('ops-dependency-mark');
  });

  it('keeps decoder and configuration aliases on their canonical icons', () => {
    for (const kind of ['mlflow', 'experiment', 'experiment-id', 'mlflow_experiment']) {
      expect(healthResourceIconSpec(kind), kind).toEqual({ type: 'brand', product: 'mlflow' });
    }
    expect(healthResourceIconSpec('sql_warehouse')).toEqual({ type: 'brand', product: 'databricks-sql' });
    expect(healthResourceIconSpec('declared_tables')).toEqual({ type: 'table' });
  });

  it('uses visible generic icons for table aggregates and unknown resources', () => {
    const tables = renderToStaticMarkup(<HealthResourceIcon kind="manifest" />);
    expect(tables).toContain('lucide-table-properties');
    expect(tables).toContain('ops-dependency-mark-generic');

    expect(healthResourceIconSpec('future-resource')).toEqual({ type: 'resource' });
    const unknown = renderToStaticMarkup(<HealthResourceIcon kind="future-resource" />);
    expect(unknown).toContain('lucide-box');
    expect(unknown).toContain('aria-hidden="true"');
  });
});
