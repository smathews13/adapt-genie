import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { MonitoringQuestionsPayload } from '../../shared/monitoring-contract';
import {
  MONITORING_FEEDBACK_SCHEMA_REVISION,
  type MonitoringFeedbackPayload,
} from '../../shared/monitoring-feedback-contract';
import { FeedbackBrowserPanel } from './FeedbackBrowserPanel';
import { SummaryStrip } from './MonitoringPage';

const CSS = readFileSync(new URL('./styles/monitoring.css', import.meta.url), 'utf8');
const RESPONSIVE = readFileSync(new URL('./styles/responsive-monitoring.css', import.meta.url), 'utf8');
const DIALOG = readFileSync(new URL('./Dialog.tsx', import.meta.url), 'utf8');
const PANEL_SOURCE = readFileSync(new URL('./FeedbackBrowserPanel.tsx', import.meta.url), 'utf8');
const USER_LINK_SOURCE = readFileSync(new URL('./UserDrilldownLink.tsx', import.meta.url), 'utf8');

const monitoring: MonitoringQuestionsPayload = {
  readState: 'ok',
  readAt: '2026-09-03T12:00:00Z',
  summary: {
    questionsAsked: 23,
    userThreads: 12,
    completed: 20,
    partial: 2,
    refused: 1,
    failed: 0,
    helpful: 9,
    feedbackTotal: 9,
    medianMs: 36_500,
    timedCount: 22,
  },
  questions: [],
  people: [],
  tables: [],
  grantsResolution: 'ok',
  pagination: { pageSize: 50, total: 23, hasMore: false, nextCursor: null },
};

const payload: MonitoringFeedbackPayload = {
  schemaRevision: MONITORING_FEEDBACK_SCHEMA_REVISION,
  readAt: '2026-09-03T12:00:00Z',
  dataRevision: 'feedback-rev',
  identityRevision: 'identity-rev',
  summary: { total: 2, helpful: 1, notHelpful: 1, comments: 1 },
  rows: [
    {
      id: 'feedback-2',
      questionId: 'question-2',
      conversationId: 'conversation-2',
      runId: 'answer-2',
      question: 'Which players improved?',
      askedAt: '2026-09-03T10:59:00Z',
      userEmail: 'coach@example.com',
      role: 'consumer',
      organization: { domain: 'example.com', name: 'Example' },
      feedback: 'down',
      comment: 'The comparison was missing.',
      submittedAt: '2026-09-03T11:00:00Z',
    },
    {
      id: 'feedback-1',
      questionId: 'question-1',
      conversationId: 'conversation-1',
      runId: 'answer-1',
      question: 'Show the latest lineup.',
      askedAt: '2026-09-03T09:59:00Z',
      userEmail: 'owner@example.com',
      role: 'super_admin',
      organization: { domain: 'example.com', name: 'Example' },
      feedback: 'up',
      comment: null,
      submittedAt: '2026-09-03T10:00:00Z',
    },
  ],
  filters: {
    users: [{ value: 'coach@example.com', label: 'coach@example.com', count: 1 }],
    roles: [{ value: 'consumer', label: 'Consumer', count: 1 }],
    organizations: [{ value: 'example.com', label: 'Example', count: 2 }],
  },
  pagination: { pageSize: 5, total: 2, hasMore: false, nextCursor: null },
};

const filters = {
  search: '',
  feedback: '' as const,
  user: '',
  role: '',
  organization: '',
};

function panel(
  state: Parameters<typeof FeedbackBrowserPanel>[0]['state'],
  activeFilters: Parameters<typeof FeedbackBrowserPanel>[0]['filters'] = filters,
  range: Parameters<typeof FeedbackBrowserPanel>[0]['range'] = '7d',
  rangeLabel = '7 days'
) {
  return renderToStaticMarkup(
    <FeedbackBrowserPanel
      state={state}
      filters={activeFilters}
      range={range}
      rangeLabel={rangeLabel}
      page={0}
      onClose={() => undefined}
      onFilters={() => undefined}
      onRange={() => undefined}
      onClear={() => undefined}
      onOpenQuestion={() => undefined}
      onPrevious={() => undefined}
      onNext={() => undefined}
      onRetry={() => undefined}
    />
  );
}

