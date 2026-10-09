import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnswerCard } from './AnswerCard';
import { normalizeAnswer, type WireAnswer } from './answer-shape';
import { DEGRADED_ANSWER_MARKER } from './degraded-answer';
import { showsCaveatsFirst, showsSqlTrace, type RoleState } from './role';
import type { Answer, FeedbackEntry } from './app-types';

const feedback: FeedbackEntry = {
  open: false,
  comment: '',
  saved: false,
  saving: false,
  error: null,
  usefulness: null,
};

const CAVEAT = 'Retention could only be estimated for recent players because older cohorts were missing.';

function answer(extra: Partial<WireAnswer> = {}): Answer {
  return normalizeAnswer({
    id: 'answer-1',
    mode: 'live',
    provenance: 'live',
    takeaway: 'Retention is about 40 percent.',
    narrative: 'Retention is about 40 percent over the last 30 days.',
    figures: [{ label: 'Retention', value: 40, display: '40%', comparison: '30 days' }],
    sources: [{ name: 'main.game.retention', role: 'primary' }],
    caveats: [CAVEAT],
    sql: 'SELECT cohort, retention FROM main.game.retention',
    derivation: [{ source: 'main.game.retention', metric: 'retention', window: 'last 30 days', filter: 'all players' }],
    trace: { stages: [] },
    ...extra,
  }) as Answer;
}

function render(role: RoleState, value: Answer = answer()): string {
  return renderToStaticMarkup(
    <AnswerCard
      answer={value}
      feedback={feedback}
      onFeedbackChange={() => {}}
      saveFeedback={async () => {}}
      showFeedback={false}
      showRunProcess={role === 'admin' || role === 'super_admin'}
      collapseSupportingDetails
      caveatsFirst={showsCaveatsFirst(role)}
      showSqlTrace={showsSqlTrace(role)}
    />
  );
}

describe('role gates', () => {
  it.each<[RoleState, boolean, boolean]>([
    ['consumer', true, true],
    ['executive', true, true],
    ['admin', true, false],
    ['super_admin', true, false],
    ['failed', false, false],
    ['resolving', false, false],
  ])('%s: caveats first=%s, sql-only trace=%s', (role, caveats, sql) => {
    expect(showsCaveatsFirst(role)).toBe(caveats);
    expect(showsSqlTrace(role)).toBe(sql);
  });
});

describe('caveats at the top of the answer', () => {
  it('draws caveats open, before the figures, for a consumer', () => {
    const markup = render('consumer');
    expect(markup).toContain(CAVEAT);
    expect(markup.indexOf(CAVEAT)).toBeLessThan(markup.indexOf('answer-figure-summary'));
    expect(markup.indexOf('aria-label="Caveats"')).toBeGreaterThan(markup.indexOf('answer-takeaway'));
    expect(markup.match(/aria-label="Caveats"/g)).toHaveLength(1);
  });

  it('does the same for admins', () => {
    const markup = render('admin');
    expect(markup.indexOf(CAVEAT)).toBeLessThan(markup.indexOf('answer-figure-summary'));
  });

  it('does the same for executives', () => {
    const markup = render('executive');
    expect(markup.indexOf(CAVEAT)).toBeLessThan(markup.indexOf('answer-figure-summary'));
    expect(markup.match(/aria-label="Caveats"/g)).toHaveLength(1);
  });

  it('adds the method used only when the answer is partial', () => {
    const complete = render('consumer');
    expect(complete).not.toContain('Method used');

    const partial = render(
      'consumer',
      answer({
        narrative: 'Retention looks to be roughly flat.',
        figures: [],
        caveats: [CAVEAT, `${DEGRADED_ANSWER_MARKER} no structured result arrived and no tool steps were recorded.`],
      })
    );
    expect(partial).toContain('Method used');
    expect(partial).toContain('Measured retention over last 30 days filtered by all players from main.game.retention');
  });
});

describe('method without ordinary caveats', () => {
  it('still draws the method used when the only caveat is a degradation notice', () => {
    const markup = render(
      'consumer',
      answer({
        narrative: 'Retention looks to be roughly flat.',
        figures: [],
        caveats: [`${DEGRADED_ANSWER_MARKER} no structured result arrived and no tool steps were recorded.`],
      })
    );
    expect(markup).toContain('Method used');
    expect(markup).toContain('Measured retention over last 30 days');
    expect(markup).not.toContain('aria-label="Caveats"');
  });
});

describe('asking waits for the role', () => {
  const HOME_PAGE = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');

  it('blocks the button, Return and every other entry into ask()', () => {
    expect(HOME_PAGE).toMatch(/const canAsk =[\s\S]{0,160}!roleResolving;/);
    expect(HOME_PAGE).toMatch(/async function ask\([\s\S]{0,400}if \(roleResolving\) return;/);
  });
});

describe('Advanced trace details for consumers', () => {
  it('offers the toggle with SQL only, and no run process', () => {
    const markup = render('consumer');
    expect(markup).toContain('Advanced trace details');
    expect(markup).not.toContain('Run process');
    expect(markup).not.toContain('Raw I/O');
  });

  it('is absent when the run generated no SQL', () => {
    expect(render('consumer', answer({ sql: '' }))).not.toContain('Advanced trace details');
  });

  it('is offered to executives the same way, SQL only', () => {
    const markup = render('executive');
    expect(markup).toContain('Advanced trace details');
    expect(markup).not.toContain('Run process');
    expect(markup).not.toContain('Raw I/O');
  });
});

describe('layout waits for the role', () => {
  const HOME_PAGE = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');
  const MONITORING = readFileSync(new URL('./MonitoringPage.tsx', import.meta.url), 'utf8');

  it('draws no answer while the role is still resolving', () => {
    expect(HOME_PAGE).toContain("const roleResolving = readerRole === 'resolving';");
    expect(HOME_PAGE).toContain('const awaitingRole = roleResolving && messages.length > 0;');
    expect(HOME_PAGE).toMatch(/!conversationLoading &&\s+!awaitingRole &&\s+messages\.map/);
  });

  it('gives the Monitoring drawer the same caveat layout', () => {
    expect(MONITORING).toMatch(/<AnswerCard[\s\S]{0,600}caveatsFirst/);
  });
});
