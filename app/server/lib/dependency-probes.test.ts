import { describe, expect, it, vi } from 'vitest';

import {
  connectionSubjects,
  declaredTables,
  probeConnections,
  probeVerdict,
  runProbes,
  scopeForPath,
  tokenScopeVerdict,
  withManifestRollup,
  type ProbeSubject,
} from './dependency-probes';

/**
 * The rules this page rests on, and every one of them is about a distinction
 * that a lazier reading would collapse.
 *
 * The Connections page promises to report "whether it can reach each one" and,
 * for releases, answered `Not checked` for everything but two things the app
 * probes about itself. The fix is that the app now asks the workspace. The risk
 * the fix introduces is the opposite one: a page full of green ticks that mean
 * less than a reader will take them to mean. So these tests are mostly about
 * what a verdict may NOT say -- that a refusal is not an absence, that a silence
 * is not a refusal, that an unset value is not a fault, and that a metadata read
 * is not a promise about data.
 */

const CONFIGURED = {
  'sql-warehouse': 'wh-0001',
  'genie-data': 'space-data',
  'genie-dictionary': 'space-dictionary',
  catalog: 'a_catalog',
  schema: 'a_schema',
  'llm-endpoint': 'a-model',
  'judge-endpoint': 'a-judge',
};

function subjects(over: Partial<Parameters<typeof connectionSubjects>[0]> = {}) {
  return connectionSubjects({ configured: CONFIGURED, tables: [], ...over });
}

function subjectFor(id: string): ProbeSubject {
  const found = subjects({ tables: ['a_catalog.a_schema.a_table'] }).find((subject) => subject.id === id);
  if (!found) throw new Error(`no subject is built for ${id}`);
  return found;
}

/** A fetch that answers each path from a script, and records what it was asked. */
function scripted(script: Record<string, { status: number; body?: unknown }>) {
  const asked: string[] = [];
  const call = ((url: string) => {
    asked.push(url);
    const path = new URL(url, 'https://workspace.example').pathname;
    const answer = script[path] ?? { status: 404, body: { error_code: 'NOT_FOUND', message: 'no script entry' } };
    return Promise.resolve({
      status: answer.status,
      ok: answer.status >= 200 && answer.status < 300,
      json: () => Promise.resolve(answer.body ?? {}),
    } as Response);
  }) as unknown as typeof fetch;
  return { call, asked };
}

