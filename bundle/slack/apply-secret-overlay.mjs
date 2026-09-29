#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  envNames,
  renderDeployAppYaml,
} from "../../app/scripts/deploy-app-yaml.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const overlayPath = path.join(here, "secret-bindings.overlay.json");
const SECRET_RESOURCE_NAMES = [
  "slack-app-token",
  "slack-bot-token",
  "slack-client-secret",
  "slack-signing-secret",
];

function insertOnce(source, anchor, insertion, label) {
  const at = source.indexOf(anchor);
  if (at < 0 || source.indexOf(anchor, at + anchor.length) >= 0) {
    throw new Error(`${label}: expected exactly one merge anchor`);
  }
  return `${source.slice(0, at)}${insertion}${source.slice(at)}`;
}

function assertDefaultIsUnbound({ databricks, appResource, appYaml }) {
  for (const name of SECRET_RESOURCE_NAMES) {
    if (
      appResource.includes(`- name: ${name}`) ||
      appYaml.includes(`valueFrom: ${name}`)
    ) {
      throw new Error(
        `default source already contains Slack secret binding ${name}`,
      );
    }
  }
  if (
    /^\s{2}slack_(?:secret_scope|(?:app|bot)_token_secret_key|client_secret_key|signing_secret_key):/m.test(
      databricks,
    )
  ) {
    throw new Error(
      "default databricks.yml already declares Slack secret overlay variables",
    );
  }
}

function bundleVariableYaml(overlay) {
  return `${Object.entries(overlay.bundleVariables)
    .map(
      ([name, definition]) =>
        `  ${name}:\n    description: >-\n      ${definition.description}\n`,
    )
    .join("")}\n`;
}

function appResourceYaml(overlay) {
  return `${overlay.appResources
    .map(
      (resource) =>
        `        - name: ${resource.name}\n` +
        `          secret:\n` +
        `            scope: \${var.${resource.scopeVariable}}\n` +
        `            key: \${var.${resource.keyVariable}}\n` +
        `            permission: READ\n`,
    )
    .join("")}\n`;
}

export function renderSlackSecretOverlay({
  databricks,
  appResource,
  appYaml,
  overlay,
}) {
  if (overlay.schemaVersion !== 1)
    throw new Error("unsupported Slack secret overlay schema");
  assertDefaultIsUnbound({ databricks, appResource, appYaml });
  const mergedDatabricks = insertOnce(
    databricks,
    "  # Lakebase\n",
    bundleVariableYaml(overlay),
    "databricks.yml",
  );
  const mergedResource = insertOnce(
    appResource,
    "      lifecycle:\n",
    appResourceYaml(overlay),
    "resources/adapt_app.app.yml",
  );
  const neutralComment =
    "  # Secret variables and valueFrom bindings are deliberately absent. Enabling\n" +
    "  # Slack requires the reviewed private-deployment overlay in bundle/slack/.\n";
  if (!appYaml.includes(neutralComment))
    throw new Error("app.yaml: missing default-unbound marker");
  const mergedAppYaml = renderDeployAppYaml(
    appYaml.replace(neutralComment, ""),
    {
      env: overlay.appEnv.flatMap((entry) => [
        { name: entry.name, valueFrom: entry.valueFrom },
        { name: entry.referenceName, value: `'${entry.name}'` },
      ]),
    },
  );
  const names = envNames(mergedAppYaml);
  for (const entry of overlay.appEnv) {
    if (!names.includes(entry.name) || !names.includes(entry.referenceName)) {
      throw new Error(`app.yaml: overlay failed to add ${entry.name}`);
    }
  }
  return {
    databricks: mergedDatabricks,
    appResource: mergedResource,
    appYaml: mergedAppYaml,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const rootAt = args.indexOf("--root");
  const root = rootAt >= 0 ? path.resolve(args[rootAt + 1] ?? "") : "";
  const check = args.includes("--check");
  const approved = args.includes("--approved");
  if (!root)
    throw new Error(
      "usage: apply-secret-overlay.mjs --root <isolated-private-worktree> [--check|--approved]",
    );
  if (!check && !approved)
    throw new Error("refusing to apply without --approved");

  const files = {
    databricks: path.join(root, "databricks.yml"),
    appResource: path.join(root, "resources", "adapt_app.app.yml"),
    appYaml: path.join(root, "app", "app.yaml"),
  };
  const overlay = JSON.parse(await readFile(overlayPath, "utf8"));
  const merged = renderSlackSecretOverlay({
    databricks: await readFile(files.databricks, "utf8"),
    appResource: await readFile(files.appResource, "utf8"),
    appYaml: await readFile(files.appYaml, "utf8"),
    overlay,
  });
  if (check) {
    console.log("Slack secret overlay merge check: ok (no files changed)");
    return;
  }
  await Promise.all([
    writeFile(files.databricks, merged.databricks),
    writeFile(files.appResource, merged.appResource),
    writeFile(files.appYaml, merged.appYaml),
  ]);
  console.log(
    "Slack secret overlay applied to the isolated private deployment worktree.",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Slack overlay failed",
    );
    process.exit(1);
  });
}
