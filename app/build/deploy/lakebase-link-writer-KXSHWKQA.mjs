
import{createSlackInstallation,readSlackInstallation}from"./chunk-YDEREI65.mjs";import{hashSlackIdentifier}from"./chunk-32763G2J.mjs";import{SLACK_INSTALLATIONS_TABLE,SLACK_USER_LINKS_TABLE}from"./chunk-2E4L7P5S.mjs";import"./chunk-DDLERORI.mjs";import"./chunk-YDSOP3SS.mjs";import"./chunk-A7SHUGSC.mjs";function text(row,key){const value=row[key];return typeof value==="string"?value:""}var LakebaseSlackLinkWriter=class{#store;#config;#credentials;constructor(store,config,credentials){this.#store=store;this.#config=config;this.#credentials=credentials}async write(input){if(input.actor.ownerHash!==input.exchange.ownerHash){throw new Error("Broker-proven link owner did not match the exchange.")}const workspaceHash=hashSlackIdentifier(input.intent.slackTeamId);if(workspaceHash!==this.#config.allowedTeamHash){throw new Error("Slack workspace did not match the configured installation.")}const slackUserHash=hashSlackIdentifier(input.intent.slackUserId);const previous=await this.#store.query(`SELECT owner_hash, delegated_identity_ref, token_ref_provider, token_ref_fingerprint
         FROM ${SLACK_USER_LINKS_TABLE}
        WHERE environment = $1 AND workspace_hash = $2 AND slack_user_hash = $3 AND status = 'active'
        LIMIT 1`,[this.#config.environment,workspaceHash,slackUserHash]);const prior=previous.rows[0];if(prior&&text(prior,"owner_hash")!==input.exchange.ownerHash){throw new Error("Slack user link conflicted with another verified owner.")}if(prior&&text(prior,"delegated_identity_ref")!==input.exchange.delegatedIdentityRef){await this.#credentials.revoke({id:text(prior,"delegated_identity_ref"),provider:text(prior,"token_ref_provider"),fingerprint:text(prior,"token_ref_fingerprint")})}const result=await this.#store.query(`INSERT INTO ${SLACK_USER_LINKS_TABLE}
         (link_id, environment, workspace_hash, slack_user_hash, owner_hash,
          delegated_identity_ref, token_ref_provider, token_ref_fingerprint,
          databricks_subject_fingerprint, databricks_workspace, databricks_audience,
          expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
       ON CONFLICT (environment, workspace_hash, slack_user_hash) DO UPDATE
          SET link_id = EXCLUDED.link_id,
              delegated_identity_ref = EXCLUDED.delegated_identity_ref,
              token_ref_provider = EXCLUDED.token_ref_provider,
              token_ref_fingerprint = EXCLUDED.token_ref_fingerprint,
              databricks_subject_fingerprint = EXCLUDED.databricks_subject_fingerprint,
              databricks_workspace = EXCLUDED.databricks_workspace,
              databricks_audience = EXCLUDED.databricks_audience,
              expires_at = EXCLUDED.expires_at,
              status = 'active',
              revoked_at = NULL,
              revision = ${SLACK_USER_LINKS_TABLE}.revision + 1,
              updated_at = now()
        WHERE ${SLACK_USER_LINKS_TABLE}.owner_hash = EXCLUDED.owner_hash
       RETURNING link_id`,[input.linkReference,this.#config.environment,workspaceHash,slackUserHash,input.exchange.ownerHash,input.exchange.delegatedIdentityRef,input.exchange.tokenReference.provider,input.exchange.tokenReference.fingerprint,input.exchange.databricksSubjectFingerprint,input.intent.databricksWorkspace,input.intent.databricksAudience,input.exchange.expiresAt]);if(!result.rows[0])throw new Error("Slack user link conflicted with another verified owner.")}async status(input){const result=await this.#store.query(`SELECT link_id, status
         FROM ${SLACK_USER_LINKS_TABLE}
        WHERE link_id = $1 AND environment = $2 AND workspace_hash = $3 AND owner_hash = $4
        LIMIT 1`,[input.linkReference,this.#config.environment,this.#config.allowedTeamHash,hashSlackIdentifier(input.actor.trim().toLowerCase())]);const row=result.rows[0];if(!row)return"unlinked";if(text(row,"status")==="revoked")return"revoked";const installation=await readSlackInstallation(this.#store,{environment:this.#config.environment,workspaceHash:this.#config.allowedTeamHash,registrationId:this.#config.registrationId});return installation?"linked":"uninstalled"}async revoke(input){const ownerHash=hashSlackIdentifier(input.actor.trim().toLowerCase());const result=await this.#store.query(`UPDATE ${SLACK_USER_LINKS_TABLE}
          SET status = 'revoked', revoked_at = now(), updated_at = now(), revision = revision + 1
        WHERE link_id = $1 AND environment = $2 AND workspace_hash = $3
          AND owner_hash = $4 AND status = 'active'
      RETURNING delegated_identity_ref, token_ref_provider, token_ref_fingerprint`,[input.linkReference,this.#config.environment,this.#config.allowedTeamHash,ownerHash]);const row=result.rows[0];if(!row)return"not_linked";await this.#credentials.revoke({id:text(row,"delegated_identity_ref"),provider:text(row,"token_ref_provider"),fingerprint:text(row,"token_ref_fingerprint")});return"revoked"}async uninstall(scope){if(scope.environment!==this.#config.environment||scope.workspaceHash!==this.#config.allowedTeamHash||scope.registrationId!==this.#config.registrationId){return"not_installed"}const references=await this.#store.query(`UPDATE ${SLACK_USER_LINKS_TABLE}
          SET status = 'revoked', revoked_at = now(), updated_at = now(), revision = revision + 1
        WHERE environment = $1 AND workspace_hash = $2 AND status = 'active'
      RETURNING delegated_identity_ref, token_ref_provider, token_ref_fingerprint`,[scope.environment,scope.workspaceHash]);const installation=await this.#store.query(`UPDATE ${SLACK_INSTALLATIONS_TABLE}
          SET status = 'revoked', revoked_at = now(), updated_at = now(), revision = revision + 1
        WHERE environment = $1 AND workspace_hash = $2 AND registration_id = $3 AND status = 'active'
      RETURNING installation_id`,[scope.environment,scope.workspaceHash,scope.registrationId]);await Promise.all(references.rows.map(row=>this.#credentials.revoke({id:text(row,"delegated_identity_ref"),provider:text(row,"token_ref_provider"),fingerprint:text(row,"token_ref_fingerprint")})));return installation.rows.length>0||references.rows.length>0?"uninstalled":"not_installed"}async linkReferenceForActor(actor){const result=await this.#store.query(`SELECT link_id
         FROM ${SLACK_USER_LINKS_TABLE}
        WHERE environment = $1 AND workspace_hash = $2 AND owner_hash = $3 AND status = 'active'
        LIMIT 1`,[this.#config.environment,this.#config.allowedTeamHash,hashSlackIdentifier(actor.trim().toLowerCase())]);return result.rows[0]?text(result.rows[0],"link_id")||null:null}};async function ensureSlackInstallation(store,config){const existing=await readSlackInstallation(store,{environment:config.environment,workspaceHash:config.allowedTeamHash,registrationId:config.registrationId});if(existing){if(existing.registrationId!==config.registrationId){throw new Error("Slack installation registration does not match this environment.")}return existing}const created=await createSlackInstallation(store,{environment:config.environment,expectedEnvironment:config.environment,workspaceHash:config.allowedTeamHash,registrationId:config.registrationId,expectedRegistrationId:config.registrationId,botUserHash:null,botTokenRef:config.botTokenSecretRef,appTokenRef:config.appTokenSecretRef,clientSecretRef:null,signingSecretRef:null,grantedScopes:["chat:write","im:history"]});if(created.outcome==="created")return created.value;const raced=await readSlackInstallation(store,{environment:config.environment,workspaceHash:config.allowedTeamHash,registrationId:config.registrationId});if(!raced)throw new Error("Slack installation could not be recorded.");return raced}export{LakebaseSlackLinkWriter,ensureSlackInstallation};
