#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_TARGET_VALUES = [
  "slack_adapter_environment",
  "slack_adapter_enabled",
  "slack_adapter_kill_switch",
  "slack_adapter_allowed_team_id",
  "slack_adapter_test_registration_id",
  "slack_adapter_production_registration_id",
  "slack_adapter_databricks_workspace",
  "slack_adapter_oauth_expected_audience",
  "slack_adapter_oauth_client_id",
  "slack_adapter_oauth_callback_url",
  "slack_adapter_public_base_url",
  "slack_adapter_token_broker_ref",
  "slack_adapter_global_concurrency",
  "slack_adapter_workspace_concurrency",
  "slack_adapter_user_concurrency",
  "slack_adapter_conversation_concurrency",
  "slack_adapter_global_per_minute",
  "slack_adapter_workspace_per_minute",
  "slack_adapter_user_per_minute",
  "slack_adapter_conversation_per_minute",
  "slack_secret_scope",
  "slack_app_token_secret_key",
  "slack_bot_token_secret_key",
  "slack_client_secret_key",
  "slack_signing_secret_key",
];

const SECRET_RESOURCES = [
  "slack-app-token",
  "slack-bot-token",
  "slack-client-secret",
  "slack-signing-secret",
];

async function text(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function json(file) {
  const source = await text(file);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function valueFromOverride(entry) {
  if (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    "value" in entry
  )
    return entry.value;
  return entry;
}

function supplied(value) {
  return typeof value === "string"
    ? value.trim() !== ""
    : value !== null && value !== undefined;
}

export async function slackRolloutFindings({ root, target, evidencePath }) {
  const findings = [];
  const [
    appResource,
    appYaml,
    serverSource,
    socketRuntime,
    messageRuntime,
    evidence,
    overrides,
  ] = await Promise.all([
    text(path.join(root, "resources", "adapt_app.app.yml")),
    text(path.join(root, "app", "app.yaml")),
    text(path.join(root, "app", "server", "server.ts")),
    text(
      path.join(
        root,
        "app",
        "server",
        "slack",
        "socket-mode-adapter.ts",
      ),
    ),
    text(
      path.join(
        root,
        "app",
        "server",
        "slack",
        "message-client.ts",
      ),
    ),
    json(evidencePath),
    json(
      path.join(
        root,
        ".databricks",
        "bundle",
        target,
        "variable-overrides.json",
      ),
    ),
  ]);

  for (const resource of SECRET_RESOURCES) {
    if (
      !appResource.includes(`- name: ${resource}`) ||
      !appYaml.includes(`valueFrom: ${resource}`)
    ) {
      findings.push(`overlay binding missing: ${resource}`);
    }
  }
  const runtime = `${socketRuntime}\n${messageRuntime}`;
  if (
    /@slack\/(?:bolt|socket-mode|web-api)|\bundici\b|receiver/i.test(runtime)
  ) {
    findings.push(
      "scanner-blocked Slack packages, Undici, and receivers cannot enter runtime source",
    );
  }
  if (
    !socketRuntime.includes("apps.connections.open") ||
    !messageRuntime.includes("chat.postMessage")
  ) {
    findings.push(
      "reviewed native Socket Mode/Web API protocol runtime is required",
    );
  }
  if (serverSource.includes("brokerAvailable: () => false"))
    findings.push("production token broker is not injected");
  if (serverSource.includes("setupSlackOAuthRoutes(appkit);")) {
    findings.push("durable verifier store and link writer are not injected");
  }

  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    findings.push("review evidence file is missing or invalid");
  } else {
    for (const key of [
      "esiTicket",
      "changeTicket",
      "brokerImplementation",
      "verifierStoreImplementation",
      "linkWriterImplementation",
      "protocolSecurityReview",
      "securityOwner",
      "incidentOwner",
    ]) {
      const value = evidence[key];
      if (!supplied(value) || /^REQUIRED\b/i.test(String(value).trim()))
        findings.push(`review evidence missing: ${key}`);
    }
    if (evidence.egressApproved !== true)
      findings.push("Slack message egress approval is required");
    if (evidence.overlayReviewed !== true)
      findings.push("secret overlay review approval is required");
  }

  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    findings.push(
      `target override is missing: .databricks/bundle/${target}/variable-overrides.json`,
    );
  } else {
    for (const key of REQUIRED_TARGET_VALUES) {
      const value = valueFromOverride(overrides[key]);
      if (!supplied(value)) findings.push(`target value missing: ${key}`);
    }
    if (
      String(valueFromOverride(overrides.slack_adapter_enabled)).trim() !==
      "true"
    ) {
      findings.push("slack_adapter_enabled must be true");
    }
    if (
      String(valueFromOverride(overrides.slack_adapter_kill_switch)).trim() !==
      "false"
    ) {
      findings.push(
        "slack_adapter_kill_switch must be false for the approved activation window",
      );
    }
  }
  return findings;
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const at = args.indexOf(flag);
    return at >= 0 ? (args[at + 1] ?? "") : "";
  };
  const root = path.resolve(value("--root") || ".");
  const target = value("--target");
  const evidencePath = path.resolve(value("--evidence") || "");
  if (!target || !value("--evidence")) {
    throw new Error(
      "usage: check-rollout.mjs --root <private-overlay-worktree> --target <target> --evidence <file>",
    );
  }
  const findings = await slackRolloutFindings({ root, target, evidencePath });
  if (findings.length > 0) {
    console.error("Slack rollout refused:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log("Slack rollout prerequisites: approved and present.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Slack rollout check failed",
    );
    process.exit(2);
  });
}
