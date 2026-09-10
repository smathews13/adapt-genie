import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  DEFAULT_RUNTIME_SETTINGS,
  DENSITY_IDS,
  FONT_FAMILY_STACKS,
  FONT_SIZE_IDS,
  FONT_SIZE_SCALE,
  TABLE_STYLE_IDS,
  fontColorsForScheme,
  isHexColor,
  type FontFamilyId,
  type FontSizeId,
  type DensityId,
  type RuntimeSettings,
  type TableStyleId,
} from '../../shared/runtime-settings';
import { applyColorScheme, type ColorScheme } from './color-scheme';
import { runtimeSettingsDocumentFromResponse } from './runtime-settings-api';
import { AppSelect } from './AppSelect';
import { adoptRuntimeEntityStyles, previewRuntimeAppearance } from './runtime-entity-styles';
import { RuntimeTimezoneField } from './RuntimeTimezoneField';
import {
  changedSettingKeys,
  changedSettingsPatch,
  saveRetryAfterLoad,
  type SettingsLoadResult,
  type SettingsSaveState,
} from './settings-save-state';
import { StateSwitch } from './StateSwitch';
import { ExperimentalBadge } from './ExperimentalBadge';
import { Input } from './ui';
import { AdaptLoader } from './AdaptLoadingAnimation';

const FONT_FAMILY_OPTIONS: { value: FontFamilyId; label: string }[] = [
  { value: 'dm-sans', label: 'DM Sans' },
  { value: 'system', label: 'System' },
  { value: 'dm-mono', label: 'DM Mono' },
];

const FONT_SIZE_LABELS: Record<FontSizeId, string> = {
  s: 'S',
  m: 'M',
  l: 'L',
};

const DENSITY_LABELS: Record<DensityId, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
};

const TABLE_STYLE_LABELS: Record<TableStyleId, string> = {
  polished: 'Polished',
  plain: 'Plain',
};

export const RUNTIME_SETTINGS_FORM_ID = 'settings-runtime-form';

export function RuntimeGuidanceField({
  value,
  update,
  placeholder,
}: {
  value: string;
  update: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="runtime-field runtime-answer-field runtime-answer-guidance">
      <span className="runtime-field-label">Guidance</span>
      <textarea
        className="runtime-guidance"
        aria-label="Guidance"
        placeholder={placeholder}
        value={value}
        onChange={(event) => update(event.target.value)}
      />
    </label>
  );
}

const ENTITY_SAMPLES = {
  catalog: 'analytics',
  schema: 'sales',
  table: 'orders',
  column: 'revenue',
  quote: '2026-07-22 – 2026-08-03',
  tag: 'Rockstar, 2K',
} as const;