describe('what the workspace said, turned into a verdict', () => {
  // The distinction the whole classifier exists for. Both are failures and they
  // have different remedies: a refusal is fixed with a grant, an absence cannot
  // be, and telling a deployer that a table they can plainly see in the catalog
  // is forbidden sends them to an admin for a permission on nothing.
  it('reads a refusal as an identity that cannot reach it, not as a thing that is missing', () => {
    const verdict = probeVerdict({
      subject: subjectFor('sql-warehouse'),
      outcome: {
        kind: 'answered',
        status: 403,
        body: { error_code: 'PERMISSION_DENIED', message: 'User does not have CAN_USE on warehouse' },
      },
      principal: 'someone@example.com',
    });
    expect(verdict.status).toBe('failed');
    expect(verdict.detail).toMatch(/cannot reach it/i);
    expect(verdict.detail).not.toMatch(/no such object/i);
    // The provider's own code and message, so a reader can act on the answer
    // rather than on this app's paraphrase of it.
    expect(verdict.detail).toContain('403');
    expect(verdict.detail).toContain('PERMISSION_DENIED');
    expect(verdict.error).toContain('CAN_USE');
    // Named, because the answer is about one person's grants and a reader
    // comparing two accounts has to be able to tell which one this is.
    expect(verdict.detail).toContain('someone@example.com');
  });

  it('offers the statement that would fix a refusal, filled in with who was refused', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: { kind: 'answered', status: 403, body: { error_code: 'PERMISSION_DENIED', message: 'denied' } },
      principal: 'someone@example.com',
    });
    expect(verdict.remedy?.kind).toBe('sql');
    expect(verdict.remedy?.statement).toBe('GRANT USE CATALOG ON CATALOG a_catalog TO `someone@example.com`;');
  });

  it('reads a 404 as missing, and offers no grant for a thing that is not there', () => {
    const verdict = probeVerdict({
      subject: subjectFor('table:a_catalog.a_schema.a_table'),
      outcome: {
        kind: 'answered',
        status: 404,
        body: { error_code: 'TABLE_DOES_NOT_EXIST', message: 'Table does not exist.' },
      },
      principal: 'someone@example.com',
    });
    expect(verdict.status).toBe('failed');
    expect(verdict.detail).toMatch(/no such object/i);
    expect(verdict.detail).toMatch(/missing rather than forbidden/i);
    // A remedy that cannot work is how remedies stop being read.
    expect(verdict.remedy).toBeNull();
  });

  // Unity Catalog says PERMISSION_DENIED with codes that vary by object, and has
  // been seen to answer a refusal on a status other than 403. The code decides
  // when it is present, so a refusal cannot be filed as a missing object because
  // of the number in front of it.
  it('believes the error code over the status when the two could disagree', () => {
    const refused = probeVerdict({
      subject: subjectFor('schema'),
      outcome: { kind: 'answered', status: 400, body: { error_code: 'PERMISSION_DENIED', message: 'nope' } },
      principal: '',
    });
    expect(refused.detail).toMatch(/refused this identity/i);

    const missing = probeVerdict({
      subject: subjectFor('schema'),
      outcome: { kind: 'answered', status: 400, body: { error_code: 'SCHEMA_DOES_NOT_EXIST', message: 'gone' } },
      principal: '',
    });
    expect(missing.detail).toMatch(/no such object/i);
  });

  // Unknown is not permission, and it is not refusal either. A timeout that read
  // as `failed` would put a red badge on a healthy dependency and send somebody
  // to fix a grant that was never missing.
  it('reads a timeout as unknown rather than as unreachable', () => {
    const verdict = probeVerdict({
      subject: subjectFor('genie-data'),
      outcome: { kind: 'timeout', afterMs: 15_000 },
      principal: 'someone@example.com',
    });
    expect(verdict.status).toBe('unverified');
    expect(verdict.detail).toMatch(/unknown rather than settled/i);
    expect(verdict.detail).toMatch(/not a refusal/i);
  });

  it('reads a workspace-side error as unknown, because it is not about this object', () => {
    for (const status of [429, 500, 503]) {
      const verdict = probeVerdict({
        subject: subjectFor('llm-endpoint'),
        outcome: { kind: 'answered', status, body: { message: 'busy' } },
        principal: '',
      });
      expect(verdict.status, `HTTP ${status}`).toBe('unverified');
    }
  });

  // Observed against the live workspace: a warehouse id that is not an id at all
  // answers 400 INVALID_PARAMETER_VALUE rather than 404, so a reader sent to
  // check their grants would be looking at the wrong thing entirely.
  it('sends a malformed identifier back to the configured value rather than to an admin', () => {
    const verdict = probeVerdict({
      subject: subjectFor('sql-warehouse'),
      outcome: {
        kind: 'answered',
        status: 400,
        body: { error_code: 'INVALID_PARAMETER_VALUE', message: 'wh-0001 is not a valid endpoint id.' },
      },
      principal: '',
    });
    expect(verdict.status).toBe('failed');
    expect(verdict.detail).toMatch(/malformed identifier/i);
    expect(verdict.remedy).toBeNull();
  });

  it('reads a rejected token as a sign-in problem rather than a resource problem', () => {
    const verdict = probeVerdict({
      subject: subjectFor('llm-endpoint'),
      outcome: { kind: 'answered', status: 401, body: { message: 'invalid token' } },
      principal: '',
    });
    expect(verdict.status).toBe('unverified');
    expect(verdict.detail).toMatch(/sign-in/i);
  });

  // The green tick is the dangerous one, so it has to qualify itself. Reading an
  // object's definition is not reading its rows, and CAN_VIEW on an endpoint is
  // not CAN_QUERY.
  it('never lets a pass stand as an unqualified promise', () => {
    const table = probeVerdict({
      subject: subjectFor('table:a_catalog.a_schema.a_table'),
      outcome: { kind: 'answered', status: 200, body: { columns: [{}, {}] } },
      principal: 'someone@example.com',
    });
    expect(table.status).toBe('ok');
    expect(table.detail).toMatch(/metadata read/i);
    expect(table.detail).toMatch(/row filters and column masks/i);

    const endpoint = probeVerdict({
      subject: subjectFor('llm-endpoint'),
      outcome: { kind: 'answered', status: 200, body: { state: { ready: 'READY' } } },
      principal: '',
    });
    expect(endpoint.detail).toMatch(/CAN_VIEW and CAN_QUERY are separate grants/i);
  });

  it('reports the warehouse’s running state, which is the thing people ask about it', () => {
    const verdict = probeVerdict({
      subject: subjectFor('sql-warehouse'),
      outcome: { kind: 'answered', status: 200, body: { name: 'Reporting', state: 'STOPPED' } },
      principal: '',
    });
    expect(verdict.status).toBe('ok');
    expect(verdict.detail).toContain('state STOPPED');
    // A stopped warehouse is reachable and unusable at the same time, and the
    // check must not let the first hide the second.
    expect(verdict.detail).toMatch(/a stopped warehouse still answers this call/i);
  });
});

