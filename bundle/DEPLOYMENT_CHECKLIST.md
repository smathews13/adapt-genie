# ADAPT deployment checklist

Every value below is required unless marked optional. Put workspace-specific
values in `.databricks/bundle/<target>/variable-overrides.json`, never in git.

## Bundle variables

| Variable | What it is |
|---|---|
| `app_catalog` | Unity Catalog catalog this deployment owns |
| `app_schema` | Existing schema for the registered model |
| `data_catalogs` | Complete read scope (catalog or catalog.schema names) |
| `warehouse_id` | Existing SQL warehouse Genie and the agent use |
| `genie_data_space_id` | Existing Genie space the agent asks |
| `watchlist_table` | Steam sales table for watchlist KPIs |
| `admin_emails` | Comma-separated app administrators |
| `app_name` | Databricks App name (default `adapt-genie`) |
| `serving_endpoint_name` | Model Serving endpoint (default `adapt-orchestrator`) |
| `execution_identity` | Must match the logged model (`user-authorization` for OBO) |
| `app_admin_group` / `app_user_group` | Workspace groups for CAN_MANAGE / CAN_USE |
| `genie_mcp_secret_scope` / `genie_mcp_secret_key` | Ed25519 signing material |
| `catalog_denylist` | Optional glob list of tables the agent must not declare |

## Secrets

- Genie MCP private key: created by `bundle/genie-mcp-signing-key.sh`. Never commit it.
- Databricks CLI profile for the target workspace. Deploy fails closed if OBO token forwarding is missing (`bundle/model-user-auth-check.py`).

## Unity Catalog grants

- App service principal: use of the warehouse, invoke of the serving endpoint, Lakebase.
- Signed-in users: SELECT on every table in `data_catalogs` that the Genie space curates.
- Re-log after changing `data_catalogs`, the Genie space, or `execution_identity`.

## Workspace groups

- `app_admin_group` mapped to the admin role floor.
- `app_user_group` mapped to consumers.

## Genie space

- One existing space, named by id. Curate it in the UI. The model fingerprint must match at release (`bundle/genie-fingerprint-check.py`).

## Lakebase pool sizing

AppKit defaults (`PLAYER_INSIGHTS_DB_POOL_MAX=10`, idle 30s, connect 10s). Raise max only under measured pool wait. Statement timeout is a session setting (`PLAYER_INSIGHTS_DB_STATEMENT_TIMEOUT_MS`), not a pool field AppKit would silently drop.

## Release order

1. `bundle/plan-gate.sh` then `bundle deploy`
2. `bundle/agent-release.sh --apply`
3. `bundle/app-release.sh --apply`

## Auth-chain proof

`agent/tests/verify_identity_live.py` is the live OBO check. Unit coverage is `agent/tests/test_execution_identity.py` and `bundle/model-user-auth-check.test.sh`.
