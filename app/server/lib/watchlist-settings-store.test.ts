import { describe, expect, it, vi } from 'vitest';
import {
  readResolvedWatchlistSettings,
  deleteUserWatchlistSettings,
  readWatchlistSettings,
  writeUserWatchlistSettings,
  writeWatchlistSettings,
} from './watchlist-settings-store';

describe('watchlist settings store', () => {
  it('resolves a user title override ahead of Rida’s effective titles', async () => {
    const sections = {
      dataInScope: true,
      savedQueries: true,
      watchlist: true,
      answerConfidence: true,
    };
    const query = vi.fn((_sql: string, values: unknown[] = []) =>
      Promise.resolve({
        rows:
          values[0] === 'effective'
            ? [{ settings: { titles: ['Borderlands 4'], sections }, revision: 4 }]
            : values[0] === 'user:reader@example.com'
              ? [{ settings: { titles: ['NBA 2K26'], sections }, revision: 2 }]
              : [],
      })
    );
    await expect(readResolvedWatchlistSettings({ lakebase: { query } }, 'Reader@Example.com')).resolves.toMatchObject({
      settings: { titles: ['NBA 2K26'] },
      revision: 2,
      source: 'override',
      canReset: true,
    });
  });

  it('deletes only the caller override and reveals Rida’s effective titles', async () => {
    const effective = {
      titles: ['Borderlands 4'],
      sections: { dataInScope: true, savedQueries: true, watchlist: true, answerConfidence: true },
    };
    const query = vi.fn((sql: string, values: unknown[] = []) => {
      if (sql.includes('DELETE FROM')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: values[0] === 'effective' ? [{ settings: effective, revision: 4 }] : [] });
    });
    await expect(deleteUserWatchlistSettings({ lakebase: { query } }, 'reader@example.com')).resolves.toMatchObject({
      settings: effective,
      revision: 0,
      source: 'default',
      canReset: false,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM'), ['user:reader@example.com']);
  });

  it('gives a user without an override Rida’s titles with a new-user revision', async () => {
    const effective = {
      titles: ['Borderlands 4'],
      sections: { dataInScope: true, savedQueries: true, watchlist: true, answerConfidence: true },
    };
    const query = vi.fn((_sql: string, values: unknown[] = []) =>
      Promise.resolve({ rows: values[0] === 'effective' ? [{ settings: effective, revision: 4 }] : [] })
    );

    await expect(readResolvedWatchlistSettings({ lakebase: { query } }, 'new-reader@example.com')).resolves.toEqual({
      settings: effective,
      revision: 0,
      source: 'default',
      canReset: false,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT settings, revision'), [
      'user:new-reader@example.com',
    ]);
  });

  it('creates the first caller-specific override without changing Rida’s defaults', async () => {
    const sections = { dataInScope: true, savedQueries: true, watchlist: true, answerConfidence: true };
    const effective = { titles: ['Borderlands 4'], sections };
    const query = vi.fn((sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT settings, revision')) {
        return Promise.resolve({
          rows: values[0] === 'effective' ? [{ settings: effective, revision: 4 }] : [],
        });
      }
      if (sql.includes('INSERT INTO')) return Promise.resolve({ rows: [{ revision: 1 }] });
      return Promise.resolve({ rows: [] });
    });

    await expect(
      writeUserWatchlistSettings({ lakebase: { query } }, 'new-reader@example.com', { titles: ['NBA 2K26'] }, 0)
    ).resolves.toMatchObject({
      settings: { titles: ['NBA 2K26'] },
      revision: 1,
      source: 'override',
      canReset: true,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO'),
      expect.arrayContaining(['user:new-reader@example.com'])
    );
    expect(query.mock.calls.some(([, values = []]) => values[0] === 'effective' && values.length > 1)).toBe(false);
  });

  it('returns Rida’s actual default revision so she can update the fallback', async () => {
    const effective = {
      titles: ['Borderlands 4'],
      sections: { dataInScope: true, savedQueries: true, watchlist: true, answerConfidence: true },
    };
    const query = vi.fn((_sql: string, values: unknown[] = []) =>
      Promise.resolve({ rows: values[0] === 'effective' ? [{ settings: effective, revision: 4 }] : [] })
    );

    await expect(
      readResolvedWatchlistSettings({ lakebase: { query } }, 'RIDA.QURESHI@TAKE2GAMES.COM')
    ).resolves.toEqual({ settings: effective, revision: 4, source: 'default', canReset: false });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('pre-populates the customer watchlist until an admin saves an override', async () => {
    const client = { lakebase: { query: vi.fn().mockResolvedValue({ rows: [] }) } };
    await expect(readWatchlistSettings(client)).resolves.toEqual({
      settings: {
        titles: ['Grand Theft Auto V', 'Red Dead Redemption 2', 'NBA 2K26', 'Borderlands 4'],
        sections: {
          dataInScope: true,
          savedQueries: true,
          watchlist: true,
          answerConfidence: true,
        },
      },
      revision: 0,
    });
  });

  it('persists normalized title names with optimistic revision protection', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ settings: { titles: ['NBA 2K26'] }, revision: 1 }] });
    const client = { lakebase: { query } };
    await expect(
      writeWatchlistSettings(client, { titles: [' NBA 2K26 ', 'NBA 2K26'] }, 0, 'admin@example.com')
    ).resolves.toEqual({
      settings: {
        titles: ['NBA 2K26'],
        sections: {
          dataInScope: true,
          savedQueries: true,
          watchlist: true,
          answerConfidence: true,
        },
      },
      revision: 1,
    });
    expect(query.mock.calls[1][1]).toEqual([
      'effective',
      '{"titles":["NBA 2K26"],"sections":{"dataInScope":true,"savedQueries":true,"watchlist":true,"answerConfidence":true}}',
      'admin@example.com',
    ]);
  });
});