describe('which subjects a deployment has at all', () => {
  // The case that makes this load-bearing rather than tidy. `llm_gateway` is
  // unset on every target by design -- empty means "talk to the endpoint
  // directly" -- and a deployment in exactly the shape its bundle asked for must
  // not read as broken.
  it('asks nothing about a resource nothing is configured for, and so reports no failure', () => {
    const built = subjects();
    expect(built.some((subject) => subject.id === 'llm-gateway')).toBe(false);
    expect(built.every((subject) => subject.name !== '')).toBe(true);
  });

  it('leaves an unconfigured resource with no check rather than a failing one', async () => {
    const { call } = scripted({});
    const checks = await probeConnections({
      configured: { ...CONFIGURED, 'sql-warehouse': '' },
      tables: [],
      host: 'https://workspace.example',
      token: 'a-token',
      principal: 'someone@example.com',
      fetchImpl: call,
    });
    expect(checks.some((check) => check.id === 'sql-warehouse')).toBe(false);
  });

  // A gateway is a bare endpoint name on some deployments and a URL on others.
  // Only the first can be asked about here, and a verdict invented for the
  // second would be about something this call never reached.
  it('does not invent a check for a gateway it cannot address', () => {
    const built = connectionSubjects({
      configured: { 'llm-gateway': 'https://gateway.example/v1/routes/chat' },
      tables: [],
    });
    expect(built).toEqual([]);
  });

  it('asks about every table the served version declared', () => {
    const tables = ['a_catalog.a_schema.one', 'a_catalog.a_schema.two'];
    const built = subjects({ tables }).filter((subject) => subject.kind === 'table');
    expect(built.map((subject) => subject.name)).toEqual(tables);
    expect(built[0].path).toBe('/api/2.1/unity-catalog/tables/a_catalog.a_schema.one');
  });

  it('reads the declared manifest out of the orchestrator’s configuration', () => {
    expect(declaredTables([{ key: 'declared_manifest', value: ['a.b.c'] } as never])).toEqual(['a.b.c']);
    expect(declaredTables([])).toEqual([]);
  });

  it('asks each object the cheapest question that settles it', () => {
    const paths = Object.fromEntries(subjects().map((subject) => [subject.id, subject.path]));
    expect(paths['sql-warehouse']).toBe('/api/2.0/sql/warehouses/wh-0001');
    expect(paths['genie-data']).toBe('/api/2.0/genie/spaces/space-data');
    expect(paths.catalog).toBe('/api/2.1/unity-catalog/catalogs/a_catalog');
    expect(paths.schema).toBe('/api/2.1/unity-catalog/schemas/a_catalog.a_schema');
    expect(paths['llm-endpoint']).toBe('/api/2.0/serving-endpoints/a-model');
    expect(paths['judge-endpoint']).toBe('/api/2.0/serving-endpoints/a-judge');
  });
});

describe('running them', () => {
  /**
   * CONCURRENTLY, which is the difference between a page and a wait.
   *
   * A deployment with twelve declared tables plus its warehouse, spaces,
   * catalog, schema, models and index is twenty-odd round trips. Run in
   * sequence, one warehouse waking up holds every other answer behind it and
   * the page a person opened to find out why their deployment is unwell is the
   * slowest page in the app.
   */
  it('asks everything at once rather than one after another', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const call: typeof fetch = vi.fn(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<Response>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve({ status: 200, ok: true, json: () => Promise.resolve({}) } as Response);
        });
      });
    });

    const built = subjects({ tables: ['a.b.one', 'a.b.two', 'a.b.three'] });
    const running = runProbes(built, {
      host: 'https://workspace.example',
      token: 'a-token',
      principal: 'someone@example.com',
      fetchImpl: call,
    });
    // Every probe is already waiting on the network before any of them has been
    // answered, which is only true if none of them waited for another.
    await Promise.resolve();
    expect(peak).toBe(built.length);
    release.forEach((finish) => finish());
    expect(await running).toHaveLength(built.length);
  });

  it('honours a bounded concurrency for a forced health run', async () => {
    let inFlight = 0;
    let peak = 0;
    const call: typeof fetch = vi.fn(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          resolve({ status: 200, ok: true, json: () => Promise.resolve({}) } as Response);
        }, 2);
      });
    });
    const built = subjects({ tables: ['a.b.one', 'a.b.two', 'a.b.three', 'a.b.four'] });
    const checks = await runProbes(built, {
      host: 'https://workspace.example',
      token: 'a-token',
      principal: 'someone@example.com',
      fetchImpl: call,
      concurrency: 3,
    });
    expect(checks).toHaveLength(built.length);
    expect(peak).toBe(3);
  });

  it('times out one slow resource without blocking the settled results for the rest', async () => {
    const call: typeof fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (!href.includes('/genie/')) {
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) } as Response);
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          { once: true }
        );
      });
    });
    const built = subjects();
    const checks = await runProbes(built, {
      host: 'https://workspace.example',
      token: 'a-token',
      principal: 'someone@example.com',
      fetchImpl: call,
      concurrency: 4,
      timeoutMs: 5,
    });
    expect(checks).toHaveLength(built.length);
    expect(checks.find((check) => check.id === 'genie-data')?.status).toBe('unverified');
    expect(checks.filter((check) => check.status === 'ok').length).toBeGreaterThan(0);
  });

  /**
   * ONE PROBE MAY NOT DECIDE WHETHER THE OTHER TWENTY ARE REPORTED.
   *
   * `/api/settings` is one of the diagnostics that has to keep answering while
   * the rest of the API refuses, because it is what somebody opens to find out
   * why. A thrown probe that took the route down would remove the page at
   * exactly the moment it is worth having.
   */
  it('lets one probe blow up without losing the others', async () => {
    const call = ((url: string) => {
      if (url.includes('/genie/')) throw new Error('the socket exploded');
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) } as Response);
    }) as unknown as typeof fetch;

    const built = subjects();
    const checks = await runProbes(built, {
      host: 'https://workspace.example',
      token: 'a-token',
      principal: 'someone@example.com',
      fetchImpl: call,
    });
    expect(checks).toHaveLength(built.length);
    const genie = checks.find((check) => check.id === 'genie-data');
    // Unknown, not failed: a call that never completed established nothing
    // about the thing it was asking about.
    expect(genie?.status).toBe('unverified');
    expect(genie?.error).toContain('the socket exploded');
    expect(checks.filter((check) => check.status === 'ok').length).toBeGreaterThan(0);
  });
});

