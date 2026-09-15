/**
 * The reader-facing reason a Monitoring panel could not load.
 *
 * The panel endpoints answer a failed read with `{ error, detail, action }`,
 * where `detail`/`action` name what is wrong and the one move that fixes it
 * ("Lakebase update required. Open Connections and select Update Lakebase.").
 * A 403 is the exception: its body says nothing a viewer should see, so it is
 * always the same access sentence. When the body carries no readable reason --
 * a transport error, an unparseable answer -- the panel's own generic line
 * stands rather than a raw HTTP code.
 */

/** An error whose message is a sentence already fit to show a reader. */
export class PanelRequestError extends Error {}

export async function panelErrorReason(response: Response, fallback: string): Promise<string> {
  if (response.status === 403) return 'You do not have access to these Monitoring details.';
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const detail = typeof (body as { detail?: unknown }).detail === 'string' ? (body as { detail: string }).detail.trim() : '';
      const action = typeof (body as { action?: unknown }).action === 'string' ? (body as { action: string }).action.trim() : '';
      if (detail) {
        const sentence = /[.!?]$/.test(detail) ? detail : `${detail}.`;
        return action ? `${sentence} ${action}` : sentence;
      }
      // A body can name the fixing move without a detail sentence; the remedy is
      // the point of the panel, so show it rather than falling back to generic.
      if (action) return action;
    }
  } catch {
    // Not a JSON body we can read a reason from; the panel's own line stands.
  }
  return fallback;
}
