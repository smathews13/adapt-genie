import { describe, expect, it, vi } from 'vitest';
import { readWatchlistSettings, writeWatchlistSettings } from './watchlist-settings-store';

describe('watchlist settings store', () => {
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
