import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_RUNTIME_SETTINGS } from '../../shared/runtime-settings';
import { RuntimeSettingsPanel } from './RuntimeSettingsPanel';
import { writeRuntimeAppearanceAttributes } from './runtime-entity-styles';

const PANEL = readFileSync(new URL('./RuntimeSettingsPanel.tsx', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('ADAPT appearance preferences', () => {
  it('offers theme, motion, density, and answer table style without a background-graphics toggle', () => {
    const markup = renderToStaticMarkup(<RuntimeSettingsPanel section="appearance" />);
    expect(markup).toContain('aria-label="Dark mode"');
    expect(markup).toContain('aria-label="Animations"');
    expect(markup).toContain('Density');
    expect(markup).toContain('Tables');
    expect(markup).toMatch(/aria-checked="true"[^>]*>Polished/);
    expect(markup).toContain('>Plain</button>');
    expect(markup).not.toContain('aria-label="Background graphics"');
    expect(PANEL).not.toContain('Show decorative shell stars and constellation lines.');
  });

  it('always writes the static-background contract', () => {
    const setAttribute = vi.fn();
    writeRuntimeAppearanceAttributes({ ...DEFAULT_RUNTIME_SETTINGS, backgroundGraphics: true }, { setAttribute });
    expect(setAttribute).toHaveBeenCalledWith('data-background-graphics', 'off');
  });

  it('starts with graphics off and ignores cached attempts to enable them', () => {
    expect(INDEX).toContain('data-background-graphics="off"');
    expect(INDEX).toContain('data-table-style="polished"');
    expect(INDEX).toContain("root.dataset.backgroundGraphics = 'off'");
    expect(INDEX).toContain("root.dataset.tableStyle = saved.tableStyle === 'plain' ? 'plain' : 'polished'");
    expect(INDEX).not.toContain('saved.backgroundGraphics');
  });

  it('preserves animation, density, and table-style preferences', () => {
    const setAttribute = vi.fn();
    writeRuntimeAppearanceAttributes(
      { ...DEFAULT_RUNTIME_SETTINGS, animations: false, density: 'compact', tableStyle: 'plain' },
      { setAttribute }
    );
    expect(setAttribute).toHaveBeenCalledWith('data-animations', 'off');
    expect(setAttribute).toHaveBeenCalledWith('data-density', 'compact');
    expect(setAttribute).toHaveBeenCalledWith('data-table-style', 'plain');
  });
});
