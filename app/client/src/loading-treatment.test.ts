import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('application loading treatment', () => {
  it('uses ADAPT loaders instead of generic spinning circles at product call sites', () => {
    const files = [
      './HomePage.tsx',
      './EvalFlywheel.tsx',
      './BenchmarkLab.tsx',
      './OpsLoadingState.tsx',
      './OpsPage.tsx',
      './ForecastingPanel.tsx',
      './MonitoringPage.tsx',
      './UserRoleEditor.tsx',
      './AdminListEditor.tsx',
      './ResourceTagsPanel.tsx',
      './DeclaredConnectionsCard.tsx',
      './ConnectionsPage.tsx',
      './UnityCatalogScopeExplorer.tsx',
      './AssetPicker.tsx',
      './AiGatewayConnection.tsx',
      './ArchitecturePage.tsx',
      './OpsScopeModal.tsx',
      './LakebaseBindingManager.tsx',
      './LakebaseMigrationPanel.tsx',
      './FeedbackBrowserPanel.tsx',
      './EnvironmentPanel.tsx',
      './EgressPanel.tsx',
      './WatchlistSettingsPanel.tsx',
      './AskStartersSettingsPanel.tsx',
    ];

    for (const file of files) {
      const contents = source(file);
      expect(contents, file).not.toContain('Loader2');
      expect(contents, file).not.toContain('animate-spin');
      expect(contents, file).not.toContain('<ConceptFlicker');
      expect(contents, file).not.toContain('AstrolabeLoadingLabel');
    }

    expect(source('./OpsLoadingState.tsx')).toContain('<AdaptLoader variant="panel"');
    expect(source('./HomePage.tsx')).toContain('className="attachment-progress-loader"');
    expect(source('./EvalFlywheel.tsx')).toContain('<AdaptBusyButtonContent');
    expect(source('./BenchmarkLab.tsx')).toContain('<AdaptLoader variant="inline" label="Run in progress"');
  });

  it('renders a branded Preparing answer header for follow-up runs', () => {
    const home = source('./HomePage.tsx');
    expect(home).toMatch(
      /workingSeat === 'splash'[\s\S]*?<AdaptLoadingAnimation[\s\S]*?:\s*\(\s*<AdaptLoader[\s\S]*?label=\{WORKING_STAGE_LABEL\}/
    );
    expect(home).toContain('className="answer-preparing-header"');
  });

  it('shows the approved plan’s original question and the approval event', () => {
    const home = source('./HomePage.tsx');
    expect(home).toContain("previousResponse?.type === 'plan'");
    expect(home).toContain('content: `${previousResponse.plan.question}\\n\\n${PLAN_APPROVAL_LABEL}`');
    expect(home).toContain('message.content === PLAN_APPROVAL_LABEL');
  });
});
