import { describe, expect, it, vi } from 'vitest';
import { readEffectiveSlackSettings, writeSlackSettings } from './settings-store';

describe('Slack operational settings store', () => {
  it('treats a read failure as disabled with the kill switch on', async () => {
    const client = { lakebase: { query: vi.fn().mockRejectedValue(new Error('unavailable')) } };
    await expect(readEffectiveSlackSettings(client)).resolves.toMatchObject({
      storeReady: false,
      revision: 0,
      settings: { enabled: false, killSwitch: true },
    });
  });

  it('uses optimistic revision updates', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            settings: {
              enabled: false,
              killSwitch: true,
              allowedRegistrationId: 'disabled',
              replyStyle: 'thread',
              limits: {
                globalConcurrency: 1,
                workspaceConcurrency: 1,
                userConcurrency: 1,
                conversationConcurrency: 1,
                globalPerMinute: 1,
                workspacePerMinute: 1,
                userPerMinute: 1,
                conversationPerMinute: 1,
              },
            },
            revision: 3,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            settings: {
              enabled: true,
              killSwitch: true,
              allowedRegistrationId: 'disabled',
              replyStyle: 'thread',
              limits: {
                globalConcurrency: 1,
                workspaceConcurrency: 1,
                userConcurrency: 1,
                conversationConcurrency: 1,
                globalPerMinute: 1,
                workspacePerMinute: 1,
                userPerMinute: 1,
                conversationPerMinute: 1,
              },
            },
            revision: 4,
          },
        ],
      });
    await writeSlackSettings({ lakebase: { query } }, { enabled: true }, 3, 'admin@example.com');
    expect(query.mock.calls[1]?.[0]).toContain('WHERE id = $1 AND revision = $4');
  });
});
