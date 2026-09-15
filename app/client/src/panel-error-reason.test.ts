import { describe, expect, it } from 'vitest';
import { panelErrorReason } from './panel-error-reason';

const FALLBACK = 'User Monitoring could not be loaded.';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('panelErrorReason', () => {
  it('surfaces the server detail joined with its remedy', async () => {
    const response = jsonResponse(409, {
      error: 'lakebase_update_required',
      detail: 'Lakebase update required',
      action: 'Open Connections and select Update Lakebase.',
    });
    await expect(panelErrorReason(response, FALLBACK)).resolves.toBe(
      'Lakebase update required. Open Connections and select Update Lakebase.'
    );
  });

  it('does not double a detail that already ends in a full stop', async () => {
    const response = jsonResponse(503, {
      error: 'identity_roster_unavailable',
      detail: 'User Monitoring could not read the authoritative Identity settings roster.',
    });
    await expect(panelErrorReason(response, FALLBACK)).resolves.toBe(
      'User Monitoring could not read the authoritative Identity settings roster.'
    );
  });

  it('names the access boundary rather than the body on a 403', async () => {
    const response = jsonResponse(403, { error: 'forbidden', detail: 'nope' });
    await expect(panelErrorReason(response, FALLBACK)).resolves.toBe(
      'You do not have access to these Monitoring details.'
    );
  });

  it("keeps the panel's own line when the body carries no readable reason", async () => {
    const noDetail = jsonResponse(503, { error: 'user_spend_preparing' });
    await expect(panelErrorReason(noDetail, FALLBACK)).resolves.toBe(FALLBACK);
    const notJson = new Response('gateway timeout', { status: 504 });
    await expect(panelErrorReason(notJson, FALLBACK)).resolves.toBe(FALLBACK);
  });
});
