import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RUN_EXPLORER = readFileSync(new URL('./RunExplorer.tsx', import.meta.url), 'utf8');
const HOME = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');

describe('the retired Agent map', () => {
  it('is not offered by Run Explorer', () => {
    expect(RUN_EXPLORER).not.toContain('value="map"');
    expect(RUN_EXPLORER).not.toMatch(/AgentMapConstellation|<TraceDag/);
    expect(RUN_EXPLORER).toContain('<TabsTrigger value="timeline">Timeline</TabsTrigger>');
    expect(RUN_EXPLORER).toContain('<TabsTrigger value="details">Details</TabsTrigger>');
  });

  it('is not rendered in Ask', () => {
    expect(HOME).not.toMatch(/AgentPathConstellation|AgentMapConstellation|<TraceDag/);
    expect(HOME).toContain('<AdaptLoadingAnimation variant="ask"');
  });
});