describe('when the app cannot ask at all', () => {
  // The app runs on behalf of the signed-in user, so a reachability answer taken
  // under a service principal would describe somebody who is not reading the
  // page. Reported rather than skipped: a check silently omitted is
  // indistinguishable from one that passed.
  it('says nobody asked, rather than reporting a failure, without a user token', async () => {
    const checks = await probeConnections({
      configured: CONFIGURED,
      tables: [],
      host: 'https://workspace.example',
      token: null,
      principal: '',
    });
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((check) => check.status === 'unverified')).toBe(true);
    expect(checks[0].detail).toMatch(/no signed-in user token/i);
    expect(checks[0].detail).toMatch(/nobody asked/i);
  });

  it('says so when the container does not know which workspace it is in', async () => {
    const checks = await probeConnections({
      configured: CONFIGURED,
      tables: [],
      host: '',
      token: 'a-token',
      principal: '',
    });
    expect(checks.every((check) => check.status === 'unverified')).toBe(true);
    expect(checks[0].detail).toMatch(/DATABRICKS_HOST/);
  });
});

/**
 * The deployment this page is going in front of reviewers on, with the answers
 * its workspace actually gives.
 *
 * The values and the payload shapes here were taken from the live workspace
 * rather than invented, which is the point: `observe` reads two fields out of
 * each response, and a field that is nested one level deeper than assumed
 * produces a check that passes while saying nothing.
 */
describe('the live deployment, as the workspace answers it', () => {
  const LIVE = {
    'sql-warehouse': '9cd919d96b11bf1c',
    'genie-data': '01f18f74e0521324a7eb374c4396ab2e',
    catalog: 'a_catalog',
    'llm-endpoint': 'databricks-claude-sonnet-4-6',
  };

  it('reads the two fields worth reporting out of each real payload', async () => {
    const { call } = scripted({
      '/api/2.0/sql/warehouses/9cd919d96b11bf1c': {
        status: 200,
        body: { name: 'Apps & Agents Warehouse', state: 'STOPPED' },
      },
      '/api/2.0/genie/spaces/01f18f74e0521324a7eb374c4396ab2e': {
        status: 200,
        body: { title: 'ADAPT Data' },
      },
      '/api/2.1/unity-catalog/catalogs/a_catalog': { status: 200, body: { owner: 'someone@example.com' } },
      '/api/2.0/serving-endpoints/databricks-claude-sonnet-4-6': {
        status: 200,
        body: { state: { ready: 'READY', config_update: 'NOT_UPDATING' } },
      },
    });
    const checks = await probeConnections({
      configured: LIVE,
      tables: [],
      host: 'https://workspace.example',
      token: 'a-token',
      principal: 'someone@example.com',
      fetchImpl: call,
    });
    const detail = (id: string) => checks.find((entry) => entry.id === id)?.detail ?? '';

    expect(checks.every((entry) => entry.status === 'ok')).toBe(true);
    // A warehouse that is asleep answers this call, which is why its state is
    // reported rather than left for somebody to discover when a query hangs.
    expect(detail('sql-warehouse')).toContain('state STOPPED');
    expect(detail('genie-data')).toContain('ADAPT Data');
    expect(detail('catalog')).toContain('owned by someone@example.com');
    expect(detail('llm-endpoint')).toContain('state READY');
  });
});

describe('objects without stored content', () => {
  it('leaves every object that serves nothing rebuilt without an age', async () => {
    // A warehouse reads through to the tables when it is asked. There is no
    // copy to be out of date, so a freshness clause on it would be a fact about
    // nothing, and a field readers would learn to ignore.
    const { call } = scripted({
      '/api/2.0/sql/warehouses/wh-0001': { status: 200, body: { name: 'A warehouse', state: 'RUNNING' } },
    });
    const checks = await probeConnections({
      configured: { 'sql-warehouse': 'wh-0001' },
      tables: [],
      host: 'https://workspace.example',
      token: 'a-token',
      principal: 'someone@example.com',
      fetchImpl: call,
    });
    const warehouse = checks.find((entry) => entry.id === 'sql-warehouse');
    expect(warehouse?.status).toBe('ok');
    expect(warehouse?.display_name).toBe('A warehouse');
    expect(warehouse?.content_at ?? '').toBe('');
    expect(warehouse?.detail).not.toContain('content from its source');
  });
});

