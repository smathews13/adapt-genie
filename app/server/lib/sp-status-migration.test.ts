import { describe, expect, it } from 'vitest';
import { APP_SCHEMA } from '../../shared/app-schema';
import { LATER_MIGRATIONS } from './migrations';

describe('service-principal status migration', () => {
  it('keeps idempotent v36 stable-link evidence in the current migration order', () => {
    const migration = LATER_MIGRATIONS.find((entry) => entry.version === 36);
    expect(migration?.name).toBe('service principal connection evidence');
    expect(LATER_MIGRATIONS.slice(-9).map((entry) => entry.version)).toEqual([38, 39, 40, 41, 42, 43, 44, 45, 46]);
    const sql = migration?.statements.join('\n') ?? '';
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS definition_id TEXT');
    expect(sql).toContain('sp_personas_definition_idx');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1');
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${APP_SCHEMA}.sp_persona_status`);
    expect(sql).not.toMatch(/client_secret|access_token|token|secret_value/i);
  });

  it('writes the current ADAPT default starters onto every deployment', () => {
    const migration = LATER_MIGRATIONS.find((entry) => entry.version === 46);
    expect(migration?.name).toBe('adapt default starter questions');
    const sql = migration?.statements.join('\n') ?? '';
    expect(sql).toContain('Which brand had the most sales yesterday?');
    expect(sql).toContain('Civilization');
    expect(sql).toContain('ON CONFLICT (id) DO UPDATE SET');
  });
});
