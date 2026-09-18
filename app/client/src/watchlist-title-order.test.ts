import { describe, expect, it } from 'vitest';

import { orderedWatchlistTitles, partitionWatchlistTitles } from './watchlist-title-order';

const TITLES = ['Borderlands 4', 'Grand Theft Auto V', 'NBA 2K26', 'Red Dead Redemption 2'];

describe('watchlist title ordering', () => {
  it('puts active titles first when no search is applied', () => {
    expect(orderedWatchlistTitles(TITLES, ['NBA 2K26'], '')).toEqual([
      'NBA 2K26',
      'Borderlands 4',
      'Grand Theft Auto V',
      'Red Dead Redemption 2',
    ]);
  });

  it('keeps filtered rows static while titles are toggled', () => {
    const before = orderedWatchlistTitles(TITLES, [], '2');
    const afterAdding = orderedWatchlistTitles(TITLES, ['Red Dead Redemption 2'], '2');
    const afterRemoving = orderedWatchlistTitles(TITLES, [], '2');

    expect(before).toEqual(['NBA 2K26', 'Red Dead Redemption 2']);
    expect(afterAdding).toEqual(before);
    expect(afterRemoving).toEqual(before);
  });

  it('separates active titles from searchable inactive titles', () => {
    expect(partitionWatchlistTitles(TITLES, ['NBA 2K26', 'Borderlands 4'], 'red')).toEqual({
      active: ['Borderlands 4', 'NBA 2K26'],
      inactive: ['Red Dead Redemption 2'],
    });
  });
});