describe('the one row that stands for the whole table list', () => {
  const table = (id: string, status: 'ok' | 'failed' | 'unverified') => ({
    id,
    kind: 'table',
    name: id,
    label: id,
    status,
    detail: '',
    checked_with: '',
    duration_ms: 0,
    error: '',
    remedy: null,
  });

  it('passes only when every declared table answered', () => {
    const rolled = withManifestRollup([table('a', 'ok'), table('b', 'ok')]);
    const manifest = rolled.find((check) => check.id === 'declared-manifest');
    expect(manifest?.status).toBe('ok');
    expect(manifest?.detail).toMatch(/row filters and column masks/i);
  });

  it('fails when any of them was refused, and says how many', () => {
    const rolled = withManifestRollup([table('a', 'ok'), table('b', 'failed'), table('c', 'failed')]);
    const manifest = rolled.find((check) => check.id === 'declared-manifest');
    expect(manifest?.status).toBe('failed');
    expect(manifest?.detail).toContain('2 of 3');
  });

  // A table nobody could ask about is not a table that answered. Rolling an
  // unknown up into a pass is how twelve half-answers become one green line.
  it('is unconfirmed rather than clear when one of them did not answer', () => {
    const rolled = withManifestRollup([table('a', 'ok'), table('b', 'unverified')]);
    expect(rolled.find((check) => check.id === 'declared-manifest')?.status).toBe('unverified');
  });

  it('carries no name, because it summarises a list rather than reaching an object', () => {
    const rolled = withManifestRollup([table('a', 'ok')]);
    expect(rolled.find((check) => check.id === 'declared-manifest')?.name).toBe('');
  });

  it('adds nothing at all to a deployment that declared no tables', () => {
    expect(withManifestRollup([])).toEqual([]);
  });

  /**
   * THE PERMISSION IT INHERITED, and only from a list that agrees.
   *
   * This row summarises twelve tables, so on the deployment where one optional
   * catalog read stops all twelve it is a thirteenth entry in the same shortfall.
   * Without the name it landed in "What to fix" on its own, under a sentence
   * saying no statement can fix it, beside a neutral line saying the same twelve
   * checks were nothing to worry about.
   */
  const refusedTable = (id: string, scope: string) => ({
    ...table(id, 'unverified' as const),
    stopped: 'refused' as const,
    scope,
  });

  it('carries the permission when every table it summarises named the same one', () => {
    const rolled = withManifestRollup([
      refusedTable('a', 'catalog.tables:read'),
      refusedTable('b', 'catalog.tables:read'),
    ]);
    const manifest = rolled.find((check) => check.id === 'declared-manifest');
    expect(manifest?.stopped).toBe('refused');
    expect(manifest?.scope).toBe('catalog.tables:read');
  });

  /**
   * A ROW THAT STATES ONE THING ABOUT TWELVE may only carry what the twelve agree
   * on. A mixed list would have this row implicating a permission most of its
   * members were never refused over, and a partly-optional list is not an optional
   * one.
   */
  it('names no permission when the tables did not agree on one', () => {
    const mixed = withManifestRollup([refusedTable('a', 'catalog.tables:read'), table('b', 'unverified')]);
    expect(mixed.find((check) => check.id === 'declared-manifest')?.scope ?? '').toBe('');

    const someAnswered = withManifestRollup([refusedTable('a', 'catalog.tables:read'), table('b', 'ok')]);
    expect(someAnswered.find((check) => check.id === 'declared-manifest')?.scope ?? '').toBe('');
  });

  /**
   * And never over a failure. A failure was established about the object, so no
   * shortfall in an optional permission accounts for it, and a surface that read
   * the scope off this row would hide a real finding.
   */
  it('names no permission when any table failed outright', () => {
    const rolled = withManifestRollup([refusedTable('a', 'catalog.tables:read'), table('b', 'failed')]);
    const manifest = rolled.find((check) => check.id === 'declared-manifest');
    expect(manifest?.status).toBe('failed');
    expect(manifest?.scope ?? '').toBe('');
  });
});

/**
 * The 403 that was read as the wrong thing, and the tests that keep it read
 * correctly.
 *
 * A live release reported the catalog, the schema, and all twelve declared tables
 * as refused, and printed a `GRANT SELECT` for each -- to
 * a reader who had spent the evening querying every one of them from a notebook.
 * None of them was a grant problem. The app had never declared the Unity
 * Catalog browse scopes, so the forwarded token could not call those
 * APIs at all, and a refusal that was about the APP was reported as a fact about
 * the READER.
 *
 * The cost was not the red rows. It was the remedy: twenty-odd confident,
 * actionable, wrong instructions, each of which would have granted a permission
 * the reader already held and changed nothing. So what these tests mostly pin is
 * what must NOT be printed.
 */
