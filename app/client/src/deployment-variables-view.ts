export interface DeploymentVariable {
  scope: 'release' | 'slack_connection';
  name: string;
  value: string;
  source: 'release' | 'recovered' | 'admin' | 'migrated';
  revision: number;
  updatedBy: string;
  updatedAt: string;
}

const SOURCE_LABELS: Record<DeploymentVariable['source'], string> = {
  release: 'Bundle release',
  recovered: 'Recovered from the app',
  admin: 'Saved in Settings',
  migrated: 'Copied from earlier storage',
};

export function deploymentVariableSourceLabel(source: string): string {
  return SOURCE_LABELS[source as DeploymentVariable['source']] ?? source;
}

/** Release values first, then the Slack connection, each alphabetical. */
export function sortedDeploymentVariables(rows: readonly DeploymentVariable[]): DeploymentVariable[] {
  return [...rows].sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
}
