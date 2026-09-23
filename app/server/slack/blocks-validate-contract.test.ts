import { describe, expect, it, vi } from 'vitest';
import { validateWithSlack } from './blocks-validate-contract';

describe('optional Slack blocks.validate contract', () => {
  it('passes documented blocks to an injected validator without network access', async () => {
    const validate = vi.fn().mockResolvedValue({ ok: true, errors: [] });
    await expect(
      validateWithSlack(
        { validate },
        {
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Safe fixture' } }],
        }
      )
    ).resolves.toEqual({ ok: true, errors: [] });
    expect(validate).toHaveBeenCalledOnce();
  });
});
