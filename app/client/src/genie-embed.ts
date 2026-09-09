/**
 * Where the Genie tab points its iframe.
 *
 * Nothing here fetches: it reads the Data Genie space out of the same
 * `/api/settings` checks Connections and the insight rail already run through
 * `session-checks`, and combines it with the workspace host `/api/architecture`
 * reports. Both are arguments rather than reads so the URL can be built and
 * tested without a browser, and an empty id or a missing host produces no URL at
 * all -- an iframe with a guessed `src` lands the reader on a workspace that is
 * not theirs, which is worse than a page that says it has nothing to show yet.
 */
import type { SettingsPayload } from './connection-model';
import { databricksLink, normalizeWorkspaceHost } from '../../shared/databricks-links';

/**
 * The Data Genie space's id, from the settings checks, or '' when none landed.
 *
 * The dependency probe emits the data space under id `genie-data` and the
 * dictionary space under `genie-dictionary`, both with `kind: 'genie-space'` and
 * the space id in `name`. This prefers the data space -- the one a reader asks
 * questions of -- and falls back to whichever Genie space the checks did report,
 * so a deployment that named its space differently still embeds something.
 */
export function dataGenieSpaceId(settings: SettingsPayload | null): string {
  const spaces = (settings?.checks ?? []).filter((check) => check.kind === 'genie-space' && check.name.trim() !== '');
  const data = spaces.find((check) => check.id === 'genie-data') ?? spaces[0];
  return data ? data.name.trim() : '';
}

/**
 * The URL the iframe points at: the Genie room's EMBED surface.
 *
 * `/embed/genie/rooms/<id>` rather than `/genie/rooms/<id>`. The `/embed` prefix
 * is the chromeless, frameable surface Databricks' own Share -> Embed dialog
 * generates -- it drops the workspace nav and, unlike the plain room page (which
 * always sends X-Frame-Options to stop the workspace UI being clickjacked), it is
 * governed by the workspace's AI/BI embedding policy and renders in a
 * cross-origin frame when that policy allows it. No `?o=<workspace>` is needed:
 * the host already names the workspace, and the embed surface resolves without
 * it. The plain room page stays the target of the "Open in Databricks" link, via
 * {@link genieRoomUrl}.
 */
export function genieEmbedUrl(host: string, settings: SettingsPayload | null): string {
  const spaceId = dataGenieSpaceId(settings);
  const base = normalizeWorkspaceHost(host);
  if (!spaceId || !base) return '';
  return `${base}/embed/genie/rooms/${encodeURIComponent(spaceId)}`;
}

/**
 * The workspace URL of the Data Genie space's interactive room page -- the
 * "Open in Databricks" target -- or '' when it cannot be built (no host, or no
 * Genie space in the checks). This is the full room, not the embed surface.
 */
export function genieRoomUrl(host: string, settings: SettingsPayload | null): string {
  const spaceId = dataGenieSpaceId(settings);
  if (!spaceId) return '';
  return databricksLink(host, { kind: 'genie-space', spaceId }) ?? '';
}
