import type { BrandProduct } from './brand-icons';

export type HealthResourceIconSpec =
  | { type: 'brand'; product: BrandProduct }
  | { type: 'table' }
  | { type: 'resource' };

const brand = (product: BrandProduct): HealthResourceIconSpec => ({ type: 'brand', product });
const table: HealthResourceIconSpec = { type: 'table' };
const resource: HealthResourceIconSpec = { type: 'resource' };

/**
 * Icons for ADAPT's health resources. Aliases decode the wire/config names while
 * unfamiliar kinds remain visible as neutral resources.
 */
const HEALTH_RESOURCE_ICONS: Readonly<Record<string, HealthResourceIconSpec>> = {
  'sql-warehouse': brand('databricks-sql'),
  'genie-space': brand('genie'),
  catalog: brand('unity-catalog'),
  schema: brand('unity-catalog'),
  table: brand('unity-catalog'),
  'serving-endpoint': brand('mosaic-ai'),
  app: brand('apps'),
  lakebase: brand('lakebase'),
  observability: brand('mlflow'),
  mlflow: brand('mlflow'),
  experiment: brand('mlflow'),
  'experiment-id': brand('mlflow'),
  'mlflow-experiment': brand('mlflow'),
  manifest: table,
  'declared-manifest': table,
  'declared-tables': table,
};

export const KNOWN_HEALTH_RESOURCE_KINDS = [
  'sql-warehouse',
  'genie-space',
  'catalog',
  'schema',
  'table',
  'serving-endpoint',
  'app',
  'lakebase',
  'observability',
  'manifest',
] as const;

function normalizedKind(kind: string): string {
  return kind.trim().toLowerCase().replaceAll('_', '-');
}

export function healthResourceIconSpec(kind: string): HealthResourceIconSpec {
  return HEALTH_RESOURCE_ICONS[normalizedKind(kind)] ?? resource;
}
