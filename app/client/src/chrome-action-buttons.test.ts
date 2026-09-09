import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Ask chrome stays consumer-facing', () => {
  it('does not restore the completed-run explorer action', () => {
    const page = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');

    expect(page).toContain('className="trace-inspector insight-rail"');
    expect(page).not.toContain('className="trace-explore');
    expect(page).not.toContain('Open in Run Explorer');
    expect(page).not.toContain('Open the MLflow trace');
  });
});
