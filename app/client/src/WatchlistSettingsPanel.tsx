import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_INSIGHT_RAIL_SECTIONS,
  WATCHLIST_MAX_TITLES,
  type InsightRailSections,
  type WatchlistSettings,
} from '../../shared/watchlist';
import { Input, Switch } from './ui';
import { Search } from 'lucide-react';
import type { SettingsSaveState } from './settings-save-state';
import {
  notifyInsightsSettingsChanged,
  watchlistSettingsFromResponse,
  watchlistTitlesFromResponse,
} from './watchlist-api';
import { VisitInDatabricks } from './DataEntityLinks';
import { AdaptLoader } from './AdaptLoadingAnimation';

export const WATCHLIST_SETTINGS_FORM_ID = 'settings-watchlist-form';

export function WatchlistSettingsPanel({
  onSaveState,
  onDirtyChange,
}: {
  onSaveState: (state: SettingsSaveState) => void;
  onDirtyChange: (count: number) => void;
}) {
  const [availableTitles, setAvailableTitles] = useState<string[]>([]);
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]);
  const [sections, setSections] = useState<InsightRailSections>({ ...DEFAULT_INSIGHT_RAIL_SECTIONS });
  const [query, setQuery] = useState('');
  const [sourceTable, setSourceTable] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'failed'>('loading');
  const [failure, setFailure] = useState('');
  const [saved, setSaved] = useState<WatchlistSettings | null>(null);
  const revision = useRef(0);

  const load = useCallback(async () => {
    setState('loading');
    setFailure('');
    try {
      const [document, titleCatalog] = await Promise.all([
        fetch('/api/watchlist-settings').then(watchlistSettingsFromResponse),
        fetch('/api/watchlist-titles').then(watchlistTitlesFromResponse),
      ]);
      if (titleCatalog.status !== 'ready') throw new Error(titleCatalog.detail);
      const selectedKeys = new Set(document.settings.titles.map((title) => title.toLocaleLowerCase()));
      const selected = titleCatalog.titles.filter((title) => selectedKeys.has(title.toLocaleLowerCase()));
      setAvailableTitles(titleCatalog.titles);
      setSelectedTitles(selected);
      setSections(document.settings.sections);
      setSourceTable(titleCatalog.sourceTable);
      setSaved({ titles: selected, sections: document.settings.sections });
      revision.current = document.revision;
      setState('ready');
    } catch (error) {
      setState('failed');
      setFailure((error as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = saved
    ? Number(
        selectedTitles.join('\n') !== saved.titles.join('\n') ||
          JSON.stringify(sections) !== JSON.stringify(saved.sections)
      )
    : 0;
  const visibleTitles = availableTitles.filter((title) =>
    title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  useEffect(() => onDirtyChange(changed), [changed, onDirtyChange]);

  async function saveSettings() {
    if (!saved) {
      setState('loading');
      setFailure('');
      await load();
      return;
    }
    setState('saving');
    setFailure('');
    onSaveState({ kind: 'saving' });
    try {
      const response = await fetch('/api/admin/watchlist-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: revision.current, patch: { titles: selectedTitles, sections } }),
      });
      const document = await watchlistSettingsFromResponse(response);
      setSaved(document.settings);
      revision.current = document.revision;
      setSelectedTitles(document.settings.titles);
      setSections(document.settings.sections);
      notifyInsightsSettingsChanged(document.settings);
      setState('ready');
      onDirtyChange(0);
      onSaveState({ kind: 'saved', count: changed });
    } catch (error) {
      setState('failed');
      setFailure((error as Error).message);
      onSaveState({ kind: 'failed', message: (error as Error).message });
    }
  }

  return (
    <form
      id={WATCHLIST_SETTINGS_FORM_ID}
      className="settings-pane watchlist-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void saveSettings();
      }}
    >
      <div className="settings-pane-heading">
        <h3>Insights</h3>
        <p>Choose which visuals appear in the Insights rail and which titles its sales watchlist tracks.</p>
      </div>
      <section className="insights-visibility-settings" aria-labelledby="insights-visibility-title">
        <div className="insights-settings-heading">
          <h4 id="insights-visibility-title">Insights Rail (righthand bar)</h4>
          <p>Show or hide each section without changing its underlying data.</p>
        </div>
        {(
          [
            ['dataInScope', 'Data in scope'],
            ['watchlist', 'Watchlist'],
            ['answerConfidence', 'Answer confidence'],
          ] as const
        ).map(([key, label]) => (
          <div className="watchlist-title-row" key={key}>
            <span>{label}</span>
            <Switch
              checked={sections[key]}
              disabled={state === 'loading' || state === 'saving' || !saved}
              aria-label={`${sections[key] ? 'Hide' : 'Show'} ${label} in the Insights rail`}
              onCheckedChange={(enabled) => {
                setSections((current) => ({ ...current, [key]: enabled }));
                onSaveState({ kind: 'idle' });
              }}
            />
          </div>
        ))}
      </section>
      {state === 'loading' ? (
        <AdaptLoader label="Loading titles from the sales table" className="settings-status" />
      ) : null}
      {state !== 'loading' && availableTitles.length > 0 ? (
        <section className="watchlist-games-settings" aria-labelledby="watchlist-games-title">
          <div className="watchlist-games-heading insights-settings-heading">
            <h4 id="watchlist-games-title">Watchlist games</h4>
            <p>Choose the titles shown in the Insights rail.</p>
          </div>
          <div className="watchlist-title-summary">
            <span>
              {selectedTitles.length} of {availableTitles.length} selected
            </span>
            <span>Up to {WATCHLIST_MAX_TITLES} titles</span>
          </div>
          <label className="watchlist-search">
            <Search aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
              placeholder="Search games"
              aria-label="Search games"
            />
          </label>
          <div className="watchlist-title-list" role="group" aria-label="Titles shown on the Ask rail">
            {visibleTitles.map((title) => {
              const checked = selectedTitles.includes(title);
              const atLimit = !checked && selectedTitles.length >= WATCHLIST_MAX_TITLES;
              return (
                <div className="watchlist-title-row" key={title}>
                  <span>{title}</span>
                  <Switch
                    checked={checked}
                    disabled={state === 'saving' || atLimit}
                    aria-label={`${checked ? 'Remove' : 'Add'} ${title} ${checked ? 'from' : 'to'} the watchlist`}
                    onCheckedChange={(enabled) => {
                      setSelectedTitles((current) =>
                        enabled ? [...current, title] : current.filter((candidate) => candidate !== title)
                      );
                      onSaveState({ kind: 'idle' });
                    }}
                  />
                </div>
              );
            })}
            {visibleTitles.length === 0 ? <p className="settings-status watchlist-empty">No matching games.</p> : null}
          </div>
          <p className="settings-status">
            Refreshed from{' '}
            <VisitInDatabricks name={sourceTable} className="watchlist-source-link">
              <code>{sourceTable}</code>
            </VisitInDatabricks>{' '}
            whenever this tab opens.
          </p>
        </section>
      ) : null}
      {failure ? (
        <p className="settings-status settings-error" role="alert">
          {failure}
        </p>
      ) : null}
    </form>
  );
}
