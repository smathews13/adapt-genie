import { describe, expect, it } from 'vitest';
import { SlackAdmissionController, type SlackAdmissionCaps } from './admission';

const caps: SlackAdmissionCaps = {
  globalConcurrency: 3,
  workspaceConcurrency: 2,
  userConcurrency: 1,
  conversationConcurrency: 1,
  globalPerMinute: 10,
  workspacePerMinute: 5,
  userPerMinute: 2,
  conversationPerMinute: 2,
};

describe('Slack admission controller', () => {
  it('isolates users and conversations while enforcing concurrency', () => {
    const controller = new SlackAdmissionController(caps, () => 0);
    const first = controller.admit({ workspaceHash: 'w', userHash: 'u1', conversationHash: 'c1' });
    expect(first.admitted).toBe(true);
    expect(controller.admit({ workspaceHash: 'w', userHash: 'u1', conversationHash: 'c2' })).toMatchObject({
      admitted: false,
      reason: 'concurrency',
    });
    expect(controller.admit({ workspaceHash: 'w', userHash: 'u2', conversationHash: 'c2' }).admitted).toBe(true);
    if (first.admitted) first.lease.release();
    expect(controller.admit({ workspaceHash: 'w', userHash: 'u1', conversationHash: 'c3' }).admitted).toBe(true);
  });

  it('returns deterministic Retry-After and expires rate entries', () => {
    let now = 1_000;
    const controller = new SlackAdmissionController(caps, () => now);
    const key = { workspaceHash: 'w', userHash: 'u', conversationHash: 'c' };
    for (let count = 0; count < 2; count += 1) {
      const result = controller.admit(key);
      expect(result.admitted).toBe(true);
      if (result.admitted) result.lease.release();
    }
    expect(controller.admit(key)).toEqual({ admitted: false, reason: 'user_rate', retryAfterSeconds: 60 });
    now += 60_001;
    expect(controller.admit(key).admitted).toBe(true);
  });

  it('makes release idempotent', () => {
    const controller = new SlackAdmissionController(caps);
    const first = controller.admit({ workspaceHash: 'w', userHash: 'u', conversationHash: 'c' });
    expect(first.admitted).toBe(true);
    if (first.admitted) {
      first.lease.release();
      first.lease.release();
    }
    expect(controller.admit({ workspaceHash: 'w', userHash: 'u', conversationHash: 'c' }).admitted).toBe(true);
  });
});
