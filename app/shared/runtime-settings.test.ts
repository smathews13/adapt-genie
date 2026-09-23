import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENTITY_STYLES,
  DEFAULT_RUNTIME_SETTINGS,
  DARK_ENTITY_STYLES,
  FONT_FAMILY_STACKS,
  LEGACY_NIGHT_ENTITY_STYLES,
  PAPER_ENTITY_STYLES,
  RuntimeSettingsSchema,
  THEME_FONT_COLORS,
  entityStylesForScheme,
  fontColorsForScheme,
  parseRuntimeSettings,
  runtimeAppearanceCssVariables,
  runtimeEntityCssVariables,
  upgradePaperEntityStyles,
} from './runtime-settings';

describe('runtime settings contract', () => {
  it('keeps the current agent behavior as its defaults', () => {
    expect(RuntimeSettingsSchema.parse(DEFAULT_RUNTIME_SETTINGS)).toEqual(DEFAULT_RUNTIME_SETTINGS);
    expect(DEFAULT_RUNTIME_SETTINGS).not.toHaveProperty('loop');
    expect(DEFAULT_RUNTIME_SETTINGS.answer.maxFigures).toBe(6);
    expect(DEFAULT_RUNTIME_SETTINGS.answer.maxCharts).toBe(1);
  });

  it('ships canonical paper entity chips', () => {
    expect(DEFAULT_RUNTIME_SETTINGS.entityStyles).toEqual(DEFAULT_ENTITY_STYLES);
    expect(DEFAULT_ENTITY_STYLES).toEqual({
      catalog: { foreground: '#ffffff', background: '#1a62a8' },
      schema: { foreground: '#1a5b8f', background: '#e8f1fa' },
      table: { foreground: '#7a5a11', background: '#fbf5e6' },
      column: { foreground: '#4c5c68', background: '#f2f5f8' },
      quote: { foreground: '#4c5c68', background: '#f0f4f7' },
      tag: { foreground: '#ffffff', background: '#0e1720' },
    });

    expect(runtimeEntityCssVariables(DEFAULT_RUNTIME_SETTINGS)).toMatchObject({
      '--entity-catalog-fg': '#ffffff',
      '--entity-catalog-bg': '#1a62a8',
      '--entity-schema-bg': '#e8f1fa',
      '--entity-table-bg': '#fbf5e6',
      '--entity-column-bg': '#f2f5f8',
      '--entity-quote-bg': '#f0f4f7',
      '--entity-tag-bg': '#0e1720',
    });
  });

  it('upgrades inherited defaults for the active theme while leaving chosen colors alone', () => {
    expect(upgradePaperEntityStyles(PAPER_ENTITY_STYLES)).toEqual(DEFAULT_ENTITY_STYLES);
    expect(upgradePaperEntityStyles(LEGACY_NIGHT_ENTITY_STYLES)).toEqual(DEFAULT_ENTITY_STYLES);
    expect(upgradePaperEntityStyles(PAPER_ENTITY_STYLES, 'dark')).toEqual(DARK_ENTITY_STYLES);
    expect(
      upgradePaperEntityStyles({
        ...DEFAULT_ENTITY_STYLES,
        table: { foreground: '#f2f6fa', background: '#1d4843' },
      }).table
    ).toEqual(DEFAULT_ENTITY_STYLES.table);

    const customTable = { foreground: '#112233', background: '#445566' };
    expect(
      upgradePaperEntityStyles({
        ...PAPER_ENTITY_STYLES,
        table: customTable,
      })
    ).toEqual({
      ...DEFAULT_ENTITY_STYLES,
      table: customTable,
    });

    const storedPaper = {
      ...DEFAULT_RUNTIME_SETTINGS,
      entityStyles: PAPER_ENTITY_STYLES,
    };
    expect(parseRuntimeSettings(storedPaper).entityStyles).toEqual(DEFAULT_ENTITY_STYLES);
    expect(
      parseRuntimeSettings({
        ...storedPaper,
        entityStyles: { ...PAPER_ENTITY_STYLES, table: customTable },
      }).entityStyles.table
    ).toEqual(customTable);
  });

  it('defaults a missing legacy colorScheme to light', () => {
    const { colorScheme: _ignored, ...withoutTheme } = DEFAULT_RUNTIME_SETTINGS;
    expect(RuntimeSettingsSchema.parse(withoutTheme).colorScheme).toBe('light');
    expect(DEFAULT_RUNTIME_SETTINGS.colorScheme).toBe('light');
  });

  it('fills type settings from the row theme when an older store omitted them', () => {
    const { fontBodyColor: _b, fontMutedColor: _m, fontFamily: _f, fontSize: _s, ...legacy } = DEFAULT_RUNTIME_SETTINGS;
    expect(RuntimeSettingsSchema.parse(legacy)).toMatchObject({
      fontBodyColor: THEME_FONT_COLORS.light.body,
      fontMutedColor: THEME_FONT_COLORS.light.muted,
      fontFamily: 'dm-sans',
      fontSize: 'm',
    });
    expect(
      RuntimeSettingsSchema.parse({
        ...legacy,
        colorScheme: 'light',
      })
    ).toMatchObject({
      fontBodyColor: THEME_FONT_COLORS.light.body,
      fontMutedColor: THEME_FONT_COLORS.light.muted,
    });
  });

  it('normalizes legacy rows with safe interface defaults without changing their values', () => {
    const {
      backgroundGraphics: _backgroundGraphics,
      animations: _animations,
      density: _density,
      tableStyle: _tableStyle,
      ...legacy
    } = {
      ...DEFAULT_RUNTIME_SETTINGS,
      loop: { maxSteps: 17, maxToolCalls: 12, maxRunSeconds: 180 },
      fontFamily: 'system' as const,
    };

    const parsed = RuntimeSettingsSchema.parse(legacy);
    expect(parsed).not.toHaveProperty('loop');
    expect(parsed).toMatchObject({
      fontFamily: 'system',
      backgroundGraphics: true,
      animations: true,
      density: 'comfortable',
      tableStyle: 'polished',
    });
  });

  it('writes type onto the same CSS variables every surface already reads', () => {
    const typed = {
      ...DEFAULT_RUNTIME_SETTINGS,
      fontBodyColor: '#ffeecc',
      fontMutedColor: '#8899aa',
      fontFamily: 'system' as const,
      fontSize: 'l' as const,
    };
    expect(runtimeAppearanceCssVariables(typed)).toMatchObject({
      '--ast-text': '#ffeecc',
      '--foreground': '#ffeecc',
      '--ast-text-secondary': '#8899aa',
      '--muted-foreground': '#8899aa',
      '--font-sans': FONT_FAMILY_STACKS.system,
      '--text-base': '15px',
      '--ast-fs-13': '15px',
    });
  });

  it('follows the new theme when type colours were still the previous default', () => {
    expect(fontColorsForScheme(DEFAULT_RUNTIME_SETTINGS, 'dark')).toEqual({
      fontBodyColor: THEME_FONT_COLORS.dark.body,
      fontMutedColor: THEME_FONT_COLORS.dark.muted,
    });
    expect(
      fontColorsForScheme({ ...DEFAULT_RUNTIME_SETTINGS, fontBodyColor: '#ffeecc', fontMutedColor: '#8899aa' }, 'dark')
    ).toEqual({ fontBodyColor: '#ffeecc', fontMutedColor: '#8899aa' });
  });

  it('switches inherited entity colors with the theme and preserves explicit overrides', () => {
    expect(entityStylesForScheme(DEFAULT_RUNTIME_SETTINGS, 'dark').entityStyles).toEqual(DARK_ENTITY_STYLES);
    const custom = {
      ...DEFAULT_RUNTIME_SETTINGS,
      entityStyles: {
        ...DEFAULT_RUNTIME_SETTINGS.entityStyles,
        table: { foreground: '#112233', background: '#445566' },
      },
    };
    expect(entityStylesForScheme(custom, 'dark').entityStyles.table).toEqual(custom.entityStyles.table);
  });

  it('refuses unsafe or ineffective values', () => {
    expect(() =>
      RuntimeSettingsSchema.parse({
        ...DEFAULT_RUNTIME_SETTINGS,
        loop: { maxSteps: 100, maxToolCalls: 12, maxRunSeconds: 180 },
      })
    ).toThrow();
    expect(() =>
      RuntimeSettingsSchema.parse({
        ...DEFAULT_RUNTIME_SETTINGS,
        behavior: { ...DEFAULT_RUNTIME_SETTINGS.behavior, surprise: true },
      })
    ).toThrow();
    expect(() => RuntimeSettingsSchema.parse({ ...DEFAULT_RUNTIME_SETTINGS, density: 'dense' })).toThrow();
    expect(() => RuntimeSettingsSchema.parse({ ...DEFAULT_RUNTIME_SETTINGS, tableStyle: 'ornate' })).toThrow();
  });
});
