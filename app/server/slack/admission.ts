export interface SlackAdmissionCaps {
  globalConcurrency: number;
  workspaceConcurrency: number;
  userConcurrency: number;
  conversationConcurrency: number;
  globalPerMinute: number;
  workspacePerMinute: number;
  userPerMinute: number;
  conversationPerMinute: number;
}

export interface SlackAdmissionKey {
  workspaceHash: string;
  userHash: string;
  conversationHash: string;
}

export type SlackAdmissionResult =
  | { admitted: true; lease: SlackAdmissionLease }
  | {
      admitted: false;
      reason: 'global_rate' | 'workspace_rate' | 'user_rate' | 'conversation_rate' | 'concurrency';
      retryAfterSeconds: number;
    };

export interface SlackAdmissionLease {
  release(): void;
}

interface ScopeCheck {
  key: string;
  cap: number;
  reason: Exclude<SlackAdmissionResult, { admitted: true }>['reason'];
}

const MINUTE_MS = 60_000;

export class SlackAdmissionController {
  readonly #caps: SlackAdmissionCaps;
  readonly #now: () => number;
  readonly #active = new Map<string, number>();
  readonly #events = new Map<string, number[]>();

  constructor(caps: SlackAdmissionCaps, now: () => number = Date.now) {
    this.#caps = caps;
    this.#now = now;
  }

  admit(key: SlackAdmissionKey): SlackAdmissionResult {
    const now = this.#now();
    const concurrency = [
      { key: 'global', cap: this.#caps.globalConcurrency },
      { key: `workspace:${key.workspaceHash}`, cap: this.#caps.workspaceConcurrency },
      { key: `user:${key.workspaceHash}:${key.userHash}`, cap: this.#caps.userConcurrency },
      {
        key: `conversation:${key.workspaceHash}:${key.conversationHash}`,
        cap: this.#caps.conversationConcurrency,
      },
    ];
    if (concurrency.some((scope) => (this.#active.get(scope.key) ?? 0) >= scope.cap)) {
      return { admitted: false, reason: 'concurrency', retryAfterSeconds: 1 };
    }

    const rates: ScopeCheck[] = [
      { key: 'global', cap: this.#caps.globalPerMinute, reason: 'global_rate' },
      {
        key: `workspace:${key.workspaceHash}`,
        cap: this.#caps.workspacePerMinute,
        reason: 'workspace_rate',
      },
      {
        key: `user:${key.workspaceHash}:${key.userHash}`,
        cap: this.#caps.userPerMinute,
        reason: 'user_rate',
      },
      {
        key: `conversation:${key.workspaceHash}:${key.conversationHash}`,
        cap: this.#caps.conversationPerMinute,
        reason: 'conversation_rate',
      },
    ];
    for (const scope of rates) {
      const events = this.#liveEvents(scope.key, now);
      if (events.length >= scope.cap) {
        return {
          admitted: false,
          reason: scope.reason,
          retryAfterSeconds: Math.max(1, Math.ceil((events[0] + MINUTE_MS - now) / 1000)),
        };
      }
    }

    for (const scope of concurrency) this.#active.set(scope.key, (this.#active.get(scope.key) ?? 0) + 1);
    for (const scope of rates) this.#liveEvents(scope.key, now).push(now);

    let released = false;
    return {
      admitted: true,
      lease: {
        release: () => {
          if (released) return;
          released = true;
          for (const scope of concurrency) {
            const next = Math.max(0, (this.#active.get(scope.key) ?? 0) - 1);
            if (next === 0) this.#active.delete(scope.key);
            else this.#active.set(scope.key, next);
          }
        },
      },
    };
  }

  #liveEvents(scope: string, now: number): number[] {
    const floor = now - MINUTE_MS;
    const current = this.#events.get(scope) ?? [];
    let firstLive = 0;
    while (firstLive < current.length && current[firstLive] <= floor) firstLive += 1;
    const live = firstLive === 0 ? current : current.slice(firstLive);
    if (live.length === 0) this.#events.delete(scope);
    else this.#events.set(scope, live);
    if (!this.#events.has(scope)) this.#events.set(scope, live);
    return live;
  }
}
