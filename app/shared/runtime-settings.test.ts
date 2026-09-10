import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENTITY_STYLES,
  DEFAULT_RUNTIME_SETTINGS,
  FONT_FAMILY_STACKS,
  LEGACY_NIGHT_ENTITY_STYLES,
  PAPER_ENTITY_STYLES,
  RuntimeSettingsSchema,
  THEME_FONT_COLORS,
  fontColorsForScheme,
  parseRuntimeSettings,
  runtimeAppearanceCssVariables,
  runtimeEntityCssVariables,
  upgradePaperEntityStyles,
} from './runtime-settings';

const PAPER_FILLS = ['#ddeaf4', '#e8e8e8', '#f4f4f4', '#f7f7f7'] as const;

describe('runtime settings contract', () => {
  it('keeps the current agent behavior as its defaults', () => {
    expect(RuntimeSettingsSchema.parse(DEFAULT_RUNTIME_SETTINGS)).toEqual(DEFAULT_RUNTIME_SETTINGS);
    expect(DEFAULT_RUNTIME_SETTINGS.loop).toEqual({
      maxSteps: 12,
      maxToolCalls: 12,
      maxRunSeconds: 180,
    });
    expect(DEFAULT_RUNTIME_SETTINGS.answer.maxFigures).toBe(6);
    expect(DEFAULT_RUNTIME_SETTINGS.answer.maxCharts).toBe(1);
  });

  it('ships night-sky entity chips, not paper fills', () => {
    expect(DEFAULT_RUNTIME_SETTINGS.entityStyles).toEqual(DEFAULT_ENTITY_STYLES);
    expect(DEFAULT_ENTITY_STYLES).toEqual({
      catalog: { foreground: '#7fdcd1', background: '#123733' },
      schema: { foreground: '#f2f6fa', background: '#183d39' },
      table: { foreground: '#d6b65c', background: '#332b1b' },
      column: { foreground: '#d9f4f0', background: '#15332f' },
      quote: { foreground: '#9ad6ce', background: '#182523' },
      tag: { foreground: '#f2f6fa', background: '#243f3c' },
    });

    const backgrounds = Object.values(DEFAULT_ENTITY_STYLES).map((style) => style.background.toLowerCase());
    const foregrounds = Object.values(DEFAULT_ENTITY_STYLES).map((style) => style.foreground.toLowerCase());
    for (const fill of PAPER_FILLS) {
      expect(backgrounds, `${fill} is a paper highlight`).not.toContain(fill);
    }
    expect(new Set(backgrounds).size, 'kinds share a highlight').toBe(backgrounds.length);
    expect(foregrounds.every((hex) => !['#16324f', '#3a3838', '#46596b'].includes(hex))).toBe(true);

    expect(runtimeEntityCssVariables(DEFAULT_RUNTIME_SETTINGS)).toMatchObject({
      '--entity-catalog-fg': '#7fdcd1',
      '--entity-catalog-bg': '#123733',
      '--entity-schema-bg': '#183d39',
      '--entity-table-bg': '#332b1b',
      '--entity-column-bg': '#15332f',
      '--entity-quote-bg': '#182523',
      '--entity-tag-bg': '#243f3c',
    });
  });

  it('upgrades inherited paper and blue defaults while leaving chosen colors alone', () => {
    expect(upgradePaperEntityStyles(PAPER_ENTITY_STYLES)).toEqual(DEFAULT_ENTITY_STYLES);
    expect(upgradePaperEntityStyles(LEGACY_NIGHT_ENTITY_STYLES)).toEqual(DEFAULT_ENTITY_STYLES);
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

  it('defaults missing colorScheme to dark so older rows stay parseable', () => {
    const { colorScheme: _ignored, ...withoutTheme } = DEFAULT_RUNTIME_SETTINGS;
    expect(RuntimeSettingsSchema.parse(withoutTheme).colorScheme).toBe('dark');
    expect(DEFAULT_RUNTIME_SETTINGS.colorScheme).toBe('dark');
  });

  it('fills type settings from the row theme when an older store omitted them', () => {
    const { fontBodyColor: _b, fontMutedColor: _m, fontFamily: _f, fontSize: _s, ...legacy } = DEFAULT_RUNTIME_SETTINGS;
    expect(RuntimeSettingsSchema.parse(legacy)).toMatchObject({
      fontBodyColor: THEME_FONT_COLORS.dark.body,
      fontMutedColor: THEME_FONT_COLORS.dark.muted,
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
      loop: { ...DEFAULT_RUNTIME_SETTINGS.loop, maxSteps: 17 },
      fontFamily: 'system' as const,
    };

    expect(RuntimeSettingsSchema.parse(legacy)).toMatchObject({
      loop: { maxSteps: 17 },
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
    expect(fontColorsForScheme(DEFAULT_RUNTIME_SETTINGS, 'light')).toEqual({
      fontBodyColor: THEME_FONT_COLORS.light.body,
      fontMutedColor: THEME_FONT_COLORS.light.muted,
    });
    expect(
      fontColorsForScheme({ ...DEFAULT_RUNTIME_SETTINGS, fontBodyColor: '#ffeecc', fontMutedColor: '#8899aa' }, 'light')
    ).toEqual({ fontBodyColor: '#ffeecc', fontMutedColor: '#8899aa' });
  });

  it('refuses unsafe or ineffective values', () => {
    expect(() =>
      RuntimeSettingsSchema.parse({
        ...DEFAULT_RUNTIME_SETTINGS,
        loop: { ...DEFAULT_RUNTIME_SETTINGS.loop, maxSteps: 100 },
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
