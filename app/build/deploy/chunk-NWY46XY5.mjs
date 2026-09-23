
import{SLACK_CONVERSATION_BINDINGS_TABLE,SLACK_DELIVERIES_TABLE,SLACK_EVENT_DEDUP_TABLE,SLACK_INSTALLATIONS_TABLE,SLACK_USER_LINKS_TABLE}from"./chunk-CEUYMJTW.mjs";import crypto from"node:crypto";async function readSlackInstallation(store,scope){const result=await store.query(`SELECT installation_id, environment, workspace_hash, registration_id, status, bot_user_hash,
            bot_token_ref, app_token_ref, client_secret_ref, signing_secret_ref,
            granted_scopes, granted_scopes_hash, revision
       FROM ${SLACK_INSTALLATIONS_TABLE}
      WHERE environment = $1 AND workspace_hash = $2 AND status = 'active'
      LIMIT 1`,[scope.environment,scope.workspaceHash]);return result.rows[0]?installationFrom(result.rows[0]):null}function text(row,key){const value=row[key];return typeof value==="string"?value:typeof value==="number"||typeof value==="boolean"?String(value):""}function nullableText(row,key){const value=row[key];if(value===null||value===void 0||value==="")return null;return typeof value==="string"?value:typeof value==="number"||typeof value==="boolean"?String(value):null}function revision(row){return Number(row.revision)}function stringArray(value){return Array.isArray(value)?value.filter(entry=>typeof entry==="string"):[]}function installationFrom(row){return{installationId:text(row,"installation_id"),environment:text(row,"environment"),workspaceHash:text(row,"workspace_hash"),registrationId:text(row,"registration_id"),status:text(row,"status"),botUserHash:nullableText(row,"bot_user_hash"),botTokenRef:text(row,"bot_token_ref"),appTokenRef:text(row,"app_token_ref"),clientSecretRef:nullableText(row,"client_secret_ref"),signingSecretRef:nullableText(row,"signing_secret_ref"),grantedScopes:stringArray(row.granted_scopes),grantedScopesHash:text(row,"granted_scopes_hash"),revision:revision(row)}}function timestamp(row,key){const value=row[key];return value instanceof Date?value.toISOString():text(row,key)}function linkFrom(row){return{linkId:text(row,"link_id"),environment:text(row,"environment"),workspaceHash:text(row,"workspace_hash"),slackUserHash:text(row,"slack_user_hash"),ownerHash:text(row,"owner_hash"),delegatedIdentityRef:text(row,"delegated_identity_ref"),tokenRefProvider:text(row,"token_ref_provider"),tokenRefFingerprint:text(row,"token_ref_fingerprint"),databricksSubjectFingerprint:text(row,"databricks_subject_fingerprint"),databricksWorkspace:text(row,"databricks_workspace"),databricksAudience:text(row,"databricks_audience"),status:text(row,"status"),createdAt:timestamp(row,"created_at"),updatedAt:timestamp(row,"updated_at"),expiresAt:nullableText(row,"expires_at"),revokedAt:nullableText(row,"revoked_at"),revision:revision(row)}}async function readSlackUserLink(store,scope){const result=await store.query(`SELECT link_id, environment, workspace_hash, slack_user_hash, owner_hash,
            delegated_identity_ref, token_ref_provider, token_ref_fingerprint,
            databricks_subject_fingerprint, databricks_workspace, databricks_audience,
            status, created_at, updated_at, expires_at, revoked_at, revision
       FROM ${SLACK_USER_LINKS_TABLE}
      WHERE environment = $1 AND workspace_hash = $2 AND slack_user_hash = $3
        AND ($4::text IS NULL OR owner_hash = $4) AND status = 'active'`,[scope.environment,scope.workspaceHash,scope.slackUserHash,scope.ownerHash??null]);return result.rows[0]?linkFrom(result.rows[0]):null}function bindingFrom(row){return{bindingId:text(row,"binding_id"),environment:text(row,"environment"),workspaceHash:text(row,"workspace_hash"),channelHash:text(row,"channel_hash"),threadHash:text(row,"thread_hash"),ownerHash:text(row,"owner_hash"),appConversationId:text(row,"app_conversation_id"),status:text(row,"status"),revision:revision(row)}}async function resolveOrCreateSlackConversationBinding(store,input){const result=await store.query(`INSERT INTO ${SLACK_CONVERSATION_BINDINGS_TABLE}
       (binding_id, environment, workspace_hash, channel_hash, thread_hash, owner_hash, app_conversation_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
     ON CONFLICT (environment, workspace_hash, channel_hash, thread_hash)
     DO UPDATE SET updated_at = ${SLACK_CONVERSATION_BINDINGS_TABLE}.updated_at
       WHERE ${SLACK_CONVERSATION_BINDINGS_TABLE}.owner_hash = EXCLUDED.owner_hash
         AND ${SLACK_CONVERSATION_BINDINGS_TABLE}.status = 'active'
     RETURNING binding_id, environment, workspace_hash, channel_hash, thread_hash, owner_hash,
               app_conversation_id, status, revision, (xmax = 0) AS created`,[input.bindingId??crypto.randomUUID(),input.environment,input.workspaceHash,input.channelHash,input.threadHash,input.ownerHash,input.appConversationId]);const row=result.rows[0];if(!row)return{outcome:"conflict"};return{outcome:row.created===true||row.created==="true"?"created":"updated",value:bindingFrom(row)}}var SLACK_EVENT_DEDUP_DEFAULT_TTL_MS=24*60*60*1e3;var SLACK_EVENT_DEDUP_MAX_TTL_MS=7*24*60*60*1e3;async function claimSlackEvent(store,input){const claimedAt=input.now??new Date;const ttlMs=Math.min(SLACK_EVENT_DEDUP_MAX_TTL_MS,Math.max(6e4,input.ttlMs??SLACK_EVENT_DEDUP_DEFAULT_TTL_MS));const expiresAt=new Date(claimedAt.getTime()+ttlMs);const result=await store.query(`INSERT INTO ${SLACK_EVENT_DEDUP_TABLE}
       (environment, workspace_hash, event_hash, event_kind, status, claimed_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, 'claimed', $5, $5, $6)
     ON CONFLICT (environment, workspace_hash, event_hash)
     DO UPDATE SET
       event_kind = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                         THEN EXCLUDED.event_kind ELSE ${SLACK_EVENT_DEDUP_TABLE}.event_kind END,
       status = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                     THEN 'claimed' ELSE ${SLACK_EVENT_DEDUP_TABLE}.status END,
       run_id = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                     THEN NULL ELSE ${SLACK_EVENT_DEDUP_TABLE}.run_id END,
       delivery_id = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                          THEN NULL ELSE ${SLACK_EVENT_DEDUP_TABLE}.delivery_id END,
       safe_error_class = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                               THEN NULL ELSE ${SLACK_EVENT_DEDUP_TABLE}.safe_error_class END,
       claimed_at = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                         THEN $5 ELSE ${SLACK_EVENT_DEDUP_TABLE}.claimed_at END,
       updated_at = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                         THEN $5 ELSE ${SLACK_EVENT_DEDUP_TABLE}.updated_at END,
       expires_at = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                         THEN $6 ELSE ${SLACK_EVENT_DEDUP_TABLE}.expires_at END
     RETURNING status, run_id, delivery_id, expires_at,
               ((xmax = 0) OR claimed_at = $5) AS claimed`,[input.environment,input.workspaceHash,input.eventHash,input.eventKind,claimedAt,expiresAt]);const row=result.rows[0];if(!row)throw new Error("Slack dedup claim returned no row.");return{claimed:row.claimed===true||row.claimed==="true",status:text(row,"status"),runId:nullableText(row,"run_id"),deliveryId:nullableText(row,"delivery_id"),expiresAt:row.expires_at instanceof Date?row.expires_at.toISOString():text(row,"expires_at")}}async function updateSlackEventClaim(store,input){const result=await store.query(`UPDATE ${SLACK_EVENT_DEDUP_TABLE}
        SET status = $4, run_id = COALESCE(run_id, $5), delivery_id = COALESCE(delivery_id, $6),
            safe_error_class = $7, updated_at = now()
      WHERE environment = $1 AND workspace_hash = $2 AND event_hash = $3
      RETURNING event_hash`,[input.environment,input.workspaceHash,input.eventHash,input.status,input.runId,input.deliveryId,input.safeErrorClass??null]);return result.rows.length===1}function deliveryFrom(row){return{deliveryId:text(row,"delivery_id"),runId:nullableText(row,"run_id"),channelHash:text(row,"channel_hash"),threadHash:text(row,"thread_hash"),status:text(row,"status"),deliveryKind:text(row,"delivery_kind"),deliveryState:text(row,"delivery_state"),safeErrorClass:nullableText(row,"safe_error_class"),messageId:nullableText(row,"message_id"),attemptCount:Number(row.attempt_count),revision:revision(row)}}async function readSlackDeliveryForEvent(store,scope){const result=await store.query(`SELECT delivery_id, run_id, channel_hash, thread_hash, status, delivery_kind, delivery_state,
            safe_error_class, message_id, attempt_count, revision
       FROM ${SLACK_DELIVERIES_TABLE}
      WHERE environment = $1 AND workspace_hash = $2 AND event_hash = $3`,[scope.environment,scope.workspaceHash,scope.eventHash]);return result.rows[0]?deliveryFrom(result.rows[0]):null}async function createSlackDelivery(store,input){const result=await store.query(`INSERT INTO ${SLACK_DELIVERIES_TABLE}
       (delivery_id, environment, workspace_hash, event_hash, channel_hash, thread_hash, user_hash,
        run_id, status, delivery_kind, delivery_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, 'pending')
     ON CONFLICT (environment, workspace_hash, event_hash)
     DO UPDATE SET event_hash = EXCLUDED.event_hash
     RETURNING delivery_id, run_id, channel_hash, thread_hash, status, delivery_kind, delivery_state,
               safe_error_class, message_id, attempt_count, revision, (xmax = 0) AS created`,[input.deliveryId??crypto.randomUUID(),input.environment,input.workspaceHash,input.eventHash,input.channelHash,input.threadHash,input.userHash,input.runId,input.deliveryKind??"run"]);const row=result.rows[0];if(!row)throw new Error("Slack delivery insert returned no row.");return{outcome:row.created===true||row.created==="true"?"created":"existing",value:deliveryFrom(row)}}async function recordSlackDeliveryAttempt(store,input){const deliveryState=input.deliveryState??(input.status==="sent"?"final_sent":"permanent_failed");const coherent=input.status==="sent"&&deliveryState==="final_sent"||input.status==="failed"&&(deliveryState==="transient_failed"||deliveryState==="permanent_failed")||input.status==="revoked"&&deliveryState==="permanent_failed";if(!coherent)throw new Error("Slack delivery status and delivery_state are inconsistent.");const result=await store.query(`UPDATE ${SLACK_DELIVERIES_TABLE}
        SET status = $4,
            message_id = COALESCE(message_id, $5),
            safe_error_class = $6,
            delivery_state = $7,
            delivery_kind = COALESCE($8, delivery_kind),
            attempt_count = attempt_count + 1,
            revision = revision + 1,
            updated_at = now(),
            sent_at = CASE WHEN $4 = 'sent' THEN now() ELSE sent_at END
      WHERE delivery_id = $1 AND run_id IS NOT DISTINCT FROM $2 AND revision = $3
      RETURNING delivery_id, run_id, channel_hash, thread_hash, status, delivery_kind, delivery_state,
                safe_error_class, message_id, attempt_count, revision`,[input.deliveryId,input.runId,input.revision,input.status,input.messageId??null,input.safeErrorClass??null,deliveryState,input.deliveryKind??null]);const row=result.rows[0];return row?{outcome:"updated",value:deliveryFrom(row)}:{outcome:"conflict"}}async function recordSlackDeliveryProgress(store,input){const result=await store.query(`UPDATE ${SLACK_DELIVERIES_TABLE}
        SET delivery_state = 'progress_sent', updated_at = now(), revision = revision + 1
      WHERE delivery_id = $1 AND run_id = $2 AND revision = $3 AND delivery_state = 'pending'
      RETURNING delivery_id, run_id, channel_hash, thread_hash, status, delivery_kind, delivery_state,
                safe_error_class, message_id, attempt_count, revision`,[input.deliveryId,input.runId,input.revision]);const row=result.rows[0];return row?{outcome:"updated",value:deliveryFrom(row)}:{outcome:"conflict"}}export{readSlackInstallation,readSlackUserLink,resolveOrCreateSlackConversationBinding,claimSlackEvent,updateSlackEventClaim,readSlackDeliveryForEvent,createSlackDelivery,recordSlackDeliveryAttempt,recordSlackDeliveryProgress};
