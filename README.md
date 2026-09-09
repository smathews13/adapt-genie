# ADAPT — Digital Sales Intelligence

A Databricks App and an MLflow `ResponsesAgent` that answer analytical questions
about digital game sales — Steam sell-through, wishlists, and store visibility —
from governed data, and show their work. Every number comes from a live query run
under the grants of the person who asked, and every run leaves a trace anyone can
open.

ADAPT is a governed Genie orchestration app for the customer Steam sales data. It
ships as a Databricks Asset Bundle. `bundle/README.md` is the operator runbook
and is more detailed than this page; what follows is the shortest path through
it, plus what the thing actually is.

- [What it does](#what-it-does)
- [How an answer is produced](#how-an-answer-is-produced)
- [The shape of an answer](#the-shape-of-an-answer)
- [Runtime settings](#runtime-settings-change-behaviour-without-a-release)
- [The pages](#the-pages)
- [Deploying it: the bundle](#deploying-it-the-bundle)
- [Updating it: Deploy from Git](#updating-it-deploy-from-git)
- [Grants, sharing and sign-in](#release-time-grants-and-one-manual-share)

## What it does

Someone asks a question in plain language — "how did NBA 2K26 sell through on
each platform last week?", "what are our life-to-date Steam wishlists by
country?". The app hands it to an orchestrating agent on Model Serving, which
plans the work, asks the governed Genie space for the figures behind it, and
returns a structured answer: a takeaway, a short narrative, the figures and
charts it computed, the tables it read, and the caveats that apply. The SQL Genie
ran and the full step-by-step trace ship with the answer.

Two properties are the point of the product, and both are enforced rather than
promised:

**Governance is not re-implemented.** The agent reads data as the signed-in
caller, never as its own service principal. Unity Catalog applies that person's
row filters and column masks. A denial is reported as a finding, not routed
around. What the agent may read at all is a table manifest fixed when the model
is logged — read from what the Genie space curates at log time — and the read
boundary refuses anything outside it.

**Nothing is asserted that was not measured.** Figures come from statements the
run actually executed, with per-statement provenance recording what was measured,
over what window, filtered how. Where a question cannot be safely answered, the
run returns a clarification instead of a plausible number.

## How an answer is produced

```text
Browser ──▶ Databricks App ──▶ Orchestrator (Model Serving)
                  │                   │
                  │                   ├──▶ Foundation model
                  │                   ├──▶ data_genie  ──▶ Genie space ──▶ SQL warehouse ──▶ Unity Catalog
                  │                   └──▶ MLflow experiment  (trace)
                  └──▶ Lakebase (Postgres)
```

**The Orchestrator always owns the run.** It is the served model version, and it
plans the answer, decides what to ask, and writes the final prose.

**Genie is the one data capability.** ADAPT runs Genie-only: the agent's sole
data tool is `data_genie`, over a single Genie space — *ADAPT — Steam Sales &
Analytics*, curating the customer Steam sales, wishlist and store-visibility
tables. There is no agent-authored SQL fallback and no separate data-dictionary
space; Genie authors and runs the SQL, and the agent cites the space. Under
`execution_identity: user-authorization`, Genie runs as the person who asked.

**The warehouse and Unity Catalog are where governance actually happens.** The
warehouse runs Genie's SQL read-only; the catalog applies the reader's own grants
to every row and column.

**Lakebase (Postgres) is what the deployment keeps.** Conversations, messages,
uploads, feedback, benchmark runs, user roles, and live runtime settings. It is
written as the app serves and is never read to compute an answer.

**The MLflow experiment is the trace.** Tool calls, SQL, timings, token usage,
and which Genie space answered. It is what Run Explorer reads.

## The shape of an answer

Every answer is a structured contract rather than a block of prose, and the same
sections appear on every run:

| Section | What it is |
| --- | --- |
| Takeaway | The single sentence a reader would repeat. |
| Narrative | Short interpretation of the findings. |
| Content | The concrete findings, kept separate from interpretation. |
| Figures | Labelled values with an optional comparison. |
| Charts | Plotly panels, whose kind is derived from the traces rather than declared. |
| Sources | Each table read, and whether it was read for values (`reading`) or for meaning (`reference`). |
| Caveats | Governance, coverage and interpretation limits that apply. |
| Derivation | Per statement: source, metric, window, filter. Parsed from the SQL that ran, never from what the model wrote. |
| SQL | The statements Genie ran. |
| Trace | Every stage, nested, with its real input and output. |

A turn has three possible outcomes, not one. It can return an **answer**; it can
return a **plan** for approval before doing analytical work; or it can return a
**clarification**: one short, specific question, with the options it found and
the steps it had already taken. A clarification is deliberately not an answer
with a caveat attached: an answer invites a reader to use its figures, and there
are none worth using yet.

Two conventions are worth knowing when reading a stored answer. An empty
derivation field means the statement did not say, not "all time" and not
"unknown". And a source with no role is one recorded before roles existed, so a
reader must say so rather than guess which it was.

## Runtime settings: change behaviour without a release

Administrators can change how the agent runs and how answers are presented from
**Settings**, and the change applies to the next question. These live in
Lakebase, are validated on write, and are handed to the agent as part of each
request. No model re-log, no redeploy.

- **Loop limits**: maximum steps, maximum tool calls, maximum run seconds.
- **Answer sections**: turn takeaway, narrative, charts, figures or caveats on
  or off, and cap how many of each. Turning a section off hides its controls but
  keeps their values, so turning it back on restores what was set.
- **Guidance**: free text handed to the agent alongside the takeaway and the
  narrative it belongs to.
- **Presentation**: how figure cards are ordered, which chart shapes may be
  drawn, how dense the sources list is, and the colours used for catalog, schema,
  table, column, quote and tag mentions in rendered answers.
- **Behaviour**: how readily the agent asks for clarification, the timezone
  relative dates resolve against, and whether today's date is injected.

**What runtime settings cannot do.** They cannot widen what the agent may read.
The table manifest, the system prompts, the guardrails and the Genie space id are
baked into the MLflow model artifact when the model is logged. Changing any of
those is a deliberate model release, reviewable as one. That boundary is the
reason a settings change is safe to make live.

## The pages

The top navigation shows **Ask**, **Monitoring** and **Ops**. The remaining
routes below stay registered and reachable by URL and from in-app links; only the
top-level tabs were trimmed for the digital-sales audience.

| Page | Nav | Who | What it is for |
| --- | --- | --- | --- |
| **Ask** (`/`) | yes | everyone | The conversation. Answers, plans, clarifications, attachments, feedback. |
| **Monitoring** | yes | admins | Usage, latency and failures over time. |
| **Ops** | yes | admins | Serving endpoint, traffic, and operational state. |
| **Run Explorer** (`/runs`) | URL only | everyone | Every recorded run, and one run's trace read four ways: the answer, the step list, the nested call graph, and the timeline. The timeline is the same component the answer card draws, so the two cannot disagree about a measurement. |
| **Connections** (`/connections`) | URL only | everyone | Every dependency this deployment has, what it is configured with, what the running model reports it is actually using, and whether those two disagree. |
| **Architecture** (`/architecture`) | URL only | everyone | The same connections as a diagram, with a text equivalent carrying every fact the drawing does. Statuses are the Connections page's own, so a node cannot grade a dependency differently from the row that grades it. |
| **Settings** | gear, admins | admins | Runtime settings, people and roles, and the deployment's own configuration. |

Admin routes are registered for everyone and refused by every admin API with a
403. Hiding a nav entry and breaking a URL are different decisions; a consumer
who follows an admin's link gets a sentence explaining the refusal rather than a
page of broken panels.

### Connections, and declaring configuration from a notebook

Connections compares two documents. One is what the running model reports about
itself. The other is optional: a declaration a notebook publishes into a table
the app reads, which lets the team that owns the pipeline state what the
deployment is *meant* to be configured with. Each key is badged **In use**,
**Awaiting model version**, **Not applied**, or **Not checked**.

Publishing changes nothing at runtime. That is the design, not a limitation. A
document fetched over the network does not get to widen what an agent may read.
Everything waits for the next model release, including a value that would
*narrow* the agent's reach, because narrowing and widening take the same
reviewable path.

An administrator who reviews the drift can click **Apply**, which records an
immutable approved request. Executing it is a separate, credentialed step run by
a person, against that exact request id.

To set it up, create a table and point the app at it on the Connections tab:

```sql
CREATE TABLE IF NOT EXISTS <catalog>.<schema>.declarations (
  published_at TIMESTAMP,
  published_by STRING,
  document     STRING
);
```

Publishing appends a row and the app reads the newest, so a notebook run needs
one `INSERT` and no read-modify-write. The app reads the table as the signed-in
user; grant `SELECT` to whoever should see the comparison.

---

## Deploying it: the bundle

Read this before pointing anything at this repository.

**The app source path is `app/build/deploy`. There is nothing
to build first.** That directory is committed and holds the bundled server and
the built client. It deliberately has **no `package.json`**, so the platform logs
"No dependencies file found. Skipping installation" and the deploy takes about
fifteen seconds. Only rebuild it if you change the code:

```bash
cd app && npm install && npm run build:deploy
git add app/build/deploy
```

**Both of the obvious source paths fail quietly.** The repository root has no
`app.yaml`. `app/` hangs, because the platform finds a
`package.json` there and tries to install a 500-package tree with no registry
egress from app compute.

**Two `app.yaml` files exist and only one is deployable.**
`app/app.yaml` is the source one and runs `npm run start`.
`app/build/deploy/app.yaml` is the built one, runs the bundled
server, and is the one the platform reads.

### What the workspace needs first

The bundle declares the app, its Unity Catalog schema and volume, and its MLflow
experiment. The release scripts log the model and create the serving endpoint.

**Lakebase and the Genie space are attached, not created.** The bundle binds to a
Lakebase database that already exists and names a Genie space that already exists.
It creates, modifies and destroys neither. That is deliberate: they hold state and
curation a deploy has no business overwriting.

Have these before you start:

- an existing Unity Catalog catalog for the app's own objects;
- the production catalogs or schemas the agent may read;
- **an existing Lakebase project, branch, and database**: create one in the
  Lakebase UI or with `databricks postgres create-project`, then read the ids
  back with `databricks postgres list-projects`. No owner role is needed; that
  was an input to creating the database;
- **one existing Genie space**, with its tables already curated. You supply its
  id, not its contents. `genie/adapt_space.json` is the committed ADAPT
  space definition used to curate it;
- an existing SQL warehouse;
- a workspace source path for the committed deploy tree;
- one or more initial app administrator email addresses.

### Configure

Set the required values in `.databricks/bundle/customer/variable-overrides.json`,
which is git-ignored. ADAPT's shape:

```json
{
  "app_name": "adapt-genie",
  "app_description": "ADAPT, governed digital sales intelligence through Genie",
  "app_admin_group": "<customer_adapt_admin_group>",
  "app_user_group": "<customer_adapt_user_group>",
  "serving_endpoint_name": "adapt-orchestrator",
  "experiment_path": "/Shared/adapt-genie",
  "app_catalog": "<your_catalog>",
  "app_schema": "adapt_genie",
  "data_catalogs": ["<your_data_catalog>.<your_schema>"],
  "watchlist_table": "<your_data_catalog>.<your_schema>.txn_steam_sales_with_analytics",
  "warehouse_id": "<your_warehouse_id>",
  "genie_data_space_id": "<your_data_genie_space_id>",
  "lakebase_project_id": "<your_existing_lakebase_project_id>",
  "lakebase_branch_id": "production",
  "lakebase_database_id": "<your_existing_lakebase_database_id>",
  "lakebase_app_schema": "adapt",
  "app_source_code_path": "/Workspace/Users/<you>@example.com/adapt-genie-src",
  "admin_emails": "super:<your_admin@example.com>"
}
```

`lakebase_branch_id` defaults to `production`. `lakebase_database_id` is
required because Autoscaling Lakebase database resource IDs are generated and
are not the PostgreSQL database name shown to SQL clients.
The customer defaults are ADAPT-owned: app `adapt-genie`, endpoint
`adapt-orchestrator`, experiment `/Shared/adapt-genie`, registered model
`adapt_orchestrator`, and Lakebase schema `adapt`.
`app_schema` remains a required deployment input because it names the
deployment's Unity Catalog boundary. The `super:` prefix lets the first
administrator appoint a second one before any later update.

The the customer group names are defaults, not hardcoded resource identities.
Override `app_admin_group` and `app_user_group` for another customer; the same
values drive both App permissions and ADAPT's in-app role floor.

Slack account-menu actions open the user's Slack client directly. They do not
require a bot, Slack OAuth scopes, or Databricks secret resources.

`data_catalogs` is the complete read boundary. A catalog name includes all of its
non-system schemas; `catalog.schema` limits the boundary to one schema — which is
what ADAPT does, scoping to the one Steam-sales schema. The app schema is separate
and holds only app-owned objects.

`watchlist_table` names the governed Steam sales table inside that boundary.
The Ask rail reads net USD revenue per unit sold through the signed-in user's
OAuth token, and administrators choose the displayed title roll-ups under
Settings → Watchlist.

**You do not list the Genie space's tables.** With `manifest_source=genie`, the
model's table manifest, which is what grants the serving principal `SELECT`, is
read from what the live space curates at the moment the model is logged. That same
step refuses to log a model if any curated table falls outside `data_catalogs`, so
discovering the tables rather than typing them does not widen the read boundary.
Adding a table to the Genie space therefore changes the agent's grants, and takes
effect at the next model re-log.

### Deploy

Three commands, in this order:

```bash
TARGET=customer PROFILE='<your-profile>' bash bundle/deploy.sh
TARGET=customer PROFILE='<your-profile>' bash bundle/agent-release.sh --apply
TARGET=customer PROFILE='<your-profile>' bash bundle/app-release.sh --apply
```

The first runs one complete, interactive `databricks bundle deploy` for the
target, including the App. It does not require a separate `bundle plan`, it never
auto-approves, and it refuses to run against stale local Lakebase state. Read the
change list it prints. The second logs the model and updates the serving
endpoint. The third applies the app's database grants and releases the app code.

> **Greenfield gotcha.** On a brand-new workspace the App resource cannot bind the
> serving endpoint on the first `bundle/deploy.sh` (the endpoint does not exist
> yet). Run `agent-release.sh` to create the endpoint, then re-run
> `bundle/deploy.sh` so the App attaches it. After the bootstrap, app-code updates
> use the Deploy-from-Git flow below (or a repeat of `app-release.sh`).

**Do not create the App by hand**, exclude it with `--select`, or introduce a
Terraform-engine path as an alternative. The App is bundle-owned.

The deploy preserves unrelated tags while applying `system_billing=adapt` to
the attached Lakebase project and SQL warehouse. The agent release applies the
same tag to the ADAPT serving endpoint. Other resources are outside this tagging
workflow.

### Deployment landmines

| Issue | How this process avoids it |
| --- | --- |
| Some CLI versions crash creating an App when an empty `telemetry_export_destinations: []` is rendered | The customer target omits the optional field entirely. The bundle deploy creates the App on the direct engine; Terraform is not offered as an alternative. |
| Old bundle state still *owns* a Lakebase project the current YAML only *attaches* | `bundle/deploy.sh` refuses a local `resources.json` that still tracks `postgres_projects`, `postgres_branches`, or `postgres_databases`. Migrate those entries out of state first, and never pass `--auto-approve`: skipping the change list has destroyed an attached Lakebase project before. |
| A crashed deploy leaves a stale lock | Retry with `--force-lock` only after confirming no deploy is live: set `ADAPT_CONFIRMED_NO_LIVE_DEPLOY=true` and pass `--force-lock` to the wrapper. Do not make it the normal command. |
| A clean clone has no `node_modules`, so `tsc` exits 127 | `app-release.sh` runs `npm ci` when `node_modules` is absent, before `npm run build:deploy`. |
| An empty schema inside an otherwise usable catalog failed preflight | Empty schemas are skipped. There is no local table ceiling; Unity Catalog may still refuse a very wide dependency list at log time. |
| A newly created App's compute is `STOPPED` | `app-release.sh` starts compute before its first code deploy. |
| Recreating a deleted App gives it a new service principal, which cannot own the old app schema | Preserve the old data and set `lakebase_app_schema` to a new, unused schema before deploying. The new app creates and owns it on first start. The ownership gate refuses the old schema rather than trying to steal it; move data deliberately afterwards rather than dropping a schema to get past the gate. |
| The Lakebase resource ID differs from the live PostgreSQL database name | Set `lakebase_database_id` from `databricks postgres list-databases`; the grant step resolves the SQL-facing name separately before connecting. |
| First on-behalf-of request returns HTTP 400 `Unable to authenticate using user_credentials` | Treat it as consent and session state: restart the app after a scope change and have the user sign in again. Repeating the bundle deploy does not repair an old token. |
| Additional users cannot run the Genie space | Grant every user or group `CAN RUN` on the space. No identities are hardcoded anywhere. |
| A restored Lakebase project keeps billing | Inventory and delete the orphan explicitly. This is recovery cleanup, not part of a normal deploy. |

## Updating it: Deploy from Git

**Run the bundle bootstrap above once first.** It creates the telemetry schema,
experiment, serving endpoint, OAuth scopes, resource bindings, and the app
itself. The first `bundle/app-release.sh` also records the release's catalog,
schema, Genie space, watchlist table, MLflow experiment, and related runtime
scope in the app-owned Lakebase store. Do not start the Git flow before that
first app release has completed.

After that, **app-code updates are Deploy from Git onto the existing app**, and
that is the usual path. UI, server and other TypeScript in
`app/build/deploy` are pulled from this repository onto the
live app.

Deploy from Git replaces the generated `app.yaml` with the public artifact's
customer-neutral placeholders. On startup, ADAPT restores the last recorded
bundle-release values before Connections, the Insights Rail, watchlist, or
MLflow routes initialize. A Git update therefore changes source code without
blanking the deployment's existing scope.

1. Open the **existing** app's detail page, not Create app.
2. Choose **Deploy → From Git**.
3. Confirm the Git settings. Set once; re-check them, because the UI can clear
   the path when you start a new flow.

   | Setting | Value |
   | --- | --- |
   | Repository | `https://github.com/smathews13/adapt-genie` |
   | Provider | **GitHub** |
   | Branch / reference | **`main`** (reference type **Branch**) |
   | Source code path | **`app/build/deploy`** |

4. Click **Deploy**. The app updates then, and only then. Do **not** enable
   *Auto deploy on push events*; an update is a deliberate step.

**Do not leave Source code path blank.** Left blank, the platform deploys from
the repository root, which has no `app.yaml`, and the deploy fails with "No
command to run and no Python file found / Failed to load app spec".

**This repository is public.** Deploy from Git should use
`https://github.com/smathews13/adapt-genie` and does not require a private Git
credential.

### What a Git deploy does not do

This is the important half. A Git update is **code only**. It replaces the app's
deployed code snapshot, including the runtime `app.yaml` in that folder, and
nothing else. It does **not**:

- rerun the asset bundle, or create, update, detach or reconnect any resource:
  catalog, schema, Lakebase, Genie, warehouse, job, model or serving endpoint;
- re-attach resource bindings already configured on the app;
- re-log the model or move the serving endpoint to a new model version;
- change OAuth scopes (`user_api_scopes`);
- add, remove, promote or demote anybody.

Do not run `databricks bundle deploy`, `bundle/agent-release.sh`, or
`bundle/app-release.sh` as part of a Git update. None of them is part of it.

If the app is created directly from Git instead of updating a bundle-bootstrapped
app, configure the App resource's `user_api_scopes` as well as its bindings.
`app.yaml` tells the app which scopes to check; it cannot change the App resource
or cause Databricks to mint those scopes into a user's token. Every deployment
needs these four scopes:

- `serving.serving-endpoints`
- `model-serving`
- `sql`
- `dashboards.genie`

Catalog, schema, table, and workspace read scopes are optional Connections
browsing capabilities. `postgres` is optional Lakebase browsing.
Do not make any of those a prerequisite for asking questions, and do not add
`postgres` merely because the app has a Lakebase resource binding.

Bind an existing Lakebase database too. The app uses one Postgres schema inside
that database for conversations, settings, and roles; this is not a Unity
Catalog schema. A source-only Git deployment creates and owns `adapt` unless
`PLAYER_INSIGHTS_APP_SCHEMA` names another. The bound
database normally grants the app service principal `CREATE`. If it does not, copy
the CLI/SQL block from the red storage banner: it resolves the app principal,
grants `CREATE, CONNECT` on the Postgres database, and restarts the app. Do not
grant or drop roles, and do not grant a Unity Catalog schema. Until storage is
fixed, questions still run as stateless turns and say that their history was not
saved.

**Roles survive every code deploy.** Lakebase is the runtime source of truth for
super-admin, admin and consumer roles. Deployment configuration can seed the
first rows only while the roster is genuinely empty. Once any row exists, the app
ignores `PLAYER_INSIGHTS_ADMIN_EMAILS` entirely: a stale, different or empty
committed `app.yaml` cannot change anyone's role. Only an explicit action in
Settings → People and roles does. This is why the committed snapshot carries no
addresses, and why that absence is harmless.

### When you still need something else

**A bundle redeploy**: only for resource bindings, OAuth scopes, and other
bundle-owned app configuration. Do not rerun the bundle merely to ship UI or
server code: reconciling the app resource can also remove bindings that exist
only as manual workspace changes.

**A model release**: changes to the agent's Python, its tools, its prompts or
the model itself are not app code and are not picked up by a Git deploy. They go
through `TARGET=<target> bundle/agent-release.sh --apply`, on its own cadence.
Changing the Genie space's curated tables also takes effect only at the next
re-log, because the manifest is read at log time.

**A scope change is three steps, and a Git deploy is none of them.** Update the
app's scope configuration, **fully stop and start the app** (a redeploy alone
leaves a new scope inert), and have each user sign in again in a fresh private
window to grant the updated consent. Until a user re-consents, their session
carries the old scope set and the new capability stays dark for them.

## Release-time grants and one manual share

Neither of these fails loudly. Skipped, the app returns HTTP 200 and answers are
wrong in a way no error reports.

**The app-release path grants the app's Postgres role.** The service principal
does not exist until the bundle creates the app, so `bundle/app-release.sh
--apply` runs `bundle/app-db-grant.sh` before its own code deploy. It derives the
app role and attached branch and database from the live app, the schema from the
resolved target, `PGUSER` from the profile identity, and `PGHOST` only from the
branch's direct connection, deliberately not the pooled hostname, which rejects
the operator login. A missing direct host, unreachable Postgres, or failed grant
stops the release. The profile identity must hold `DATABRICKS_SUPERUSER` on the
Lakebase branch.

After a Lakebase detach and reattach, when a full release is unnecessary:

```bash
TARGET=<target> PROFILE='<profile>' bundle/app-db-grant.sh
databricks apps stop <app-name> --profile '<profile>'
databricks apps start <app-name> --profile '<profile>'
```

That grants the app role on the app data schema and drops a misowned framework
cache schema (`appkit`) so the app recreates and owns it. A bare
`GRANT USAGE, CREATE ON SCHEMA appkit` is not enough, because later
`CREATE INDEX` needs table ownership. `appkit` holds only framework cache;
conversations and settings live elsewhere and are not touched. Skipped, storage
routes fall back to representative data and the cache resets on every restart.

**Share the Genie space at `CAN RUN` with the people or groups who will use the
app.** Under `execution_identity: user-authorization`, Genie runs as the person
who asked. Those same callers also need `CAN USE` on the SQL warehouse and
`SELECT` on the curated tables. Skipped, every Genie call fails
`PermissionDenied`.

```bash
databricks permissions update genie <space_id> \
  --json '{"access_control_list":[{"user_name":"someone@example.com","permission_level":"CAN_RUN"}]}'
```

Do **not** grant the *serving-endpoint* principal `CAN RUN`. That was the old
passthrough remedy; under user authorization it grants nothing the caller needs.

## Who can sign in, and who can administer

Each person needs the `workspace-access` and `databricks-sql-access`
entitlements. Without the second, OAuth sign-in fails in a loop rather than
saying what is missing; the app's refusal screen prints the command that grants
them.

Administrators see Monitoring, Ops and the settings gear. The first ones are
named at release time in the git-ignored
`.databricks/bundle/<target>/variable-overrides.json`:

```json
{ "admin_emails": "super:someone@example.com" }
```

`bundle/app-release.sh` reads it and writes it into the app's `app.yaml`.
`PLAYER_INSIGHTS_ADMIN_EMAILS` in the release environment wins over the file. On
a genuinely empty roster, app boot inserts those first roles into Lakebase once;
after that, Lakebase is the only runtime authority.

**`admin_emails` is required.** Bundle validation fails when it is unset, and the
release script refuses an explicitly empty value. Without those checks the app
would start and refuse every admin surface, including the editor that appoints
someone, and the only way out would be another release. That self-locking
configuration is rejected before deployment rather than after.

## Verifying it actually works

A deployment can be built correctly and still answer everything from
representative data. `bundle/README.md` lists what to establish. The short
version:

```bash
databricks apps get <app-name> -o json
```

should show both the `postgres` and `serving-endpoint` resources attached, and
every declared scope in effect. Then open **Connections** (`/connections`) in the
app: it probes each dependency and reports what the running model says it is
actually using, which is the difference between a deployment that is configured
and one that works.

## Compatibility identifiers

ADAPT owns its product surface, Genie-only orchestrator, customer bundle, model,
endpoint, experiment, storage schemas, and billing tag. The
`PLAYER_INSIGHTS_*` environment-variable prefix remains an internal
compatibility interface; it is not a deployed resource name.
