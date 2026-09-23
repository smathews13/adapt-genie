
import{appTable}from"./chunk-YDSOP3SS.mjs";var SLACK_INSTALLATIONS_TABLE=appTable("slack_installations");var SLACK_USER_LINKS_TABLE=appTable("slack_user_links");var SLACK_CONVERSATION_BINDINGS_TABLE=appTable("slack_conversation_bindings");var SLACK_EVENT_DEDUP_TABLE=appTable("slack_event_dedup");var SLACK_DELIVERIES_TABLE=appTable("slack_deliveries");var SLACK_SETTINGS_TABLE=appTable("slack_settings");var SLACK_STATE_DDL=[`CREATE TABLE IF NOT EXISTS ${SLACK_INSTALLATIONS_TABLE} (
     installation_id TEXT PRIMARY KEY,
     environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
     workspace_hash TEXT NOT NULL,
     registration_id TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
     bot_user_hash TEXT,
     bot_token_ref TEXT NOT NULL,
     app_token_ref TEXT NOT NULL,
     client_secret_ref TEXT,
     signing_secret_ref TEXT,
     granted_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
     granted_scopes_hash TEXT NOT NULL,
     revision BIGINT NOT NULL DEFAULT 1,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     revoked_at TIMESTAMPTZ,
     UNIQUE (environment, workspace_hash, registration_id)
   )`,`CREATE TABLE IF NOT EXISTS ${SLACK_USER_LINKS_TABLE} (
     link_id TEXT PRIMARY KEY,
     environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
     workspace_hash TEXT NOT NULL,
     slack_user_hash TEXT NOT NULL,
     owner_hash TEXT NOT NULL,
     delegated_identity_ref TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
     revision BIGINT NOT NULL DEFAULT 1,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     revoked_at TIMESTAMPTZ,
     UNIQUE (environment, workspace_hash, slack_user_hash),
     UNIQUE (environment, workspace_hash, owner_hash)
   )`,`CREATE TABLE IF NOT EXISTS ${SLACK_CONVERSATION_BINDINGS_TABLE} (
     binding_id TEXT PRIMARY KEY,
     environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
     workspace_hash TEXT NOT NULL,
     channel_hash TEXT NOT NULL,
     thread_hash TEXT NOT NULL,
     owner_hash TEXT NOT NULL,
     app_conversation_id TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
     revision BIGINT NOT NULL DEFAULT 1,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     revoked_at TIMESTAMPTZ,
     UNIQUE (environment, workspace_hash, channel_hash, thread_hash)
   )`,`CREATE TABLE IF NOT EXISTS ${SLACK_EVENT_DEDUP_TABLE} (
     environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
     workspace_hash TEXT NOT NULL,
     event_hash TEXT NOT NULL,
     event_kind TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('claimed', 'admitted', 'blocked', 'completed', 'failed')),
     run_id TEXT,
     delivery_id TEXT,
     safe_error_class TEXT,
     claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
     PRIMARY KEY (environment, workspace_hash, event_hash),
     CHECK (expires_at > claimed_at AND expires_at <= claimed_at + interval '7 days')
   )`,`CREATE INDEX IF NOT EXISTS slack_event_dedup_expires_idx
     ON ${SLACK_EVENT_DEDUP_TABLE} (expires_at)`,`CREATE TABLE IF NOT EXISTS ${SLACK_DELIVERIES_TABLE} (
     delivery_id TEXT PRIMARY KEY,
     environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
     workspace_hash TEXT NOT NULL,
     event_hash TEXT NOT NULL,
     channel_hash TEXT NOT NULL,
     thread_hash TEXT NOT NULL,
     user_hash TEXT NOT NULL,
     run_id TEXT NOT NULL,
     message_id TEXT,
     status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'revoked')),
     safe_error_class TEXT,
     attempt_count INTEGER NOT NULL DEFAULT 0,
     revision BIGINT NOT NULL DEFAULT 1,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     sent_at TIMESTAMPTZ,
     UNIQUE (environment, workspace_hash, event_hash),
     UNIQUE (environment, workspace_hash, message_id)
   )`];var SLACK_SETTINGS_DDL=`CREATE TABLE IF NOT EXISTS ${SLACK_SETTINGS_TABLE} (
  id TEXT PRIMARY KEY,
  settings JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL
)`;var SLACK_RENDER_DELIVERY_MIGRATION_DDL=[`ALTER TABLE ${SLACK_USER_LINKS_TABLE}
     ADD COLUMN IF NOT EXISTS token_ref_provider TEXT,
     ADD COLUMN IF NOT EXISTS token_ref_fingerprint TEXT,
     ADD COLUMN IF NOT EXISTS databricks_subject_fingerprint TEXT,
     ADD COLUMN IF NOT EXISTS databricks_workspace TEXT,
     ADD COLUMN IF NOT EXISTS databricks_audience TEXT,
     ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,`ALTER TABLE IF EXISTS ${SLACK_DELIVERIES_TABLE}
     ALTER COLUMN run_id DROP NOT NULL`,`ALTER TABLE ${SLACK_DELIVERIES_TABLE}
     ADD COLUMN IF NOT EXISTS delivery_kind TEXT NOT NULL DEFAULT 'run'
       CHECK (delivery_kind IN ('run', 'blocked', 'link_out')),
     ADD COLUMN IF NOT EXISTS delivery_state TEXT NOT NULL DEFAULT 'pending'
       CHECK (delivery_state IN ('pending', 'progress_sent', 'final_sent', 'transient_failed', 'permanent_failed'))`];export{SLACK_INSTALLATIONS_TABLE,SLACK_USER_LINKS_TABLE,SLACK_CONVERSATION_BINDINGS_TABLE,SLACK_EVENT_DEDUP_TABLE,SLACK_DELIVERIES_TABLE,SLACK_SETTINGS_TABLE,SLACK_STATE_DDL,SLACK_SETTINGS_DDL,SLACK_RENDER_DELIVERY_MIGRATION_DDL};