describe('telling three kinds of 403 apart', () => {
  /** A JWT the scope reader can actually parse, carrying exactly these scopes. */
  function tokenWith(scopes: string[]): string {
    const claims = Buffer.from(JSON.stringify({ scope: scopes.join(' ') })).toString('base64url');
    return `header.${claims}.signature`;
  }

  const SCOPE_REFUSAL = 'Provided OAuth token does not have required scopes: widgets.read [Reqid: abc123]';

  /** The three catalog scopes, which is what the live deployment declares. */
  const DECLARES_CATALOG = [
    'sql',
    'dashboards.genie',
    'catalog.catalogs:read',
    'catalog.schemas:read',
    'catalog.tables:read',
  ];

  /**
   * WHICH OF THE TWO IT IS COMES FROM THE DECLARED LIST.
   *
   * The version of this that cost an afternoon printed the same four steps for
   * both cases, led with "it is the app that is short of a scope", and had read
   * nothing that could tell them apart. Three of the four steps were already
   * done on the deployment the reader was looking at.
   *
   * These three tests are the separation. The input that decides it is
   * `declaredScopes`, and nothing else in the call changes between them.
   */
  it('sends the reader to a fresh sign-in when the app does declare the scope', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: { kind: 'answered', status: 403, body: {} },
      principal: 'sam@example.com',
      tokenScopes: ['sql', 'dashboards.genie'],
      declaredScopes: DECLARES_CATALOG,
    });

    expect(verdict.status).toBe('unverified');
    // Something the reader does, in their own browser. Not a command, and not
    // an admin's job: this is the case where nobody else has anything to do.
    expect(verdict.remedy?.kind).toBe('ui');
    expect(verdict.remedy?.statement).toMatch(/private browsing window/i);
    expect(verdict.remedy?.statement ?? '').not.toMatch(/\bGRANT\b/i);
    // NOT the bundle edit and NOT the restart. Both were already done here, and
    // printing them is what sent somebody round the same loop a second time.
    expect(verdict.remedy?.statement ?? '').not.toMatch(/apps stop|databricks\.yml/);
    // Signing out of the workspace does not clear this app's own sign-in, so
    // the step that says to must never come back as the instruction.
    expect(verdict.remedy?.statement ?? '').not.toMatch(/sign out/i);
    expect(verdict.detail).toMatch(/does not carry `catalog\.catalogs:read`/i);
  });

  /**
   * The branch that must not guess. Without the declared list there is no way
   * to tell a sign-in that is behind from a permission the app never asked for,
   * and the two remedies contradict each other: one is a private window, the
   * other is a bundle edit and a restart. Printing either is the original bug.
   */
  it('offers nothing at all when it was not told what the app declares', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: { kind: 'answered', status: 403, body: {} },
      principal: 'sam@example.com',
      tokenScopes: ['sql', 'dashboards.genie'],
      declaredScopes: null,
    });

    expect(verdict.status).toBe('unverified');
    expect(verdict.remedy).toBeNull();
    expect(verdict.detail).toMatch(/not told what it declares/i);
    // The retired sentence, pinned by its own words so it cannot come back in
    // the branch that has the least evidence of all.
    expect(verdict.detail).not.toMatch(/short of a scope/i);
  });

  /**
   * The case that made the whole page wrong. Unity Catalog answered the same
   * scope refusal with a bare `HTTP 403` -- no code, no message, nothing to read
   * -- so the response alone cannot settle it. The token can: it carries its own
   * scope claim, and a call refused for a scope it demonstrably does not hold is
   * a scope problem with evidence rather than a guess.
   */
  it('uses the token itself when the workspace refuses without saying why', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: { kind: 'answered', status: 403, body: {} },
      principal: 'sam@example.com',
      tokenScopes: ['sql', 'dashboards.genie'],
      declaredScopes: DECLARES_CATALOG,
    });

    expect(verdict.status).toBe('unverified');
    expect(verdict.remedy?.statement ?? '').not.toMatch(/\bGRANT\b/i);
    // Names the evidence, so a reader can tell a deduction from an assumption.
    expect(verdict.detail).toMatch(/does not carry `catalog\.catalogs:read`/i);
  });

  /**
   * The token is read in the OAuth server's vocabulary, not the bundle's.
   *
   * `tokenScopes` here is what a real forwarded token says. The OAuth server
   * mints the claim, so it spells the catalog family `unity-catalog` -- a name
   * the Apps API will not even accept in `user_api_scopes`. Compare the two
   * literally and this row flips to a scope remedy on a token that carries the
   * scope, which is the original bug with the sign reversed.
   */
  it('still answers a genuine missing grant with the grant, when the scope is ruled out', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: { kind: 'answered', status: 403, body: { error_code: 'PERMISSION_DENIED', message: 'denied' } },
      principal: 'sam@example.com',
      tokenScopes: ['unity-catalog', 'sql'],
    });

    expect(verdict.status).toBe('failed');
    expect(verdict.remedy?.kind).toBe('sql');
    expect(verdict.remedy?.statement).toBe('GRANT USE CATALOG ON CATALOG a_catalog TO `sam@example.com`;');
    // The scope being present is stated, because it is the reason a GRANT is
    // the right answer here and was the wrong one on the rows above.
    expect(verdict.detail).toMatch(/does carry `catalog\.catalogs:read`/);
  });

  /**
   * The fourth kind of 403, and the one the declared list alone got wrong.
   *
   * Everything above turns on what the APP asks for. This turns on what the
   * SIGN-IN presented: the app declares the scope, the token enumerates it, and
   * the workspace refused anyway. Deciding from the declared list alone made that
   * "your sign-in does not carry `catalog.catalogs:read`" over a token that
   * plainly listed it, and sent the reader to a private window that mints the
   * same permission and meets the same refusal. A held scope rules the scope out,
   * which leaves the grant, so the row is a failure with the statement behind it.
   */
  it('answers a refusal over a scope the sign-in does carry with the grant, not a sign-in', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: {
        kind: 'answered',
        status: 403,
        body: { message: 'Provided OAuth token does not have required scopes: unity-catalog [Reqid: abc123]' },
      },
      principal: 'sam@example.com',
      // The OAuth server's spelling of the catalog family, which is what a real
      // forwarded token carries. Compared literally it looks like an absence.
      tokenScopes: ['unity-catalog', 'sql'],
      declaredScopes: DECLARES_CATALOG,
    });

    // `failed` rather than `unverified`: a refusal that cannot be about the
    // scope did establish that this identity cannot reach the object.
    expect(verdict.status).toBe('failed');
    expect(verdict.remedy?.kind).toBe('sql');
    expect(verdict.remedy?.statement).toBe('GRANT USE CATALOG ON CATALOG a_catalog TO `sam@example.com`;');
    // The evidence for preferring the grant, said rather than implied.
    expect(verdict.detail).toMatch(/carries `catalog\.catalogs:read`/i);
    expect(verdict.detail).toMatch(/grant on the object/i);
    // The two sentences that were wrong here, pinned by their own words.
    expect(verdict.detail).not.toMatch(/does not carry/i);
    expect(verdict.remedy?.statement ?? '').not.toMatch(/private browsing window/i);
  });

  /**
   * Absence of a scope claim is not absence of the scope, in the prose as well
   * as in the classifier. A workspace that named the scope settles that this is
   * a scope refusal; a token that enumerated nothing settles nothing about whose
   * problem it is. The private window is still offered, because it is the cheaper
   * of the two candidates to rule out and its own note refuses to guess between
   * them, but the sentence may not tell the reader their sign-in is short.
   */
  it('does not tell a reader their sign-in lacks a scope no token was read for', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: {
        kind: 'answered',
        status: 403,
        body: { message: 'Provided OAuth token does not have required scopes: unity-catalog [Reqid: abc123]' },
      },
      principal: 'sam@example.com',
      // A PAT or an opaque token. It enumerates nothing.
      tokenScopes: null,
      declaredScopes: DECLARES_CATALOG,
    });

    expect(verdict.status).toBe('unverified');
    expect(verdict.remedy?.kind).toBe('ui');
    expect(verdict.remedy?.statement).toMatch(/private browsing window/i);
    expect(verdict.detail).toMatch(/was not established/i);
    // Both candidates named, since neither was ruled out.
    expect(verdict.detail).toMatch(/grant you are missing/i);
    expect(verdict.detail).not.toMatch(/Your sign-in to this app does not carry/i);
  });

  /**
   * WHICH PERMISSION, AS A VALUE, so a surface does not have to read the sentence.
   *
   * The Connections panel is headed "What to fix" and drew every refusal in it,
   * including the three catalog reads `shared/optional-user-api-scopes.ts` records
   * as optional. Telling those apart from a real finding needs the permission as
   * data: matching the prose would be a third copy of a scope vocabulary that has
   * already gone wrong twice here, once in each direction.
   */
  it('records the permission a scope refusal turned on, in the name the bundle uses', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: { kind: 'answered', status: 403, body: {} },
      principal: 'sam@example.com',
      tokenScopes: ['sql', 'dashboards.genie'],
      declaredScopes: DECLARES_CATALOG,
    });

    expect(verdict.stopped).toBe('refused');
    // The Apps-API spelling, which is what `user_api_scopes` and the optional set
    // are written in. The workspace's own coarse `unity-catalog` would match
    // nothing there.
    expect(verdict.scope).toBe('catalog.catalogs:read');
  });

  /**
   * AND NOT ON THE REFUSAL THAT RULED THE SCOPE OUT. The token carries the
   * permission and the workspace refused anyway, so what was established is a
   * grant on the object. Carrying the scope name here would let a surface treat a
   * real, established failure as a shortfall in an optional permission and hide
   * it, which is the one way this field can do damage.
   */
  it('names no permission on a refusal the token itself ruled the scope out of', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: {
        kind: 'answered',
        status: 403,
        body: { message: 'PERMISSION_DENIED: does not have permission on catalog' },
      },
      principal: 'sam@example.com',
      tokenScopes: ['sql', 'unity-catalog'],
      declaredScopes: DECLARES_CATALOG,
    });

    expect(verdict.status).toBe('failed');
    expect(verdict.scope ?? '').toBe('');
  });

  it('treats `all-apis` as covering every scope rather than as covering none', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: { kind: 'answered', status: 403, body: {} },
      principal: 'sam@example.com',
      tokenScopes: ['all-apis'],
    });

    expect(verdict.status).toBe('failed');
    expect(verdict.remedy?.kind).toBe('sql');
  });

  /**
   * The honest answer, and the one worth defending against a reviewer who reads
   * it as a gap. A bare 403 on a token that did not enumerate its scopes is two
   * candidates and no evidence, and the two are fixed by different people. Both
   * remedies were available to print; printing either is a coin toss dressed as
   * an instruction, and the last one cost an evening.
   */
  it('says it cannot tell, rather than picking the likelier of the two', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: { kind: 'answered', status: 403, body: {} },
      principal: 'sam@example.com',
      tokenScopes: null,
    });

    expect(verdict.status).toBe('unverified');
    expect(verdict.remedy).toBeNull();
    expect(verdict.detail).toMatch(/one of two things and this cannot tell which/i);
    expect(verdict.detail).toMatch(/lacks a grant/i);
    expect(verdict.detail).toMatch(/lacks the `catalog\.catalogs:read` scope/i);
  });

  // A token that did not say is not a token that said no. An opaque token or a
  // PAT enumerates nothing, and reading that silence as an absent scope replaces
  // one confident wrong remedy with another pointing the other way.
  it('does not invent a missing scope from a token that enumerated none', () => {
    const opaque = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: { kind: 'answered', status: 403, body: { error_code: 'PERMISSION_DENIED', message: 'denied' } },
      principal: 'sam@example.com',
      tokenScopes: null,
    });

    expect(opaque.status).toBe('failed');
    expect(opaque.remedy?.kind).toBe('sql');
  });

  it('reads the scopes off the forwarded token end to end, not just in the classifier', async () => {
    const { call } = scripted({
      '/api/2.1/unity-catalog/catalogs/a_catalog': { status: 403, body: {} },
    });
    const checks = await probeConnections({
      configured: { catalog: 'a_catalog' },
      tables: [],
      host: 'https://workspace.example',
      token: tokenWith(['sql', 'dashboards.genie']),
      principal: 'sam@example.com',
      fetchImpl: call,
    });

    const catalog = checks.find((entry) => entry.id === 'catalog');
    expect(catalog?.status).toBe('unverified');
    expect(catalog?.remedy?.statement ?? '').not.toMatch(/\bGRANT\b/i);
  });

  // The blast radius of the original bug, as one assertion. Every subject this
  // deployment probes, refused the way the live workspace refused them, must
  // produce no GRANT anywhere on the page.
  it('prints no GRANT anywhere on a page refused entirely for scopes', async () => {
    const everything = subjects({ tables: ['a_catalog.a_schema.a_table'] });
    const refused = Object.fromEntries(
      everything.map((subject) => [subject.path, { status: 403, body: { message: SCOPE_REFUSAL } }])
    );
    const checks = await probeConnections({
      configured: CONFIGURED,
      tables: ['a_catalog.a_schema.a_table'],
      host: 'https://workspace.example',
      token: 'a-token',
      principal: 'sam@example.com',
      fetchImpl: scripted(refused).call,
    });

    const grants = checks.filter((check) => /\bGRANT\b/i.test(check.remedy?.statement ?? ''));
    expect(grants.map((check) => check.id)).toEqual([]);
  });
});

