import type { Application, Request, Response } from 'express';
import type { InsightsAppKit } from './insights-routes';
import type { SlackReadiness } from '../slack/bootstrap';

export type SlackOperatorState =
  | 'disabled'
  | 'kill-switch'
  | 'transport-unavailable'
  | 'broker-unavailable'
  | 'config-invalid'
  | 'store-unavailable'
  | 'running';

export interface SlackStatusPayload {
  state: SlackOperatorState;
  ready: boolean;
  acceptsNewEvents: boolean;
}

export function safeSlackStatus(readiness: SlackReadiness): SlackStatusPayload {
  const state: SlackOperatorState = readiness.ready
    ? 'running'
    : readiness.reason === 'kill_switch'
      ? 'kill-switch'
      : readiness.reason === 'transport_unavailable'
        ? 'transport-unavailable'
        : readiness.reason === 'broker_unavailable'
          ? 'broker-unavailable'
          : readiness.reason === 'settings_unavailable'
            ? 'store-unavailable'
            : readiness.reason === 'disabled' || readiness.reason === 'stopped'
              ? 'disabled'
              : 'config-invalid';
  return {
    state,
    ready: state === 'running',
    acceptsNewEvents: state === 'running',
  };
}

export function setupSlackStatusRoutes(
  appkit: InsightsAppKit,
  dependencies: { readiness: () => SlackReadiness }
): void {
  appkit.server.extend((app: Application) => {
    const status = (_req: Request, res: Response) => {
      res.json(safeSlackStatus(dependencies.readiness()));
    };
    // Consumer health and admin inspection remain available while the kill
    // switch blocks Socket Mode processing. The payload contains no ids, refs,
    // URLs, target names, or secret-derived detail.
    app.get('/api/slack/status', status);
    app.get('/api/admin/slack/status', status);
  });
}
