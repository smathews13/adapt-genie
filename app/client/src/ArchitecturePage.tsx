/**
 * What this deployment is made of, drawn from what it actually reports.
 *
 * THE DIAGRAM IS A SECOND VIEW OF THE CONNECTIONS MODEL, not a picture of it.
 * Every node that names a dependency is a `ConnectedResource`, and its pills, its
 * identifier and its drift come from `connection-model.ts`, the derivation the
 * Connections page renders. The two cannot describe different deployments,
 * because there is only one reading. A diagram is believed in a way a list is
 * not, so a diagram that had its own opinion about what the app is wired to
 * would be the most expensive kind of wrong.
 *
 * THE CHECKS RUN THEMSELVES, ONCE PER SESSION, and this page does not decide
 * when. `/api/architecture` is still the cheap read this page makes for itself:
 * it returns what the app container was given and costs no round trip. The two
 * payloads that carry reachability are expensive, so they run once for the whole
 * session through `session-checks.ts` -- on whichever of this page and
 * Connections is opened first -- and the Refresh control is the only thing that
 * re-runs them after that.
 *
 * It used to be that nothing ran until Refresh was pressed, and the info row at
 * the bottom said so. The cost reasoning was right and the conclusion was wrong:
 * a page that opens without operational verdicts reads as broken, not as
 * pending, and it was read that way by the person it was built for.
 *
 * COLOUR HERE STATES WHAT A CONNECTION IS, NEVER HOW IT IS. The accent on a
 * card's edge, the colour of a line and the colour of the dot travelling along it
 * say question path, agent, Genie space, semantic search, governed data or
 * storage. Status lives in the pills and nowhere else. Two vocabularies in one
 * drawing would make a healthy teal node read as a warning.
 *
 * No figure appears here that was not read from something. There is no latency on
 * this page and no row count, because nothing in this app measures them per
 * dependency; where the reference this was modelled on prints a number, this
 * prints what it is waiting for.
 */
import { Component, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './styles/routes/architecture.css';
import { Link } from 'react-router';
import { Alert, AlertDescription } from './ui';
import { CircleAlert, ExternalLink } from 'lucide-react';
import { astPill } from './astrolabe-pill';
import { BrandIcon } from './BrandIcon';
// The word, the icon and the pending state, decided once for the whole app.
import { RefreshControl } from './RefreshControl';
// The chain and the answer's shape, as data rather than as prose in this file.
// See the note at the top of agent-chain.ts for why they moved out of here.
import { AGENT_CHAIN } from './agent-chain';
import {
  ARCHITECTURE_NODES,
  describeArchitecture,
  drawnReadings,
  nodeAccessibleName,
  nodeReport,
  nodeValue,
  type ArchitectureNode,
} from './architecture';
import { NODE_FAMILY } from './architecture-view';
import { isAdaptHiddenConnection } from '../../shared/adapt-surface';
import {
  ACCENT_TOKEN,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  drawnEdges,
  nodeBox,
  type ArchitectureAccent,
  type NodeBox,
} from './architecture-layout';
import { observeArchitectureScale } from './architecture-responsive';
import { readConnections, readingsById, type ConnectionReading } from './connection-model';
import { DRIFT_MARKER_LABEL } from './connection-status';
import { checkedAtOf } from './check-session';
import { useSessionChecks } from './session-checks';
import { fetchWithTimeout } from './fetch-timeout';
import { databricksLink, type DatabricksObject } from '../../shared/databricks-links';
import { entityHref } from './data-entities';
import { AdaptLoader } from './AdaptLoadingAnimation';

interface ArchitecturePayload {
  workspaceHost: string;
  canDeepLink: boolean;
  servingEndpoint: { value: string; variable: string };
  appWarehouse: { value: string; variable: string };
  experimentId: string;
  appServicePrincipal: string;
  appBuildSha: string;
  readAt: string;
}

const ARCHITECTURE_DESCRIPTION_TIMEOUT_MS = 5_000;

/**
 * The browser must scale the fixed drawing before it paints it.
 *
 * The server and client both render scale 1, so hydration starts from identical
 * markup. In a browser this effect becomes a layout effect: its synchronous
 * clientWidth read is flushed before paint, then ResizeObserver reconciles every
 * later size. On the server it is an ordinary effect and never runs.
 */
const useCanvasLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** Keep a diagram exception from replacing the whole Architecture tab. */
class ArchitectureDiagramBoundary extends Component<
  { byResource: ReadonlyMap<string, ConnectionReading>; checking: boolean; children: ReactNode; now: number },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('Architecture diagram could not be rendered:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div data-testid="architecture-diagram-fallback">
        <Alert>
          <CircleAlert />
          <AlertDescription>
            The interactive diagram could not be drawn. The architecture map remains available below.
          </AlertDescription>
        </Alert>
        <ul className="arch-equivalent">
          {describeArchitecture(this.props.byResource, this.props.now, this.props.checking).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    );
  }
}