/**
 * Paint a theme switch immediately and return the value the form must save.
 *
 * Keeping the paint and draft conversion in one path prevents the exact defect
 * this control had: the switch changed React state, but the only call that
 * changed `<html data-theme>` lived in Save, so the whole app contradicted the
 * control until a second, distant action was pressed.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared by focused appearance tests
export function previewColorScheme(dark: boolean): ColorScheme {
  const scheme = dark ? 'dark' : 'light';
  applyColorScheme(scheme);
  return scheme;
}

export function RuntimeSettingsPanel({
  section,
  onSaveState = () => {},
  onDirtyChange = () => {},
  initialSettings = DEFAULT_RUNTIME_SETTINGS,
}: {
  section: 'runtime' | 'appearance';
  /** Reports Save's progress to the modal footer, which is the part on screen. */
  onSaveState?: (state: SettingsSaveState) => void;
  onDirtyChange?: (count: number) => void;
  /** Seeds server-rendered and focused test states; live settings replace it after load. */
  initialSettings?: RuntimeSettings;
}) {
  const [settings, setSettings] = useState<RuntimeSettings>(initialSettings);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'failed'>('loading');
  const [failure, setFailure] = useState<{ operation: 'load' | 'save'; message: string } | null>(null);
  const savedSettings = useRef<RuntimeSettings | null>(null);
  const revision = useRef(0);

  const load = useCallback(async (): Promise<SettingsLoadResult> => {
    setState('loading');
    setFailure(null);
    try {
      const response = await fetch('/api/runtime-settings');
      const loaded = await runtimeSettingsDocumentFromResponse(response, 'loaded');
      savedSettings.current = loaded.settings;
      revision.current = loaded.revision;
      setSettings(loaded.settings);
      applyColorScheme(loaded.settings.colorScheme);
      setState('ready');
      return { ok: true };
    } catch (caught) {
      const message = (caught as Error).message;
      setState('failed');
      setFailure({ operation: 'load', message });
      return { ok: false, message };
    }
  }, []);

  useEffect(() => {
    // Mount fetch: the first paint has to come from the server.
    void load();
  }, [load]);

  useEffect(() => {
    const saved = savedSettings.current;
    onDirtyChange(saved ? changedSettingKeys(saved, settings).length : 0);
  }, [onDirtyChange, settings]);

  useEffect(() => {
    if (section === 'appearance' && state !== 'loading') previewRuntimeAppearance(settings);
  }, [section, settings, state]);

  useEffect(
    () => () => {
      if (section === 'appearance' && savedSettings.current) previewRuntimeAppearance(savedSettings.current);
    },
    [section]
  );

  const save = async () => {
    /*
     * A failed load turns Save into a retry, and now it SAYS so.
     *
     * It already behaved this way and reported nothing, so pressing Save on a
     * pane whose load had failed re-fetched in silence and looked like a dead
     * button -- one of the three things "Save does nothing" turned out to mean.
     */
    if (failure?.operation === 'load') {
      onSaveState({ kind: 'saving' });
      const result = await load();
      onSaveState(saveRetryAfterLoad(result));
      return;
    }
    setState('saving');
    setFailure(null);
    onSaveState({ kind: 'saving' });
    try {
      const changed = savedSettings.current ? changedSettingKeys(savedSettings.current, settings).length : 0;
      const before = savedSettings.current;
      if (!before) throw new Error('Runtime settings have not loaded from Lakebase.');
      const response = await fetch('/api/admin/runtime-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          revision: revision.current,
          patch: changedSettingsPatch(before, settings) ?? {},
        }),
      });
      const saved = await runtimeSettingsDocumentFromResponse(response, 'saved');
      savedSettings.current = saved.settings;
      revision.current = saved.revision;
      setSettings(saved.settings);
      adoptRuntimeEntityStyles(saved.settings);
      setState('saved');
      onDirtyChange(0);
      onSaveState({ kind: 'saved', count: changed });
    } catch (caught) {
      const prior = savedSettings.current;
      if (prior) {
        setSettings(prior);
        adoptRuntimeEntityStyles(prior);
        onDirtyChange(0);
      }
      setState('failed');
      setFailure({ operation: 'save', message: (caught as Error).message });
      onSaveState({ kind: 'failed', message: (caught as Error).message });
    }
  };

  return (
    <form
      id={RUNTIME_SETTINGS_FORM_ID}
      className="settings-pane"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {section === 'appearance' ? (
        <>
          <div className="settings-pane-heading">
            <h3>Appearance</h3>
          </div>
          <section className="runtime-section appearance-display-section">
            <div className="appearance-section-heading">
              <h4 className="runtime-section-label">Display</h4>
            </div>
            <div className="appearance-display-rows">
              <div className="appearance-display-row">
                <div>
                  <span className="appearance-choice-label">
                    <ExperimentalBadge /> Dark mode
                  </span>
                </div>
                <StateSwitch
                  checked={settings.colorScheme === 'dark'}
                  onCheckedChange={(on) => {
                    const colorScheme: ColorScheme = on ? 'dark' : 'light';
                    setSettings((current) => ({
                      ...current,
                      colorScheme,
                      ...fontColorsForScheme(current, colorScheme),
                    }));
                  }}
                  aria-label="Dark mode"
                />
              </div>
              <div className="appearance-display-row">
                <div>
                  <span className="appearance-choice-label">Animations</span>
                  <p className="runtime-control-note" id="appearance-animations-help">
                    Show ambient motion and nonessential transitions.
                  </p>
                </div>
                <StateSwitch
                  checked={settings.animations}
                  onCheckedChange={(animations) => setSettings((current) => ({ ...current, animations }))}
                  aria-label="Animations"
                  aria-describedby="appearance-animations-help"
                />
              </div>
              <div className="appearance-display-row">
                <div>
                  <span className="appearance-choice-label" id="appearance-density-label">
                    <ExperimentalBadge /> Density
                  </span>
                  <p className="runtime-control-note" id="appearance-density-help">
                    Adjust tables, rails, settings rows, and card spacing.
                  </p>
                </div>
                <div
                  className="appearance-density"
                  role="radiogroup"
                  aria-labelledby="appearance-density-label"
                  aria-describedby="appearance-density-help"
                >
                  {DENSITY_IDS.map((density) => (
                    <button
                      key={density}
                      type="button"
                      role="radio"
                      aria-checked={settings.density === density}
                      tabIndex={settings.density === density ? 0 : -1}
                      onClick={() => setSettings((current) => ({ ...current, density }))}
                      onKeyDown={(event) => {
                        const offset =
                          event.key === 'ArrowRight' || event.key === 'ArrowDown'
                            ? 1
                            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                              ? -1
                              : 0;
                        if (!offset) return;
                        event.preventDefault();
                        const next =
                          DENSITY_IDS[
                            (DENSITY_IDS.indexOf(density) + offset + DENSITY_IDS.length) % DENSITY_IDS.length
                          ];
                        setSettings((current) => ({ ...current, density: next }));
                      }}
                    >
                      {DENSITY_LABELS[density]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="appearance-display-row">
                <div>
                  <span className="appearance-choice-label" id="appearance-table-style-label">
                    Tables
                  </span>
                  <p className="runtime-control-note" id="appearance-table-style-help">
                    Choose the answer table treatment.
                  </p>
                </div>
                <div
                  className="appearance-density"
                  role="radiogroup"
                  aria-labelledby="appearance-table-style-label"
                  aria-describedby="appearance-table-style-help"
                >
                  {TABLE_STYLE_IDS.map((tableStyle) => (
                    <button
                      key={tableStyle}
                      type="button"
                      role="radio"
                      aria-checked={settings.tableStyle === tableStyle}
                      tabIndex={settings.tableStyle === tableStyle ? 0 : -1}
                      onClick={() => setSettings((current) => ({ ...current, tableStyle }))}
                      onKeyDown={(event) => {
                        const offset =
                          event.key === 'ArrowRight' || event.key === 'ArrowDown'
                            ? 1
                            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                              ? -1
                              : 0;
                        if (!offset) return;
                        event.preventDefault();
                        const next =
                          TABLE_STYLE_IDS[
                            (TABLE_STYLE_IDS.indexOf(tableStyle) + offset + TABLE_STYLE_IDS.length) %
                              TABLE_STYLE_IDS.length
                          ];
                        setSettings((current) => ({ ...current, tableStyle: next }));
                      }}
                    >
                      {TABLE_STYLE_LABELS[tableStyle]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
          <div className="appearance-text-panel" role="group" aria-label="Text">
            <div className="appearance-text-controls">
              <label className="runtime-field appearance-text-family">
                <span className="runtime-field-label">Font</span>
                <AppSelect
                  label="Font"
                  ariaLabel="Font"
                  value={settings.fontFamily}
                  onValueChange={(value) => setSettings((current) => ({ ...current, fontFamily: value }))}
                  options={FONT_FAMILY_OPTIONS}
                />
              </label>
              <div className="runtime-field">
                <span className="runtime-field-label" id="appearance-font-size-label">
                  Size
                </span>
                <div className="appearance-size" role="radiogroup" aria-labelledby="appearance-font-size-label">
                  {FONT_SIZE_IDS.map((size) => (
                    <button
                      key={size}
                      type="button"
                      role="radio"
                      aria-checked={settings.fontSize === size}
                      tabIndex={settings.fontSize === size ? 0 : -1}
                      aria-label={`Font size ${FONT_SIZE_LABELS[size]}`}
                      onClick={() => setSettings((current) => ({ ...current, fontSize: size }))}
                      onKeyDown={(event) => {
                        const offset =
                          event.key === 'ArrowRight' || event.key === 'ArrowDown'
                            ? 1
                            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                              ? -1
                              : 0;
                        if (!offset) return;
                        event.preventDefault();
                        const next =
                          FONT_SIZE_IDS[
                            (FONT_SIZE_IDS.indexOf(size) + offset + FONT_SIZE_IDS.length) % FONT_SIZE_IDS.length
                          ];
                        setSettings((current) => ({ ...current, fontSize: next }));
                      }}
                    >
                      {FONT_SIZE_LABELS[size]}
                    </button>
                  ))}
                </div>
              </div>
              {(
                [
                  ['fontBodyColor', 'Body text', 'Body text color'],
                  ['fontMutedColor', 'Secondary', 'Secondary text color'],
                ] as const
              ).map(([key, label, aria]) => {
                const hex = settings[key];
                return (
                  <div className="appearance-choice appearance-color-choice" key={key}>
                    <span className="appearance-choice-label">{label}</span>
                    <div className="appearance-color">
                      <span className="appearance-color-swatch">
                        <span aria-hidden="true" style={{ background: hex }} />
                        <input
                          type="color"
                          className="appearance-color-picker"
                          aria-label={`${aria} picker`}
                          value={isHexColor(hex) ? hex : '#000000'}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                        />
                      </span>
                      <Input
                        aria-label={aria}
                        pattern="#[0-9a-fA-F]{6}"
                        title="Use a six-digit hex color, including #."
                        value={hex}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              className="appearance-display-preview"
              data-color-scheme={settings.colorScheme}
              style={
                {
                  '--appearance-preview-body': settings.fontBodyColor,
                  '--appearance-preview-muted': settings.fontMutedColor,
                  '--appearance-preview-font': FONT_FAMILY_STACKS[settings.fontFamily],
                  '--appearance-preview-size': `${Math.round(14 * FONT_SIZE_SCALE[settings.fontSize])}px`,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <p className="appearance-display-preview-kicker">Preview</p>
              <p className="appearance-display-preview-body">How many players returned this week?</p>
              <p className="appearance-display-preview-muted">Secondary text · timestamps · captions</p>
            </div>
          </div>
          <section className="runtime-section runtime-section-last appearance-palette-section">
            <div className="appearance-section-heading">
              <h4 className="runtime-section-label">Entity colors</h4>
            </div>
            <div className="appearance-grid" role="table" aria-label="Answer entity colors">
              <div className="appearance-grid-head" role="row">
                <span role="columnheader">Entity</span>
                <span role="columnheader">Text</span>
                <span role="columnheader">Highlight</span>
                <span role="columnheader">Sample</span>
              </div>
              {(['catalog', 'schema', 'table', 'column', 'quote', 'tag'] as const).map((kind) => (
                <div className="appearance-grid-row" role="row" key={kind}>
                  <strong role="cell">{kind[0].toUpperCase() + kind.slice(1)}</strong>
                  {(['foreground', 'background'] as const).map((property) => {
                    const hex = settings.entityStyles[kind][property];
                    const update = (value: string) =>
                      setSettings((current) => ({
                        ...current,
                        entityStyles: {
                          ...current.entityStyles,
                          [kind]: { ...current.entityStyles[kind], [property]: value },
                        },
                      }));
                    return (
                      <label className="appearance-color" role="cell" key={property}>
                        <span className="appearance-mobile-label">
                          {property === 'foreground' ? 'Text' : 'Highlight'}
                        </span>
                        <span className="appearance-color-swatch">
                          <span aria-hidden="true" style={{ background: hex }} />
                          <input
                            type="color"
                            className="appearance-color-picker"
                            aria-label={`${kind} ${property} picker`}
                            value={isHexColor(hex) ? hex : '#000000'}
                            onChange={(event) => update(event.target.value)}
                          />
                        </span>
                        <Input
                          aria-label={`${kind} ${property}`}
                          pattern="#[0-9a-fA-F]{6}"
                          title="Use a six-digit hex color, including #."
                          value={hex}
                          onChange={(event) => update(event.target.value)}
                        />
                      </label>
                    );
                  })}
                  <span className="appearance-sample-plaque" role="cell">
                    <span className="appearance-mobile-label">Sample</span>
                    <span
                      className="appearance-sample"
                      style={{
                        color: settings.entityStyles[kind].foreground,
                        background: settings.entityStyles[kind].background,
                      }}
                    >
                      {ENTITY_SAMPLES[kind]}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
          <RuntimeTimezoneField
            value={settings.behavior.timezone}
            update={(timezone) =>
              setSettings((current) => ({
                ...current,
                behavior: { ...current.behavior, timezone },
              }))
            }
          />
        </>
      ) : null}
      {state === 'loading' ? <AdaptLoader label="Loading settings" className="settings-status" /> : null}
      {state === 'saved' ? (
        <p className="settings-status" role="status">
          Saved. The next ask uses these settings.
        </p>
      ) : null}
      {failure ? (
        <p className="settings-status settings-error" role="alert">
          {failure.message}
        </p>
      ) : null}
    </form>
  );
}