/**
 * The scope map, which is the half that stops this recurring.
 *
 * The diagnosis above makes a missing scope legible. This makes it hard to
 * introduce: a probe against an API family nobody has mapped reports no scope,
 * and `user-api-scopes.test.ts` fails the build on it rather than waiting for a
 * customer to find twenty red rows.
 */
describe('the scope each probe needs', () => {
  it('maps every subject this deployment probes to a scope', () => {
    const unmapped = subjects({ tables: ['a_catalog.a_schema.a_table'] })
      .filter((subject) => scopeForPath(subject.path) === '')
      .map((subject) => `${subject.id} (${subject.path})`);
    expect(unmapped).toEqual([]);
  });

  it('takes the most specific family, so a general prefix cannot swallow a narrower one', () => {
    expect(scopeForPath('/api/2.1/unity-catalog/tables/a.b.c')).toBe('catalog.tables:read');
    expect(scopeForPath('/api/2.0/sql/warehouses/wh-1')).toBe('sql');
  });

  // '' is the finding the pinning test reads, so it must stay a finding rather
  // than quietly resolving to something plausible.
  it('reports an unmapped path as unmapped rather than guessing at one', () => {
    expect(scopeForPath('/api/2.0/some-api-nobody-mapped/thing')).toBe('');
  });
});

