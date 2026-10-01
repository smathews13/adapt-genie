
import{SlackLinkIntentMetadataSchema}from"./chunk-DXMLGV2M.mjs";import{SLACK_LINK_INTENTS_TABLE}from"./chunk-ASDKFOQ5.mjs";import"./chunk-DDLERORI.mjs";import"./chunk-YDSOP3SS.mjs";import"./chunk-A7SHUGSC.mjs";var QUALIFIED_POSTGRES_IDENTIFIER=/^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*$/;function safeTableName(tableName){const value=tableName.trim();if(!QUALIFIED_POSTGRES_IDENTIFIER.test(value)){throw new Error("Slack link-intent table name is invalid.")}return value}function text(row,key){const value=row[key];if(value instanceof Date)return value.toISOString();return typeof value==="string"?value:""}function intentFromRow(row){return SlackLinkIntentMetadataSchema.parse({id:text(row,"intent_id"),state:text(row,"state"),nonce:text(row,"nonce"),slackTeamId:text(row,"slack_team_id"),slackUserId:text(row,"slack_user_id"),databricksWorkspace:text(row,"databricks_workspace"),databricksAudience:text(row,"databricks_audience"),redirectUri:text(row,"redirect_uri"),verifierReference:{id:text(row,"verifier_ref_id"),provider:text(row,"verifier_ref_provider"),fingerprint:text(row,"verifier_ref_fingerprint")},createdAt:text(row,"created_at"),expiresAt:text(row,"expires_at")})}var RETURNING_COLUMNS=`intent_id, state, nonce, slack_team_id, slack_user_id,
       databricks_workspace, databricks_audience, redirect_uri,
       verifier_ref_id, verifier_ref_provider, verifier_ref_fingerprint,
       created_at, expires_at`;var LakebaseDurableSlackLinkIntentStore=class{#database;#tableName;constructor(database,tableName=SLACK_LINK_INTENTS_TABLE){this.#database=database;this.#tableName=safeTableName(tableName)}async put(intent){const value=SlackLinkIntentMetadataSchema.parse(intent);const result=await this.#database.query(`INSERT INTO ${this.#tableName}
         (intent_id, state, nonce, slack_team_id, slack_user_id,
          databricks_workspace, databricks_audience, redirect_uri,
          verifier_ref_id, verifier_ref_provider, verifier_ref_fingerprint,
          created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT DO NOTHING
       RETURNING intent_id`,[value.id,value.state,value.nonce,value.slackTeamId,value.slackUserId,value.databricksWorkspace,value.databricksAudience,value.redirectUri,value.verifierReference.id,value.verifierReference.provider,value.verifierReference.fingerprint,value.createdAt,value.expiresAt]);if(result.rows.length!==1){throw new Error("Slack link intent could not be stored.")}}async readByState(state){if(!state.trim())return null;const result=await this.#database.query(`SELECT ${RETURNING_COLUMNS}
         FROM ${this.#tableName}
        WHERE state = $1
        LIMIT 1`,[state]);return result.rows[0]?intentFromRow(result.rows[0]):null}async take(id){if(!id.trim())return null;const result=await this.#database.query(`DELETE FROM ${this.#tableName}
        WHERE intent_id = $1
        RETURNING ${RETURNING_COLUMNS}`,[id]);return result.rows[0]?intentFromRow(result.rows[0]):null}async takeByState(state){if(!state.trim())return null;const result=await this.#database.query(`DELETE FROM ${this.#tableName}
        WHERE state = $1
        RETURNING ${RETURNING_COLUMNS}`,[state]);return result.rows[0]?intentFromRow(result.rows[0]):null}};export{LakebaseDurableSlackLinkIntentStore};
