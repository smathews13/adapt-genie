
import{classifyDenial,tableGrant}from"./chunk-JX2D4OX6.mjs";import{sqlQueryTags}from"./chunk-DC3NGZXW.mjs";var SPAN_PERCENTILE_FLOOR=20;var DAY_MS=864e5;function opsCurrentMonthRange(now=Date.now()){const today=new Date(now).toISOString().slice(0,10);const monthStart=`${today.slice(0,7)}-01`;const lastComplete=new Date(now-DAY_MS).toISOString().slice(0,10);return{from:monthStart,to:lastComplete<monthStart?monthStart:lastComplete}}function opsDayRange(from,to,now){const day=at=>new Date(at).toISOString().slice(0,10);const start=Date.parse(from);const end=Date.parse(to);const lastComplete=now-DAY_MS;if(Number.isFinite(start)&&Number.isFinite(end)&&end>=start){return{from:day(start),to:day(Math.min(end,lastComplete))}}return{from:day(lastComplete-6*DAY_MS),to:day(lastComplete)}}var NO_EXPORTER_READING={state:"unmeasured",tables:[],error:"",schema:""};var NO_APP_SERVING={app:"",compute:"",message:""};var NO_APP_FACTS={url:"",answered:false,description:"",compute:null,tags:[],deployedAt:"",deployedBy:"",source:{path:"",workspaceUrl:"",gitRef:""},serving:NO_APP_SERVING,otelExporter:"",otelExport:NO_EXPORTER_READING};var TELEMETRY_SCHEMA_ENV="PLAYER_INSIGHTS_TELEMETRY_SCHEMA";var LOGS_TABLE="otel_logs";var EXPORTER_TABLES=["otel_spans","otel_metrics"];function telemetrySchema(raw=process.env[TELEMETRY_SCHEMA_ENV]){const candidate=(raw??"").trim().replace(/^`|`$/g,"");if(candidate){const parts=candidate.split(".").filter(part=>part.length>0);if(parts.length!==2){console.warn(`[ops] ${TELEMETRY_SCHEMA_ENV} is ${JSON.stringify(candidate)}, which is not a catalog and schema. App telemetry is being reported as not configured rather than guessed at.`);return""}return parts.join(".")}return""}function record(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{}}function telemetryDestinationFromApp(body){const app=record(body);const raw=app.telemetry_export_destinations??app.telemetryExportDestinations;const destinations=Array.isArray(raw)?raw:[];if(destinations.length===0)return{state:"disabled",schema:"",reason:""};for(const destination of destinations){const row=record(destination);const unityCatalog=record(row.unity_catalog??row.unityCatalog);const logs=typeof unityCatalog.logs_table==="string"?unityCatalog.logs_table:typeof unityCatalog.logsTable==="string"?unityCatalog.logsTable:"";const match=/^([^.]+\.[^.]+)\.otel_logs$/.exec(logs.trim());if(match)return{state:"configured",schema:match[1],reason:""}}return{state:"unreadable",schema:"",reason:"The Apps record has telemetry destinations, but none names a valid Unity Catalog logs table."}}var workspaceTelemetryDestinationReader=async appName=>{const{WorkspaceClient}=await import("./vendor-databricks-sdk-experimental.mjs");return new WorkspaceClient({}).apiClient.request({path:`/api/2.0/apps/${encodeURIComponent(appName)}`,method:"GET",headers:new Headers({Accept:"application/json"}),raw:false})};async function readTelemetryDestination(input={}){const fromEnvironment=telemetrySchema(input.raw);if(fromEnvironment)return{state:"configured",schema:fromEnvironment,reason:""};const appName=(input.appName??process.env.DATABRICKS_APP_NAME??"").trim();if(!appName){return{state:"unreadable",schema:"",reason:"The app name is unavailable, so the live telemetry configuration could not be checked."}}try{return telemetryDestinationFromApp(await(input.read??workspaceTelemetryDestinationReader)(appName))}catch(error){return{state:"unreadable",schema:"",reason:`The Apps record could not be read, so telemetry configuration is unknown: ${error.message}`}}}function logsTable(schema){return schema?`${schema}.${LOGS_TABLE}`:""}function grantFor(table,principal,permission="SELECT"){const remedy=tableGrant(table,principal);return{object:table,privilege:permission,statement:remedy.statement}}function offMeasurement(insightsHref){return{telemetry:"not-enabled",variable:TELEMETRY_SCHEMA_ENV,table:"",grant:null,insightsHref,requestsPerHour:[],lastServedAt:"",recordingSince:"",signInsPerDay:[],errors:{count:0,recent:[]},reason:`App telemetry is not switched on for this deployment, so nothing is recording what the app served. It is configuration rather than code: set ${TELEMETRY_SCHEMA_ENV} to a catalog and schema and redeploy, and the platform begins writing from that deploy onward.`}}function uncheckedMeasurement(insightsHref,note){const schema=telemetrySchema();if(!schema){return{...offMeasurement(insightsHref),telemetry:"unreadable",reason:`Telemetry configuration could not be checked because ${note}`}}const table=logsTable(schema);return{...offMeasurement(insightsHref),telemetry:"unreadable",table,reason:`App telemetry is switched on and writing to ${table}, and ${note} So nothing about what this app served was established here, which is unchecked rather than empty.`}}function noHistoryReason(){return"No app requests have been recorded yet."}function stateFromFailure(message,table){const denial=classifyDenial(message,table);if(denial.kind==="no-grant"){return{state:"no-grant",permission:denial.permission,object:denial.object}}return{state:"unreadable",permission:"",object:table}}function attribute(key){return`variant_get(attributes, '$["${key}"]', 'string')`}var AUTH_EVENT="app.auth";var SIGN_IN_REASON="user_login";var APP_LOG_SOURCE="APP";function buildTelemetryStatement(table){return`WITH scoped AS (
  SELECT time, severity_text, body, attributes
  FROM ${table}
), served AS (
  SELECT time, severity_text, body
  FROM scoped
  WHERE ${attribute("app.log_source")} = '${APP_LOG_SOURCE}'
)
SELECT 'request-hour' AS kind,
       date_format(date_trunc('HOUR', time), 'yyyy-MM-dd HH:00') AS bucket,
       CAST(COUNT(*) AS STRING) AS value,
       '' AS detail
FROM served
GROUP BY 1, 2
UNION ALL
SELECT 'last-served', '', CAST(MAX(time) AS STRING), '' FROM served
UNION ALL
SELECT 'sign-in-day',
       date_format(date_trunc('DAY', time), 'yyyy-MM-dd'),
       CAST(COUNT(*) AS STRING),
       ''
FROM scoped
WHERE ${attribute("event.name")} = '${AUTH_EVENT}'
  AND ${attribute(`${AUTH_EVENT}.reason`)} = '${SIGN_IN_REASON}'
GROUP BY 1, 2
UNION ALL
SELECT 'error-count', '', CAST(COUNT(*) AS STRING), ''
FROM served
WHERE upper(severity_text) = 'ERROR'
UNION ALL
SELECT 'error-line', CAST(time AS STRING), '', substring(body, 1, 400)
FROM served
WHERE upper(severity_text) = 'ERROR'
UNION ALL
SELECT 'first-recorded', '', CAST(MIN(time) AS STRING), '' FROM ${table}
ORDER BY 1, 2`}var RECENT_ERROR_LIMIT=5;function readTelemetryRows(dataArray){const requestsPerHour=[];const signInsPerDay=[];const recent=[];let lastServedAt="";let recordingSince="";let count=0;if(Array.isArray(dataArray)){for(const raw of dataArray){if(!Array.isArray(raw)||raw.length<4)continue;const[kind,bucket,value,detail]=raw;if(kind==="request-hour"&&bucket){requestsPerHour.push({hour:bucket,count:Number(value??0)})}else if(kind==="sign-in-day"&&bucket){signInsPerDay.push({day:bucket,count:Number(value??0)})}else if(kind==="last-served"&&value){lastServedAt=value}else if(kind==="first-recorded"&&value){recordingSince=value}else if(kind==="error-count"){count=Number(value??0)}else if(kind==="error-line"&&bucket){recent.push({at:bucket,body:detail??""})}}}recent.sort((left,right)=>right.at.localeCompare(left.at));return{requestsPerHour,signInsPerDay,lastServedAt,recordingSince,errors:{count,recent:recent.slice(0,RECENT_ERROR_LIMIT)}}}function hasHistory(figures){return figures.requestsPerHour.length>0||figures.signInsPerDay.length>0||Boolean(figures.lastServedAt)}function buildExporterStatement(schema){const branches=EXPORTER_TABLES.map(name=>`SELECT '${name}' AS name,
       CAST(COUNT(*) AS STRING) AS rows,
       CAST(MIN(time) AS STRING) AS first_at,
       CAST(MAX(time) AS STRING) AS last_at
FROM ${schema}.${name}`);return`${branches.join("\nUNION ALL\n")}
ORDER BY 1`}function rowText(value){return typeof value==="string"?value.trim():""}function readExporterRows(dataArray,schema){const tables=[];if(Array.isArray(dataArray)){for(const raw of dataArray){if(!Array.isArray(raw)||raw.length<4)continue;const[name,rows,firstAt,lastAt]=raw;const table=rowText(name);if(!table)continue;tables.push({table,rows:Number(rows??0)||0,firstAt:rowText(firstAt),lastAt:rowText(lastAt)})}}const written=tables.reduce((total,entry)=>total+entry.rows,0);return{state:tables.length===0?"unreadable":written>0?"exporting":"silent",tables,error:tables.length===0?"The warehouse answered the count with no rows at all, so nothing was established.":"",schema}}function exporterFailure(message,schema){return{state:"unreadable",tables:[],error:message.trim()||"the count did not complete",schema}}function exporterCoverage(reading){const stamps=reading.tables.map(entry=>entry.firstAt).filter(Boolean).sort();const latest=reading.tables.map(entry=>entry.lastAt).filter(Boolean).sort();if(stamps.length===0)return"";const last=latest[latest.length-1];return last?`${stamps[0]} to ${last}`:`since ${stamps[0]}`}var WAREHOUSE_ENV="DATABRICKS_SQL_WAREHOUSE_ID";var EXPORTER_CACHE_MS=5*60*1e3;var workspaceExporterReader=async()=>{const schema=telemetrySchema();if(!schema)return{...NO_EXPORTER_READING};const warehouse=(process.env[WAREHOUSE_ENV]??"").trim();if(!warehouse){return exporterFailure(`No ${WAREHOUSE_ENV} is set, so there is nothing to run the count on.`,schema)}try{const{WorkspaceClient}=await import("./vendor-databricks-sdk-experimental.mjs");const client=new WorkspaceClient({});const body=await client.apiClient.request({path:"/api/2.0/sql/statements",method:"POST",headers:new Headers({"content-type":"application/json"}),payload:{warehouse_id:warehouse,statement:buildExporterStatement(schema),query_tags:sqlQueryTags({surface:"telemetry",tool:"ops_telemetry",operation:"exporter_read"}),wait_timeout:"30s",on_wait_timeout:"CANCEL",format:"JSON_ARRAY",disposition:"INLINE"},raw:false});const state=rowText(body?.status?.state);if(state!=="SUCCEEDED"){return exporterFailure(rowText(body?.status?.error?.message)||`the count ended in ${state||"an unknown state"}`,schema)}return readExporterRows(body?.result?.data_array??[],schema)}catch(error){return exporterFailure(error?.message??"the count did not complete",schema)}};var cached=null;async function readExporter(input={}){const now=input.now??Date.now();const ttl=input.cacheMs??EXPORTER_CACHE_MS;if(cached&&now-cached.at<ttl)return cached.reading;const reading=await(input.read??workspaceExporterReader)();cached={at:now,reading};return reading}function forgetExporterReading(){cached=null}var SPANS_TABLE="otel_spans";function spansTable(schema){return schema?`${schema}.${SPANS_TABLE}`:""}var SERVER_SPAN_KIND="SPAN_KIND_SERVER";function buildLatencyStatement(table){const httpStatus=`try_cast(coalesce(
    variant_get(attributes, '$["http.status_code"]', 'string'),
    variant_get(attributes, '$["http.response.status_code"]', 'string')
  ) AS INT)`;return`WITH served AS (
  SELECT name,
         (end_time_unix_nano - start_time_unix_nano) / 1e6 AS ms,
         time,
         CASE WHEN ${httpStatus} >= 500 THEN 1 ELSE 0 END AS is_error
  FROM ${table}
  WHERE kind = '${SERVER_SPAN_KIND}'
    AND end_time_unix_nano >= start_time_unix_nano
),
bounds AS (
  SELECT MIN(time) AS t0, MAX(time) AS t1 FROM served
),
marked AS (
  SELECT s.*,
         CASE
           WHEN b.t0 IS NULL OR b.t1 IS NULL OR b.t0 = b.t1 THEN 'current'
           WHEN s.time < b.t0 + (b.t1 - b.t0) / 2 THEN 'prior'
           ELSE 'current'
         END AS half
  FROM served s CROSS JOIN bounds b
)
SELECT 'route' AS kind,
       name AS label,
       CAST(SUM(CASE WHEN half = 'current' THEN 1 ELSE 0 END) AS STRING) AS spans,
       CAST(percentile_approx(CASE WHEN half = 'current' THEN ms END, 0.5) AS STRING) AS p50,
       CAST(percentile_approx(CASE WHEN half = 'current' THEN ms END, 0.95) AS STRING) AS p95,
       CAST(percentile_approx(CASE WHEN half = 'current' THEN ms END, 0.99) AS STRING) AS p99,
       CAST(MAX(CASE WHEN half = 'current' THEN ms END) AS STRING) AS slowest,
       CAST(SUM(CASE WHEN half = 'current' THEN is_error ELSE 0 END) AS STRING) AS errors,
       CAST(MAX(CASE WHEN half = 'current' THEN time END) AS STRING) AS last_at,
       CAST(SUM(CASE WHEN half = 'prior' THEN 1 ELSE 0 END) AS STRING) AS prior_spans,
       CAST(percentile_approx(CASE WHEN half = 'prior' THEN ms END, 0.5) AS STRING) AS prior_p50
FROM marked
GROUP BY name
HAVING SUM(CASE WHEN half = 'current' THEN 1 ELSE 0 END) > 0
UNION ALL
SELECT 'covered', '', CAST(MIN(time) AS STRING), CAST(MAX(time) AS STRING), '', '', '', '', '', '', ''
FROM served
ORDER BY 1`}function readLatencyRows(dataArray){const routes=[];let coveredFrom="";let coveredTo="";if(Array.isArray(dataArray)){for(const raw of dataArray){if(!Array.isArray(raw)||raw.length<5)continue;const[kind,label,spans,p50,p95,p99,slowest,errors,lastAt,priorSpans,priorP50]=raw;if(kind==="covered"){coveredFrom=rowText(spans);coveredTo=rowText(p50);continue}if(kind!=="route")continue;const route=rowText(label);if(!route)continue;const counted=Number(spans??0)||0;if(counted<=0)continue;const priorCounted=Number(priorSpans??0)||0;routes.push({route,spans:counted,p50Ms:Number(p50??0)||0,p95Ms:counted>=SPAN_PERCENTILE_FLOOR?Number(p95??0)||0:null,p99Ms:counted>=SPAN_PERCENTILE_FLOOR?Number(p99??0)||0:null,slowestMs:Number(slowest??p50??0)||0,errorCount:Number(errors??0)||0,refusalCount:null,lastSpanAt:rowText(lastAt),priorSpans:priorCounted,priorP50Ms:priorCounted>0?Number(priorP50??0)||0:null})}}routes.sort((left,right)=>right.p50Ms-left.p50Ms);return{routes,coveredFrom,coveredTo}}export{NO_EXPORTER_READING,NO_APP_FACTS,SPAN_PERCENTILE_FLOOR,opsCurrentMonthRange,opsDayRange,TELEMETRY_SCHEMA_ENV,LOGS_TABLE,EXPORTER_TABLES,telemetrySchema,telemetryDestinationFromApp,workspaceTelemetryDestinationReader,readTelemetryDestination,logsTable,grantFor,offMeasurement,uncheckedMeasurement,noHistoryReason,stateFromFailure,AUTH_EVENT,SIGN_IN_REASON,APP_LOG_SOURCE,buildTelemetryStatement,RECENT_ERROR_LIMIT,readTelemetryRows,hasHistory,buildExporterStatement,readExporterRows,exporterFailure,exporterCoverage,WAREHOUSE_ENV,EXPORTER_CACHE_MS,workspaceExporterReader,readExporter,forgetExporterReading,SPANS_TABLE,spansTable,SERVER_SPAN_KIND,buildLatencyStatement,readLatencyRows};
