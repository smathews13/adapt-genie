import { describe, expect, it } from 'vitest';

import { ADAPT_HIDDEN_CONNECTION_IDS, isAdaptHiddenConnection } from './adapt-surface';
import { canMutateConnections } from './user-roster-contract';

describe('ADAPT Connections product bounds', () => {
  it('keeps non-ADAPT auxiliary connections off this product surface', () => {
    expect(ADAPT_HIDDEN_CONNECTION_IDS).toEqual(['judge-endpoint', 'genie-dictionary']);
    expect(isAdaptHiddenConnection('genie-data')).toBe(false);
  });

  it('lets only authorized administrator roles mutate declared connections', () => {
    expect(['admin', 'owner', 'super_admin'].filter(canMutateConnections)).toEqual(['admin', 'owner', 'super_admin']);
    expect(['consumer', '', 'unknown'].some(canMutateConnections)).toBe(false);
  });
});
