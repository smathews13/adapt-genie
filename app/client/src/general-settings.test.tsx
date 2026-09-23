import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ResetPreferencesButton } from './GeneralSettingsPanel';
import { SettingsPage } from './SettingsPage';
import { BASE_SETTINGS_SECTIONS } from './settings-sections';

const RESET_SOURCE = readFileSync(new URL('./GeneralSettingsPanel.tsx', import.meta.url), 'utf8');

describe('Appearance settings reset', () => {
  it('offers one neutral reset without a General destination', () => {
    const markup = renderToStaticMarkup(<ResetPreferencesButton />);
    expect(BASE_SETTINGS_SECTIONS.map((section) => section.label)).not.toContain('General');
    expect(markup).toContain('Reset to default settings');
    expect(markup).not.toContain('Rida');
  });

  it('places reset in the Appearance heading for consumers', () => {
    const markup = renderToStaticMarkup(
      <SettingsPage initialSection="appearance" role={{ state: 'consumer', addedAdminsReadable: true }} />
    );

    const heading = markup.slice(
      markup.indexOf('settings-pane-heading--with-action'),
      markup.indexOf('</div>', markup.indexOf('settings-pane-heading--with-action'))
    );
    expect(heading).toContain('<h3>Appearance</h3>');
    expect(heading).toContain('Reset to default settings');
  });

  it('replaces the first-paint cache before reloading after reset', () => {
    expect(RESET_SOURCE).toContain('parsePersistedRuntimeSettings(body.runtime?.settings)');
    expect(RESET_SOURCE).toContain('cacheRuntimeAppearance(resetSettings)');
    expect(RESET_SOURCE).toContain('previewRuntimeAppearance(resetSettings)');
    expect(RESET_SOURCE.indexOf('cacheRuntimeAppearance(resetSettings)')).toBeLessThan(
      RESET_SOURCE.indexOf('window.location.reload()')
    );
  });
});
