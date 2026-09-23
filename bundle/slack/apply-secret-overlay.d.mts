export interface SlackSecretOverlaySources {
  databricks: string;
  appResource: string;
  appYaml: string;
  overlay: unknown;
}

export interface SlackSecretOverlayResult {
  databricks: string;
  appResource: string;
  appYaml: string;
}

export function renderSlackSecretOverlay(
  sources: SlackSecretOverlaySources,
): SlackSecretOverlayResult;