/**
 * Which workspace object a node opens, given what this deployment reported.
 *
 * The identifier is the one the node DISPLAYS, so a link can never point
 * somewhere other than the value beside it. Null wherever the value is unknown,
 * which is most of them until the checks have run.
 */
function workspaceObject(
  node: ArchitectureNode,
  reading: ConnectionReading | undefined,
  payload: ArchitecturePayload | null
): DatabricksObject | null {
  const shown = reading?.summary.value ?? '';
  switch (node.id) {
    case 'agent-endpoint': {
      const name = shown || payload?.servingEndpoint.value || '';
      return name ? { kind: 'serving-endpoint', name } : null;
    }
    case 'llm-endpoint':
      return shown ? { kind: 'serving-endpoint', name: shown } : null;
    case 'genie-data':
      return shown ? { kind: 'genie-space', spaceId: shown } : null;
    case 'sql-warehouse':
      return shown ? { kind: 'sql-warehouse', warehouseId: shown } : null;
    case 'experiment-id': {
      const id = shown || payload?.experimentId || '';
      return id ? { kind: 'experiment', experimentId: id } : null;
    }
    case 'lakebase':
      // A Lakebase autoscaling project has no stable per-project workspace URL,
      // so once a branch is configured the node opens the workspace Apps list --
      // where "Lakebase Postgres" lives -- rather than a guessed instance path.
      return shown ? { kind: 'apps-list' } : null;
    default:
      return null;
  }
}

/**
 * One node card.
 *
 * TWO CONTROLS RATHER THAN ONE, and the split is deliberate. The design makes the
 * whole card the Databricks link; here the card links to this dependency's own
 * row on Connections and the Databricks link is a second, named control beside
 * it. The in-app link is the one that always works -- it needs no host and no
 * identifier, so it exists on a deployment that has reported neither -- and it is
 * where the configured value, the measured value, the drift and the command that
 * changes it already live. A single card-wide target that sometimes leaves the
 * app and sometimes does nothing is a control a reader cannot learn.
 *
 * The card is inert only where BOTH are unavailable, which is the two nodes that
 * are not dependencies at all: the browser and the app server.
 */
