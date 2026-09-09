/**
 * The tables this repository's data contract names.
 *
 * ONE LIST WITH `agent/preflight.py`. `DATA_GENIE_TABLES` becomes the
 * DatabricksTable resources on the logged model, so changing it changes what
 * the serving principal can read. ADAPT currently carries no static table
 * contract: its one Genie space supplies the live manifest at model-log time.
 *
 * Unqualified names are completed with the release catalog and schema. A name
 * that already has two dots is left alone, which is the same rule
 * `declared_tables` applies in Python.
 *
 * `shared/data-contract.test.ts` reads the Python file and fails if these
 * tuples drift.
 */
export const DATA_GENIE_TABLES = [] as const;

export const DATA_CONTRACT_TABLES = [...DATA_GENIE_TABLES] as const;

/**
 * Fully-qualified data-contract tables, or none when the namespace is missing.
 *
 * Empty rather than guessed: a probe against `gold_player_180d_summary` with no
 * catalog is not a Unity Catalog name, and inventing one would ask about an
 * object this release never declared.
 */
export function qualifyDataContractTables(
  catalog: string,
  schema: string,
  tables: readonly string[] = DATA_CONTRACT_TABLES
): string[] {
  const nsCatalog = catalog.trim();
  const nsSchema = schema.trim();
  if (!nsCatalog || !nsSchema) return [];
  return [
    ...new Set(tables.map((table) => (table.split('.').length === 3 ? table : `${nsCatalog}.${nsSchema}.${table}`))),
  ].sort();
}
