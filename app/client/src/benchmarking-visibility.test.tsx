import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { BenchmarkingVisibility } from './BenchmarkingVisibility';
import { ExperimentalSettingsSchema } from '../../shared/experimental-settings';
import { NO_EXPERIMENTS, showsBenchmarkLab, type ExperimentalFeatures } from './experimental-features';
import { BENCHMARK_LAB_ENABLED } from './nav-reveal';

function renderBenchmarking(features: ExperimentalFeatures): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/benchmarks']}>
      <Routes>
        <Route element={<Outlet context={{ features, setFeature: () => {} }} />}>
          <Route
            path="/benchmarks"
            element={
              <BenchmarkingVisibility>
                <div>Scorers · Judge</div>
              </BenchmarkingVisibility>
            }
          />
          <Route path="/" element={<div>Ask</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('Benchmarking is entirely absent from ADAPT', () => {
  it('is off in the set every unasked browser starts from', () => {
    expect(NO_EXPERIMENTS.benchmarkLab).toBe(false);
    expect(showsBenchmarkLab(NO_EXPERIMENTS)).toBe(false);
    expect(BENCHMARK_LAB_ENABLED).toBe(false);
  });

  it('is off when the durable document has no Benchmarking field', () => {
    expect(ExperimentalSettingsSchema.parse({}).benchmarkLab).toBe(false);
  });

  it('redirects a pasted route with the default operator value', () => {
    expect(renderBenchmarking({ ...NO_EXPERIMENTS })).not.toContain('Scorers · Judge');
  });

  it('redirects a pasted route even when a stale operator value is on', () => {
    expect(renderBenchmarking({ ...NO_EXPERIMENTS, benchmarkLab: true })).not.toContain('Scorers · Judge');
  });
});
