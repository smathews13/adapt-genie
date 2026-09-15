import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GeneralSettingsPanel } from './GeneralSettingsPanel';
import { BASE_SETTINGS_SECTIONS } from './settings-sections';

describe('General settings reset', () => {
  it('offers one neutral reset for all user preferences', () => {
    const markup = renderToStaticMarkup(<GeneralSettingsPanel />);
    expect(BASE_SETTINGS_SECTIONS[0]).toEqual({ id: 'general', label: 'General' });
    expect(markup).toContain('Reset to default settings');
    expect(markup).toContain('Reset Appearance and Insights preferences together.');
    expect(markup).not.toContain('Rida');
  });
});