/** A node's operational connection verdict, in the shared pill palette. */
function ArchitectureNodeCard({
  node,
  reading,
  payload,
  box,
  checking,
}: {
  node: ArchitectureNode;
  reading: ConnectionReading | undefined;
  payload: ArchitecturePayload | null;
  box: NodeBox;
  checking: boolean;
}) {
  const report = nodeReport(node, reading);
  const value = nodeValue(reading);
  const object = workspaceObject(node, reading, payload);
  const deepLink = object && payload?.workspaceHost ? databricksLink(payload.workspaceHost, object) : null;

  const body = (
    <>
      {/* The product's own mark at the handoff's 18px, left of the title, on
          every node that IS a Databricks product. Which product that is comes
          off the node in architecture.ts, so this draws what the node declares
          and decides nothing. The two nodes with no mark are the two that are
          not products: the reader's browser, and the Node server.

          Decorative -- the label is the next element, and the card's accessible
          name is built from it in nodeAccessibleName. */}
      <span className="arch-node-title">
        {node.product ? <BrandIcon product={node.product} size={18} /> : null}
        <span className="arch-node-label">{node.label}</span>
      </span>
      <span className="arch-node-pills">
        {checking && node.presence === 'connection' ? (
          <AdaptLoader
            as="span"
            announce={false}
            className="arch-node-status-loader"
            label={`Checking ${node.label}`}
          />
        ) : report.label ? (
          <span className={astPill(NODE_FAMILY[report.tone], 'arch-node-status')} data-tone={report.tone}>
            {report.label}
          </span>
        ) : null}
        {reading && reading.marker !== 'none' ? (
          <span
            className={astPill(reading.marker === 'drift' ? 'warn' : 'neutral-outline', 'arch-node-drift')}
            data-drift={reading.marker}
          >
            {DRIFT_MARKER_LABEL[reading.marker]}
            {reading.marker === 'drift' && reading.driftCount > 1 ? ` \u00d7${reading.driftCount}` : ''}
          </span>
        ) : null}
      </span>
      {value ? (
        <span className="arch-node-value" data-measured={value.measured ? 'true' : undefined}>
          {value.value}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className="arch-node"
      data-testid={`arch-node-${node.id}`}
      data-node={node.id}
      data-accent={box.accent}
      data-tone={checking && node.presence === 'connection' ? undefined : report.tone}
      data-checking={checking && node.presence === 'connection' ? 'true' : undefined}
      data-drift={reading && reading.marker !== 'none' ? reading.marker : undefined}
      style={{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px` }}
    >
      {node.resourceId ? (
        <Link
          className="arch-node-main"
          to={entityHref(node.resourceId)}
          aria-label={`${nodeAccessibleName(node, reading, undefined, undefined, checking)}. Open on Connections.`}
        >
          {body}
        </Link>
      ) : (
        <div className="arch-node-main" data-static="true">
          {body}
        </div>
      )}
      <p className="arch-node-role">{node.role}</p>
      {deepLink ? (
        <a className="arch-node-open" href={deepLink} rel="noopener noreferrer" target="_blank">
          {/* The experiment is the one Databricks destination whose product mark
              is a wordmark. Keep it in the action itself, as Monitoring does, so
              every MLflow hyperlink identifies its destination before its copy. */}
          {node.product === 'mlflow' ? <BrandIcon product="mlflow" size={12} /> : null}
          Open in Databricks <ExternalLink className="size-3" aria-hidden="true" />
          <span className="sr-only"> ({node.label})</span>
        </a>
      ) : null}
    </div>
  );
}

/** What each accent means, for the row under the drawing. */
const LEGEND: ReadonlyArray<{ accent: ArchitectureAccent; label: string }> = [
  { accent: 'question', label: 'question path' },
  { accent: 'agent', label: 'the agent' },
  { accent: 'genie', label: 'Genie space' },
  { accent: 'governed', label: 'governed data' },
  { accent: 'kept', label: 'storage' },
];

/**
 * The drawing.
 *
 * Three layers, in this order, and the order is the reason it works: the edges
 * in one SVG, travelling dots on directional flow edges following the SAME path
 * strings, and the cards on top. Hosting topology stays static so it cannot be
 * mistaken for a request direction. The dots are CSS motion paths rather than SVG
 * `<animateMotion>` because SMIL's clock does not run in every embedding context
 * and it ignores `prefers-reduced-motion`; the reduced-motion rule in
 * architecture.css switches these off with `!important`, which is what it takes
 * to beat an inline `animation`.
 *
 * Both animated layers are `aria-hidden`, and that is only defensible because
 * the list after them says everything they do -- see `describeArchitecture`,
 * which is the diagram in words rather than a summary of it.
 *
 * Exported so a test can mount it with readings in hand. The page itself has
 * none until somebody presses Refresh, so a render of the page can only ever
 * assert the unchecked state.
 */
export function ArchitectureCanvas({
  byResource,
  checking = false,
  payload,
  now,
}: {
  byResource: ReadonlyMap<string, ConnectionReading>;
  /** While live checks are active, connection nodes show only their loader. */
  checking?: boolean;
  payload: ArchitecturePayload | null;
  /**
   * The clock the content ages are computed against.
   *
   * Passed in rather than read here, and required rather than defaulted: one
   * value for the whole drawing and its text equivalent, so the card and the
   * sentence describing it cannot land either side of an hour boundary and
   * report different ages for the same timestamp.
   */
  now: number;
}) {
  const edges = useMemo(() => drawnEdges(), []);
  const description = useMemo(() => describeArchitecture(byResource, now, checking), [byResource, checking, now]);

  /**
   * One fixed geometry and one measured number.
   *
   * Scale 1 is the deterministic server/client initial state. The container query
   * below keeps an unscaled canvas from painting at widths where it would clip;
   * in widths where the canvas belongs, the layout effect measures and applies
   * zoom before the browser paints. ResizeObserver handles only later changes.
   */
  const [scale, setScale] = useState(1);
  const responsive = useRef<HTMLDivElement | null>(null);

  useCanvasLayoutEffect(() => {
    const element = responsive.current;
    if (!element) return;
    return observeArchitectureScale(element, setScale);
  }, []);

  return (
    <div className="arch-responsive" data-testid="architecture-responsive" ref={responsive}>
      <div className="arch-canvas-scroll">
        <div
          className="arch-canvas"
          data-testid="architecture-canvas"
          role="group"
          aria-label="Live data flow. Each card links to that dependency on the Connections page."
          style={{
            width: `${CANVAS_WIDTH}px`,
            height: `${CANVAS_HEIGHT}px`,
            // Omitted entirely at full size, so the common case carries no
            // property at all and the rendered markup is the one the geometry
            // checks were written against.
            ...(scale < 1 ? { zoom: scale } : {}),
          }}
        >
          <svg
            className="arch-edges"
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            aria-hidden="true"
            focusable="false"
          >
            {edges.map((edge) => {
              return (
                <g key={edge.id}>
                  <path className="arch-edge" d={edge.d} data-relationship={edge.relationship} />
                  <text className="arch-edge-label" x={edge.labelX} y={edge.labelY} textAnchor={edge.labelAnchor}>
                    {edge.label}
                  </text>
                </g>
              );
            })}
          </svg>
          {edges
            .filter((edge) => edge.relationship === 'flow')
            .map((edge) => (
              <span
                className="arch-dot"
                key={edge.id}
                data-testid={`arch-dot-${edge.id}`}
                aria-hidden="true"
                style={{
                  offsetPath: `path('${edge.d}')`,
                  background: `var(${ACCENT_TOKEN[edge.accent]})`,
                  animationDuration: `${edge.duration}s`,
                  animationDelay: `${edge.delay}s`,
                }}
              />
            ))}
          {ARCHITECTURE_NODES.filter((node) => !node.resourceId || !isAdaptHiddenConnection(node.resourceId)).map(
            (node) => {
              const box = nodeBox(node.id);
              if (!box) return null;
              return (
                <ArchitectureNodeCard
                  box={box}
                  checking={checking}
                  key={node.id}
                  node={node}
                  payload={payload}
                  reading={node.resourceId ? byResource.get(node.resourceId) : undefined}
                />
              );
            }
          )}
        </div>
      </div>

      {/*
        The drawing in words. It is the ONE live tree when a panel is too narrow
        for the canvas; at drawable widths CSS removes it from both visual and
        accessibility trees before exposing the interactive canvas. One list, one
        set of sentences, one clock -- so the narrow arrangement is not a second
        version of the page that nobody checks, which is what the old 1024px
        collapse was.
      */}
      <ul className="arch-equivalent" data-testid="architecture-equivalent">
        {description.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {/* The legend maps a colour to a kind of connection, so it has nothing to
          say when the drawing is not on screen. */}
      <ul className="arch-legend">
        {LEGEND.map((entry) => (
          <li key={entry.accent} data-accent={entry.accent}>
            <span aria-hidden="true" />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One step in a rail, which is a stage of a run rather than a dependency.
 *
 * `stage` is the MLflow stage id, drawn as a mono chip. It is here so a reader can
 * hold this rail against a run in the Run Explorer and match them line for line;
 * before the chain was written down, the two used different names for the same
 * stage and there was no clear mapping from historical trace envelopes to the
 * Orchestrator data-analysis row.
 */
function RailRow({
  accent,
  badge,
  children,
  optional,
  stage,
  title,
}: {
  accent: ArchitectureAccent;
  badge?: string;
  children?: string;
  /** Whether the stage is skipped on a run that does not need it. */
  optional?: boolean;
  stage?: string;
  title: string;
}) {
  return (
    <li className="arch-rail-row" data-accent={accent} data-stage={stage}>
      <p className="arch-rail-title">
        {title}
        {badge ? <span className="arch-rail-badge">{badge}</span> : null}
        {/* Said on the row rather than left to the prose. Three of these stages do
            not run on every question, and a rail drawing six rows for a run that
            had three is a rail that gets read as a fault. */}
        {optional ? (
          <span className="arch-rail-badge" data-optional="true">
            If needed
          </span>
        ) : null}
        {stage ? <code className="arch-rail-stage">{stage}</code> : null}
      </p>
      {children ? <p className="arch-rail-body">{children}</p> : null}
    </li>
  );
}

/** The mono line between two rows, which names what passes between them. */
function RailStep({ label }: { label: string }) {
  return (
    <li className="arch-rail-step" aria-hidden="true">
      {'\u2193'} {label}
    </li>
  );
}

export function ArchitecturePage() {
  const [payload, setPayload] = useState<ArchitecturePayload | null>(null);
  const [payloadError, setPayloadError] = useState('');
  /**
   * The checks, from the one mechanism that runs them.
   *
   * NOT THIS PAGE'S OWN FETCH, and not this page's own decision about when to
   * fetch. `useSessionChecks` runs them once for the session -- on whichever of
   * this page and Connections is opened first -- and hands both pages the same
   * store afterwards. See session-checks.ts for why the automatic run is latched
   * rather than keyed on the store being empty.
   *
   * The page used to hold all of this itself, and probe nothing until Refresh was
   * pressed. That was the defect Sam reported: a tab that opens without
   * operational verdicts down its whole length reads as broken.
   */
  const { session, running: checking, firstLoad, refresh } = useSessionChecks();
  const settings = session?.settings ?? null;
  const report = session?.report ?? null;
  const checkError = session?.error ?? '';
  // The cheap read, and the only one on mount. It costs the app container's own
  // configuration and no round trip to the workspace, which is what lets the
  // info row promise that nothing is checked until somebody asks.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetchWithTimeout('/api/architecture', {}, ARCHITECTURE_DESCRIPTION_TIMEOUT_MS);
        if (!response.ok) throw new Error(`the architecture endpoint answered ${response.status}`);
        const body = (await response.json()) as ArchitecturePayload;
        if (live) setPayload(body);
      } catch (caught) {
        if (live) {
          setPayloadError(
            `The app could not describe its own deployment: ${(caught as Error).message}. ` +
              'The identifiers below are missing.'
          );
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const checks = useMemo(() => report?.checks ?? [], [report]);
  const readings = useMemo(() => readConnections(settings, checks), [settings, checks]);
  const byResource = useMemo(() => readingsById(readings), [readings]);
  const drawn = useMemo(() => drawnReadings(byResource), [byResource]);
  const drifted = drawn.filter((reading) => reading.marker === 'drift');
  // One clock for the tiles, the cards and the sentences under them.
  const now = Date.now();
  /**
   * WHEN THE CHECKS RAN, WHICH IS THE SERVER'S ANSWER AND NOT THIS PAGE'S CLOCK.
   *
   * This used to be `new Date().toISOString()`, set when the two fetches
   * returned. It was already slightly wrong -- it recorded when the answers
   * arrived here rather than when the workspace was asked -- and it was the
   * reason a restored view could not be built without lying: a remembered client
   * timestamp would have been re-stamped on every reopen, so the page would have
   * claimed a check ran at the moment somebody clicked the tab. Both payloads
   * carry the server's own record, so there is nothing to re-stamp. Read in the
   * same order ConnectionsPage reads it, so one run cannot be given two times.
   */
  const checkedAt = checkedAtOf(session);

  return (
    <div className="page-shell architecture-page">
      <div className="page-heading">
        <div>
          <h2>Architecture</h2>
        </div>
        {/* The shared control, on the same clock as the tiles below it, so the
            two cannot report the same instant differently. */}
        <RefreshControl busy={checking} checkedAt={checkedAt} now={now} onRefresh={() => void refresh()} />
      </div>

      {payloadError ? (
        <Alert>
          <CircleAlert />
          <AlertDescription>{payloadError}</AlertDescription>
        </Alert>
      ) : null}

      {checkError ? (
        <Alert data-testid="architecture-check-error">
          <CircleAlert />
          <AlertDescription>{checkError}</AlertDescription>
        </Alert>
      ) : null}

      {drifted.length > 0 ? (
        <Alert data-testid="architecture-drift">
          <CircleAlert />
          <AlertDescription>
            <span>
              <strong>
                {drifted.length === 1
                  ? '1 dependency is not using what it was configured with'
                  : `${drifted.length} dependencies are not using what they were configured with`}
              </strong>
              : {drifted.map((reading) => reading.resource.label).join(', ')}.
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="arch-flow" aria-labelledby="arch-flow-title">
        <div className="arch-flow-head">
          <h3 className="section-label" id="arch-flow-title">
            Live data flow
          </h3>
        </div>
        <ArchitectureDiagramBoundary
          byResource={byResource}
          checking={checking || firstLoad}
          key={`${checkedAt}:${payload?.readAt ?? ''}`}
          now={now}
        >
          <ArchitectureCanvas byResource={byResource} checking={checking || firstLoad} now={now} payload={payload} />
        </ArchitectureDiagramBoundary>
      </section>

      {/*
        THREE RAILS IN TWO COLUMNS, AND WHICH RAIL IS WHICH IS SAID HERE RATHER
        THAN COUNTED IN THE STYLESHEET. `data-rail` is what architecture.css
        places against, so the chain can be given the whole left column and the
        other two can stack down the right one. It also carries the blue eyebrow,
        which used to be selected as `.arch-rail:first-child` -- a rule that means
        "whichever section happens to be written first" and would have followed a
        reordering of this markup onto the wrong heading.

        The order below is the order a reader gets when the columns stack at
        1180px: the chain, then what comes back, then where it is kept. Storage is
        last in both arrangements, which is the reason it is written last rather
        than placed last -- a rail moved into the right column by the stylesheet
        alone would stack in the middle of the pipeline stages.
      */}
      <div className="arch-rails">
        {/*
          THE CHAIN, FROM agent-chain.ts RATHER THAN WRITTEN HERE. This rail used to
          be four hand-written rows describing the run as it was before the chain was
          reworked -- browser, orchestrator, warehouse, browser. It had no approval
          plan, so the plan card a reader meets on their first real question appeared
          to come from nowhere on this page; no step loop and none of the three bounds
          that stop it; and synthesis and charts folded into one row, which hid that
          charts are dropped first when a run is out of budget.

          Generated from the stage list so the names on screen are the agent's own
          span ids. See the note at the top of that module.
        */}
        <section className="arch-rail" data-rail="chain" aria-labelledby="arch-rail-answer">
          <h3 className="section-label" id="arch-rail-answer">
            Chain &middot; per question
          </h3>
          <ol className="arch-rail-rows">
            {AGENT_CHAIN.map((stage, index) => (
              <Fragment key={stage.stage}>
                <RailRow
                  accent={stage.accent}
                  badge={stage.badge}
                  optional={stage.optional}
                  stage={stage.stage}
                  title={stage.title}
                />
                {/* No arrow after the last row: it would point at the section's own
                    bottom edge and name something that is not below it. */}
                {stage.passes && index < AGENT_CHAIN.length - 1 ? <RailStep label={stage.passes} /> : null}
              </Fragment>
            ))}
          </ol>
        </section>

        <section className="arch-rail" data-rail="storage" aria-labelledby="arch-rail-storage">
          <h3 className="section-label" id="arch-rail-storage">
            Storage
          </h3>
          <ol className="arch-rail-rows">
            <RailRow accent="kept" badge="Store" title="Databricks App to Lakebase (Postgres)" />
            {/* Two clauses rather than one sentence with an em-dashed aside in
                the middle of it. §7 has no em dash in it, and the list this one
                interrupted itself to give reads better as its own sentence. */}
            <RailRow accent="kept" badge="Trace" title="Orchestrator to MLflow experiment" />
          </ol>
        </section>
      </div>
    </div>
  );
}