/**
 * READING A TOKEN'S SILENCE, WHICH IS THE HALF THAT WAS OVER-CONFIDENT.
 *
 * The alias table has eight pairs in it and is the only thing standing between
 * "the token spells it `unity-catalog`" and "the bundle spells it
 * `catalog.tables:read`". It holds for the two vocabularies we have seen. It is
 * a hardcoded list, and the OAuth server is free to mint a third spelling on
 * some other workspace, at which point the old code read a token that carried
 * the scope as a token that lacked it and printed a remedy on the strength of
 * it. Absence is only evidence when the vocabulary is one we speak.
 */
describe('what a token\u2019s scope list does and does not establish', () => {
  it('reads the OAuth family as carrying the fine-grained scope it stands for', () => {
    expect(tokenScopeVerdict(['unity-catalog', 'sql'], 'catalog.tables:read')).toBe(true);
    expect(tokenScopeVerdict(['all-apis'], 'catalog.tables:read')).toBe(true);
  });

  it('reads a genuine absence as an absence, when every name it holds is one we know', () => {
    expect(tokenScopeVerdict(['sql', 'dashboards.genie'], 'catalog.tables:read')).toBe(false);
    // The OIDC scopes every forwarded token carries are not an API vocabulary,
    // so their presence must not stand the inference down for everything.
    expect(tokenScopeVerdict(['sql', 'openid', 'profile', 'email', 'offline_access'], 'catalog.tables:read')).toBe(
      false
    );
  });

  /**
   * The point of the three-valued answer. `catalog` is not in the table, and it
   * is exactly what a third spelling of the catalog family would look like. The
   * honest answer is that this cannot tell, which costs the row its remedy and
   * leaves it undetermined. An undetermined row sends nobody anywhere; a
   * confidently wrong one cost an afternoon.
   */
  it('stands down rather than claiming absence, on a spelling it has not been taught', () => {
    expect(tokenScopeVerdict(['catalog', 'sql'], 'catalog.tables:read')).toBeNull();
  });

  // An unrecognised name about something else entirely is not a spelling of
  // this scope, and treating it as one would disable the inference on every
  // token the moment Databricks adds any new API family.
  it('is not disarmed by an unfamiliar name that has nothing to do with the scope asked about', () => {
    expect(tokenScopeVerdict(['sql', 'some-future-api:read'], 'catalog.tables:read')).toBe(false);
  });

  // The stronger witness is untouched. A workspace that names the scope in its
  // own refusal needs no vocabulary of ours to be believed.
  it('leaves the refusal-wording witness alone, which needs no table at all', () => {
    const verdict = probeVerdict({
      subject: subjectFor('catalog'),
      outcome: {
        kind: 'answered',
        status: 403,
        body: { message: 'Provided OAuth token does not have required scopes: unity-catalog' },
      },
      principal: 'sam@example.com',
      // The spelling this module has not been taught, on the token itself.
      tokenScopes: ['catalog'],
      declaredScopes: ['catalog.catalogs:read'],
    });
    expect(verdict.status).toBe('unverified');
    expect(verdict.remedy?.kind).toBe('ui');
  });
});
