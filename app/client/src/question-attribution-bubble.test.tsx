import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { QuestionAttributionBubble } from './QuestionAttributionBubble';

const source = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
const CSS = source('styles/question-attribution.css');
const ASK_CSS = source('styles/ask.css');
const DARK_CSS = source('styles/dark-mode.css');
const APPEARANCE_CSS = source('styles/appearance-preferences.css');
const ANSWER_BODY_CSS = source('styles/answer-body.css');
const MONITORING_CSS = source('styles/monitoring.css');
const SHIPPED_CSS = [CSS, ASK_CSS, DARK_CSS, APPEARANCE_CSS, ANSWER_BODY_CSS, MONITORING_CSS].join('\n');

function rule(selector: string, stylesheet = CSS): string {
  const start = stylesheet.indexOf(`${selector} {`);
  expect(start, `${selector} exists`).toBeGreaterThan(-1);
  return stylesheet.slice(start, stylesheet.indexOf('}', start));
}

describe('the shared question attribution bubble', () => {
  it('renders the question and organization attribution inside one outer surface', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <QuestionAttributionBubble
          question="How did NBA 2K26 sell through on each platform last week?"
          asker="producer@take2games.com"
          canOpenUser
        />
      </MemoryRouter>
    );

    expect((markup.match(/question-attribution-surface/g) ?? []).length).toBe(1);
    expect(markup).toContain('identity-chip-name">producer');
    expect(markup).toContain('data-organization-id="take-two-interactive"');
    expect(markup).not.toContain('Asked by');
    expect(markup).toContain('href="/monitoring?who=producer%40take2games.com"');
    expect((markup.match(/<a /g) ?? []).length).toBe(1);
  });

  it('draws one rounded surface with an integrated tail and no clipping host', () => {
    const host = rule('.question-attribution-bubble');
    const surface = rule('.question-attribution-surface');
    const hostPseudo = rule('.question-attribution-bubble::before,\n.question-attribution-bubble::after');

    expect(host).toContain('overflow: visible');
    expect(host).toContain('background: transparent');
    expect(host).toContain('box-shadow: none');
    expect(hostPseudo).toContain('display: none');
    expect(hostPseudo).toContain('content: none');
    expect(surface).toContain('overflow: visible');
    expect(surface).toContain('border: 1px solid var(--ast-border-input)');
    expect(surface).toContain('border-radius: calc(var(--radius-md) * 2)');
    expect(rule('.question-attribution-surface::after')).toContain('right: 22px');
    expect(rule('.question-attribution-surface::after')).toContain('bottom: -5px');
    expect(rule('.question-attribution-message')).toContain('background: transparent');
    expect(rule('.question-attribution-meta')).toContain('border-left: 1px solid var(--ast-border-input)');
  });

  it('wraps long questions and moves attribution to a full-width phone row', () => {
    expect(CSS).toContain('@media (max-width: 480px)');
    expect(CSS).toMatch(/\.question-attribution-message\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(CSS).toMatch(
      /@media \(max-width: 480px\)[\s\S]*\.question-attribution-surface\s*\{[^}]*width:\s*100%[^}]*flex-direction:\s*column/
    );
    expect(CSS).toMatch(
      /@media \(max-width: 480px\)[\s\S]*\.question-attribution-meta\s*\{[^}]*width:\s*100%[^}]*border-top:\s*1px solid var\(--ast-border-input\)[^}]*border-left:\s*0/
    );
    expect(source('HomePage.tsx')).toContain('canOpenUser={adminSharedRail}');
    expect(source('OrganizationUserBadge.tsx')).toContain('const opensUser = canOpen &&');
  });

  it('cannot regain the retired rectangular Ask backing', () => {
    expect(source('HomePage.tsx')).not.toContain('questionClassName="user-bubble"');
    expect(SHIPPED_CSS).not.toContain('.user-bubble');
    expect(ASK_CSS).toContain('.user-message .question-attribution-message');
  });

  it('anchors active transcripts below the chrome and staggers only the wide center column', () => {
    const activeAsk = rule(".ask-layout[data-transcript='active'] .conversation-main", ASK_CSS);
    const host = rule('.user-message', ASK_CSS);
    expect(activeAsk).toContain('padding-top: var(--density-page-gap)');
    expect(host).toContain('margin-left: var(--question-stagger)');
    expect(host).toContain('margin-bottom: 22px');
    expect(host).not.toMatch(/\b(?:position|transform|top)\s*:/);
    expect(source('styles/responsive.css')).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*\.conversation-main\s*\{[^}]*--question-stagger:\s*0px/
    );
  });

  it('hosts the shared question and asker surface in Monitoring without a duplicate Asked-by row', () => {
    const monitoring = source('MonitoringPage.tsx');
    const host = rule('.monitoring-question-attribution', MONITORING_CSS);

    expect(monitoring).toMatch(/<QuestionAttributionBubble[\s\S]{0,260}questionId="monitoring-question-title"/);
    expect(monitoring).not.toContain('headerExtra={<UserIdentityChip');
    expect(host).toContain('flex: 1 1 auto');
    expect(host).toContain('justify-content: flex-end');
    expect(MONITORING_CSS).toMatch(
      /\.user-profile-modal-state-action,\s*\.user-profile-modal-profile-loading\s*\{[^}]*min-height:\s*180px/s
    );
  });
});
