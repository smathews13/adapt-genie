import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REQUIRED_TARGET_VALUES,
  slackRolloutFindings,
} from "./check-rollout.mjs";

test("accepts a fully approved native protocol tree without requiring Slack packages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adapt-slack-rollout-"));
  const target = "approved";
  const evidencePath = path.join(root, "evidence.json");
  try {
    await Promise.all([
      mkdir(path.join(root, "resources"), { recursive: true }),
      mkdir(path.join(root, "app", "server", "slack"), {
        recursive: true,
      }),
      mkdir(path.join(root, ".databricks", "bundle", target), {
        recursive: true,
      }),
    ]);
    const resources = [
      "slack-app-token",
      "slack-bot-token",
      "slack-client-secret",
      "slack-signing-secret",
    ];
    await Promise.all([
      writeFile(
        path.join(root, "resources", "adapt_app.app.yml"),
        resources.map((name) => `- name: ${name}`).join("\n"),
      ),
      writeFile(
        path.join(root, "app", "app.yaml"),
        resources.map((name) => `valueFrom: ${name}`).join("\n"),
      ),
      writeFile(
        path.join(root, "app", "server", "server.ts"),
        "approved runtime injections",
      ),
      writeFile(
        path.join(
          root,
          "app",
          "server",
          "slack",
          "socket-mode-adapter.ts",
        ),
        "const endpoint = 'apps.connections.open';",
      ),
      writeFile(
        path.join(
          root,
          "app",
          "server",
          "slack",
          "message-client.ts",
        ),
        "const endpoint = 'chat.postMessage';",
      ),
      writeFile(
        evidencePath,
        JSON.stringify({
          esiTicket: "ESI-123",
          changeTicket: "CHANGE-123",
          egressApproved: true,
          overlayReviewed: true,
          brokerImplementation: "broker-v1",
          verifierStoreImplementation: "verifier-v1",
          linkWriterImplementation: "writer-v1",
          protocolSecurityReview: "SECURITY-REVIEW-123",
          securityOwner: "security-owner",
          incidentOwner: "incident-owner",
        }),
      ),
      writeFile(
        path.join(
          root,
          ".databricks",
          "bundle",
          target,
          "variable-overrides.json",
        ),
        JSON.stringify(
          Object.fromEntries(
            REQUIRED_TARGET_VALUES.map((name) => [
              name,
              name === "slack_adapter_enabled"
                ? "true"
                : name === "slack_adapter_kill_switch"
                  ? "false"
                  : "reviewed-value",
            ]),
          ),
        ),
      ),
    ]);
    assert.deepEqual(
      await slackRolloutFindings({ root, target, evidencePath }),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
