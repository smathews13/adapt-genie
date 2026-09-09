import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const productionSource = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('constellation visuals are retired from ADAPT', () => {
  it('does not load a constellation from the application shell or Ask', () => {
    for (const name of ['App.tsx', 'Layout.tsx', 'HomePage.tsx', 'StartupBoundary.tsx']) {
      expect(productionSource(name), name).not.toMatch(/AgentConstellation|ConstellationField|WorkingConstellation/);
    }
  });

  it('uses the ADAPT loader for active Ask work', () => {
    const home = productionSource('HomePage.tsx');
    expect(home).toContain(
      "import { AdaptBusyButtonContent, AdaptLoader, AdaptLoadingAnimation } from './AdaptLoadingAnimation'"
    );
    expect(home).toContain('<AdaptLoadingAnimation variant="ask"');
  });

  it('keeps the app background static', () => {
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const tokens = productionSource('styles/astrolabe-tokens.css');
    expect(index).toContain('data-background-graphics="off"');
    expect(tokens).toContain('--ast-sky-spackle: none');
  });
});
