import { describe, expect, it } from 'vitest';
import { readAppGroupsSettings, writeAppGroupsSettings } from './app-groups-store';
import { SettingsRevisionConflict } from './versioned-settings-store';

/** A one-row in-memory stand-in for the Lakebase settings table. */
class MemorySettingsDb {
  row: { settings: unknown; revision: number } | null = null;

  readonly lakebase = {
    query: (sql: string, values: unknown[] = []) => {
      const trimmed = sql.trim();
      if (/^SELECT settings, revision/m.test(trimmed)) {
        return Promise.resolve({ rows: this.row ? [{ ...this.row }] : [] });
      }
      if (/^INSERT INTO/m.test(trimmed)) {
        if (this.row) return Promise.resolve({ rows: [] });
        this.row = { settings: JSON.parse(String(values[1])), revision: 1 };
        return Promise.resolve({ rows: [{ ...this.row }] });
      }
      if (/^UPDATE/m.test(trimmed)) {
        const expected = Number(values[3]);
        if (!this.row || this.row.revision !== expected) return Promise.resolve({ rows: [] });
        this.row = { settings: JSON.parse(String(values[1])), revision: expected + 1 };
        return Promise.resolve({ rows: [{ ...this.row }] });
      }
      return Promise.reject(new Error(`Unexpected SQL: ${sql}`));
    },
  };
}

describe('app groups persistence', () => {
  it('reads the empty default before anything is written', async () => {
    const db = new MemorySettingsDb();
    await expect(readAppGroupsSettings(db as never)).resolves.toEqual({ settings: { groups: [] }, revision: 0 });
  });

  it('writes, canonicalizes, and reads the same document back', async () => {
    const db = new MemorySettingsDb();
    const written = await writeAppGroupsSettings(
      db as never,
      { groups: [{ id: 'g1', name: 'Trading', members: ['A@x.com', 'a@x.com'] }] },
      0,
      'admin@x.com'
    );
    expect(written.revision).toBe(1);
    // De-duplicated and lower-cased on the way in.
    expect(written.settings.groups[0].members).toEqual(['a@x.com']);
    await expect(readAppGroupsSettings(db as never)).resolves.toMatchObject({
      settings: { groups: [{ id: 'g1', name: 'Trading', members: ['a@x.com'] }] },
      revision: 1,
    });
  });

  it('refuses a stale revision so a concurrent editor is not overwritten', async () => {
    const db = new MemorySettingsDb();
    await writeAppGroupsSettings(db as never, { groups: [] }, 0, 'admin@x.com');
    await expect(
      writeAppGroupsSettings(db as never, { groups: [{ id: 'g', name: 'Late', members: [] }] }, 0, 'other@x.com')
    ).rejects.toBeInstanceOf(SettingsRevisionConflict);
  });
});
