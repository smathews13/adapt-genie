import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const insightsSource = readFileSync(new URL('./insights-routes.ts', import.meta.url), 'utf8');
const v1Source = readFileSync(new URL('./v1-routes.ts', import.meta.url), 'utf8');

describe('browser and v1 governed execution equivalence', () => {
  it('wires the existing Ask executor into one GovernedRunService', () => {
    expect(insightsSource).toContain('const governedRuns = new GovernedRunService(appkit, (req, res, overrides) =>');
    expect(insightsSource).toContain('return execute(req, res, overrides)');
    expect(insightsSource).toMatch(
      /app\.post\('\/api\/insights\/ask', async \(req, res\) => governedRuns\.executeBrowser\(req, res\)\)/
    );
  });

  it('admits v1 only through GovernedRunService and has no serving executor', () => {
    expect(v1Source).toContain('options.service.submit(');
    expect(v1Source).not.toMatch(/invokeServing|servingTransport|\/invocations|apiClient\.request/);
  });
});
