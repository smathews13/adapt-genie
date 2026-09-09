/**
 * Genie, embedded.
 *
 * The one page in this app that is a window onto the workspace rather than the
 * app's own surface: it frames the Data Genie space's room so a reader can ask
 * the underlying Genie the same questions the agent asks it, without leaving
 * ADAPT. The room URL is built from the checks `session-checks` already ran and
 * the host `/api/architecture` reports (see `genie-embed.ts`), so this page adds
 * no fetch of its own beyond the workspace host.
 *
 * The iframe points at the room's `/embed` surface, which the workspace's AI/BI
 * embedding policy allows in a cross-origin frame (the plain room page does not
 * -- it always sends X-Frame-Options to stop the workspace UI being clickjacked).
 * The heading still carries an "Open in Databricks" link to the full room page,
 * both as the richer surface and as the way out if a future policy change ever
 * blocks the frame again.
 */
import { CircleAlert, ExternalLink } from 'lucide-react';

import { PageHeading } from './page-chrome';
import { useSessionChecks } from './session-checks';
import { useWorkspaceHost } from './data-entity-state';
import { dataGenieSpaceId, genieEmbedUrl, genieRoomUrl } from './genie-embed';
import { Alert, AlertDescription } from './ui';

export function GeniePage() {
  const { session, running } = useSessionChecks();
  const host = useWorkspaceHost();
  const settings = session?.settings ?? null;

  const embedUrl = genieEmbedUrl(host, settings);
  const roomUrl = genieRoomUrl(host, settings);
  const spaceId = dataGenieSpaceId(settings);
  // Nothing to show yet, rather than nothing to show: the checks run once per
  // session and the host is a separate read, so a blank first paint is a page
  // mid-flight, not a page with no Genie space. The empty state below is only
  // reached once both have landed and there is still no id or host.
  const resolving = (!spaceId || !host) && (running || !session);

  return (
    <div className="page-shell genie-page">
      <PageHeading
        title="Genie"
        actions={
          roomUrl ? (
            <a className="genie-open-link" href={roomUrl} target="_blank" rel="noopener noreferrer">
              Open in Databricks <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          ) : undefined
        }
      />

      {embedUrl ? (
        <div className="genie-embed">
          <iframe className="genie-frame" title="Genie space" src={embedUrl} allow="clipboard-write" />
        </div>
      ) : resolving ? (
        <p className="genie-status" role="status">
          Locating the Genie space…
        </p>
      ) : (
        <Alert>
          <CircleAlert />
          <AlertDescription>
            This deployment reported no Genie space to embed, or the workspace host is unknown, so there is nothing to
            open here yet. The Connections page shows which dependencies the app can and cannot see.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
