export interface EnvironmentVariable {
  key: string;
  value: string;
}

export interface EnvironmentPackage {
  name: string;
  version: string;
}

export interface EnvironmentServicePrincipal {
  displayName: string;
  applicationId: string;
  objectId: string;
  workspaceHost: string;
}

export interface EnvironmentInfo {
  runtime: {
    python: string;
    node: string;
  };
  variables: EnvironmentVariable[];
  packages: EnvironmentPackage[];
  appServicePrincipal?: EnvironmentServicePrincipal;
}