describe('Monitoring feedback entry card', () => {
  it('is a semantic button with an affordance only for an authorized reader', () => {
    const admin = renderToStaticMarkup(
      <SummaryStrip payload={monitoring} periodLabel="7 days" onOpenFeedback={() => undefined} />
    );
    const consumer = renderToStaticMarkup(<SummaryStrip payload={monitoring} periodLabel="7 days" />);

    expect(admin).toContain('<button');
    expect(admin).toContain('Open feedback');
    expect(admin).toContain('Feedback, 7 days');
    expect(consumer).not.toContain('Open feedback');
    expect(consumer).toContain('role="group"');
  });

  it('has visible pointer, hover, and keyboard focus treatment', () => {
    expect(CSS).toMatch(/\.monitoring-tile-action\s*\{[^}]*cursor:\s*pointer/s);
    expect(CSS).toContain('.monitoring-tile-action:hover');
    expect(CSS).toContain('.monitoring-tile-action:focus-visible');
  });
});

describe('feedback corpus modal', () => {
  it('renders six ordered columns with Role separate from User', () => {
    const markup = panel({ status: 'ready', key: 'feedback', requestId: 1, data: payload, error: null });
    const headers = ['Question', 'User', 'Role', 'Feedback', 'Comment', 'Submitted'];
    const headerPositions = headers.map((header) => markup.indexOf(`>${header}</th>`));
    const tbody = markup.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
    const rows = tbody.match(/<tr[\s\S]*?<\/tr>/g) ?? [];

    expect(markup).toContain('2 total · 1 helpful · 1 not helpful');
    expect(headerPositions.every((position) => position >= 0)).toBe(true);
    expect(headerPositions).toEqual([...headerPositions].sort((left, right) => left - right));
    expect(markup.match(/<th scope="col">/g)).toHaveLength(6);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.match(/<td /g)).toHaveLength(6);
      expect([...row.matchAll(/data-label="([^"]+)"/g)].map((match) => match[1])).toEqual(headers);
      const userCell = row.match(/<td data-label="User"[\s\S]*?<\/td>/)?.[0] ?? '';
      const roleCell = row.match(/<td data-label="Role"[\s\S]*?<\/td>/)?.[0] ?? '';
      expect(userCell).toContain('user-drilldown-link');
      expect(userCell).not.toContain('data-role-state');
      expect(roleCell).toContain('data-role-state');
      expect(roleCell).not.toContain('user-drilldown-link');
    }
    expect(markup).toContain('The comparison was missing.');
    expect(markup).toContain('>—</span>');
    expect(markup).toContain('lucide-thumbs-up');
    expect(markup).toContain('lucide-thumbs-down');
    expect(markup).toContain('Open user overview for coach');
    expect(markup).toContain('aria-label="Open question details: Which players improved?"');
    expect(markup).toContain('data-role-state="consumer"');
    expect(markup).toContain('data-role-state="super_admin"');
    expect(markup).toContain('aria-label="Role: Consumer"');
    expect(markup).toContain('aria-label="Role: Super admin"');
    expect(markup).toContain('data-label="Role" class="monitoring-feedback-role" title="Consumer"');
    expect(markup).not.toContain('aria-live=');
    expect(markup).not.toMatch(/star|spend|cost/i);
  });

  it('keeps row activation and username navigation isolated', () => {
    expect(PANEL_SOURCE).toContain('const activation = monitoringQuestionRowHandlers(row, onOpenQuestion)');
    expect(PANEL_SOURCE).toContain('<UserDrilldownLink identity={row.userEmail} compact canOpen showArrow />');
    expect(USER_LINK_SOURCE.match(/onClick=\{\(event\) => event\.stopPropagation\(\)\}/g)).toHaveLength(2);
  });

  it('offers period, feedback, user, role, organization, and search controls', () => {
    const markup = panel({ status: 'ready', key: 'feedback', requestId: 1, data: payload, error: null });
    expect(markup).toContain('Time range for Feedback');
    expect(markup).toContain('Search feedback by question, user, or comment');
    for (const label of ['feedback', 'user', 'role', 'organization']) {
      expect(markup).toContain(`Filter feedback by ${label}`);
    }
    const roleFiltered = panel(
      { status: 'ready', key: 'feedback-role', requestId: 2, data: payload, error: null },
      { ...filters, role: 'consumer' }
    );
    expect(roleFiltered).toContain('aria-label="Filter feedback by role: Consumer (1)"');
    expect(roleFiltered).toContain('data-role-state="consumer"');
  });

  it('renders exact filtered KPIs with one shared dynamic period badge and honest zero states', () => {
    const markup = panel({ status: 'ready', key: 'feedback', requestId: 1, data: payload, error: null });
    expect(markup.match(/monitoring-feedback-kpi(?: |")/g)).toHaveLength(5);
    expect(markup.match(/monitoring-feedback-period-badge/g)).toHaveLength(1);
    expect(markup).toContain('>7 days</span>');
    expect(markup).toContain('Total feedback');
    expect(markup).toContain('Helpful rate');
    expect(markup).toContain('>50%<');
    expect(markup).toContain('Comments captured');

    const zero = panel({
      status: 'ready',
      key: 'feedback-zero',
      requestId: 2,
      data: { ...payload, rows: [], summary: { total: 0, helpful: 0, notHelpful: 0, comments: 0 } },
      error: null,
    });
    expect(zero).toContain('No feedback');
    expect(zero).not.toContain('>0%<');
  });

  it('uses one compact desktop filter row and deliberate responsive reflow', () => {
    expect(CSS).toMatch(
      /\.monitoring-feedback-filter-row\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(5,\s*136px\)[^}]*justify-content:\s*start/s
    );
    expect(CSS).toMatch(
      /\.monitoring-feedback-filter-trigger\s*\{[^}]*width:\s*136px[^}]*min-width:\s*136px[^}]*max-width:\s*136px[^}]*height:\s*32px/s
    );
    expect(RESPONSIVE).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.monitoring-feedback-filter-row\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)[\s\S]*?\.monitoring-feedback-filter-trigger\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/
    );
  });

  it('fits five one-line rows in a compact accessible table viewport', () => {
    expect(CSS).toMatch(/\.monitoring-feedback-table-frame\s*\{[^}]*flex:\s*1 1 252px[^}]*min-height:\s*252px/s);
    expect(CSS).toMatch(/\.monitoring-feedback-table td\s*\{[^}]*height:\s*44px/s);
    expect(CSS).toMatch(
      /\.monitoring-feedback-question,\s*\.monitoring-feedback-comment\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s
    );
    expect(CSS).toMatch(/\.monitoring-feedback-submitted\s*\{[^}]*white-space:\s*nowrap/s);
  });

  it('renders branded skeleton loading, concise error/retry, and the exact empty state', () => {
    const loading = panel({ status: 'loading', key: 'feedback', requestId: 1, data: null, error: null });
    const error = panel({
      status: 'error',
      key: 'feedback',
      requestId: 1,
      data: null,
      error: 'Feedback could not be loaded.',
    });
    const empty = panel({
      status: 'ready',
      key: 'feedback',
      requestId: 1,
      data: { ...payload, rows: [], summary: { total: 0, helpful: 0, notHelpful: 0, comments: 0 } },
      error: null,
    });
    expect(loading).toContain('ast-mark');
    expect(loading).toContain('Loading feedback');
    expect(loading).toContain('data-slot="skeleton"');
    expect(loading.match(/monitoring-feedback-kpi-skeleton/g)).toHaveLength(5);
    expect(error).toContain('role="alert"');
    expect(error).toContain('Retry');
    expect(error.match(/>Unavailable</g)).toHaveLength(5);
    expect(empty).toContain('class="monitoring-feedback-empty"');
    expect(empty).toContain('ast-mark');
    expect(empty).toContain('No feedback matches these filters');
    expect(CSS).toMatch(/\.monitoring-feedback-empty\s*\{[^}]*justify-items:\s*center[^}]*gap:\s*8px/s);
  });

  it('uses the shared body portal/focus trap and compensates for scrollbar removal', () => {
    expect(DIALOG).toContain('createPortal(overlay, document.body)');
    expect(DIALOG).toContain('document.body.style.paddingRight');
    expect(DIALOG).toContain('dialogTabTarget');
    expect(CSS).toMatch(/\.monitoring-feedback-modal\s*\{[^}]*width:/s);
  });
});
