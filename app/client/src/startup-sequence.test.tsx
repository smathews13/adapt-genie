import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionReport } from '../../shared/session-contract';
import { AccessGate, type GateIdentity } from './AccessGate';
import { FirstOpenGate } from './FirstOpenGate';
import {
  STARTUP_LOGIN_MINIMUM_MS,
  StartupLoadingSurface,
  createStartupLoginDwell,
  startStartupActivity,
  startupCanMountApplication,
  startupPhase,
  startupSurfaceOwner,
  type StartupSnapshot,
} from './StartupBoundary';
import type { Identity } from './app-types';
import { bootstrapAppSession, resetAppSessionForTests } from './app-session';
import { forgetIdentityRequest, identityRequest } from './app-state';
import { forgetFirstOpen } from './first-open';

const startupSource = readFileSync(new URL('./StartupBoundary.tsx', import.meta.url), 'utf8');
const adaptLoadingStyles = readFileSync(new URL('./styles/adapt-loading.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
const indexShell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const base: StartupSnapshot = {
  nativeAuthReturned: false,
  appSession: 'booting',
  identityResolved: false,
  accessDecisionRequired: false,
  applicationReady: false,
  loginDwellComplete: false,
  firstOpen: 'pending',
};

function session(over: Partial<SessionReport> = {}): SessionReport {
  return {
    state: 'current',
    signedIn: true,
    tokenScopes: ['serving.serving-endpoints', 'model-serving', 'sql', 'dashboards.genie'],
    declaredScopes: ['serving.serving-endpoints', 'model-serving', 'sql', 'dashboards.genie'],
    missingScopes: [],
    cause: 'session-current',
    evidence: 'current',
    explanation: 'current',
    remedy: null,
    ...over,
  };
}

function identity(over: Partial<Identity> = {}): Identity {
  return {
    signedInAs: 'reader@example.com',
    executionMode: 'user',
    identitySource: 'databricks-apps',
    session: session(),
    ...over,
  } as Identity;
}

function gateIdentity(over: Partial<GateIdentity> = {}): GateIdentity {
  return {
    signedInAs: 'reader@example.com',
    identitySource: 'databricks-apps',
    executionMode: 'user-verified',
    accessDecision: null,
    servingPrincipal: null,
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetAppSessionForTests();
  forgetIdentityRequest();
  forgetFirstOpen();
});

describe('authoritative startup sequence', () => {
  it('lets the default Ask route complete application readiness', () => {
    expect(appSource).toMatch(/path:\s*['"]\/['"][\s\S]*?<ReadyRoute>[\s\S]*?<HomePage\s*\/>[\s\S]*?<\/ReadyRoute>/);
  });

  it('orders native return, session bootstrap, access resolution, first-open, and readiness', () => {
    const frames: StartupSnapshot[] = [
      base,
      { ...base, nativeAuthReturned: true },
      { ...base, nativeAuthReturned: true, appSession: 'ready' },
      { ...base, nativeAuthReturned: true, appSession: 'ready', identityResolved: true, firstOpen: 'gate' },
      {
        ...base,
        nativeAuthReturned: true,
        appSession: 'ready',
        identityResolved: true,
        applicationReady: true,
        loginDwellComplete: true,
        firstOpen: 'gate',
      },
      {
        ...base,
        nativeAuthReturned: true,
        appSession: 'ready',
        identityResolved: true,
        applicationReady: true,
        loginDwellComplete: true,
        firstOpen: 'open',
      },
    ];

    expect(frames.map(startupPhase)).toEqual([
      'native-auth-pending',
      'app-session-bootstrap',
      'access-bootstrap',
      'application-bootstrap',
      'first-open',
      'application-ready',
    ]);
  });

  it('inserts an access decision before FirstOpen when authorization is required', () => {
    expect(
      startupPhase({
        ...base,
        nativeAuthReturned: true,
        appSession: 'ready',
        identityResolved: true,
        accessDecisionRequired: true,
        applicationReady: true,
        firstOpen: 'gate',
      })
    ).toBe('access-decision');
  });

  it('records bootstrap failures immediately and returns retry to the same loader state', () => {
    expect(startupPhase({ ...base, nativeAuthReturned: true, appSession: 'unavailable' })).toBe('unavailable');
    expect(startupPhase({ ...base, nativeAuthReturned: true, appSession: 'booting' })).toBe('app-session-bootstrap');
  });

  it('keeps every phase under exactly one viewport owner', () => {
    const owners = [
      startupSurfaceOwner('native-auth-pending'),
      startupSurfaceOwner('app-session-bootstrap'),
      startupSurfaceOwner('access-bootstrap'),
      startupSurfaceOwner('application-bootstrap'),
      startupSurfaceOwner('login-dwell'),
      startupSurfaceOwner('access-decision'),
      startupSurfaceOwner('first-open'),
      startupSurfaceOwner('application-ready'),
    ];
    expect(owners).toEqual([
      'loader',
      'loader',
      'loader',
      'loader',
      'loader',
      'access-modal',
      'first-open-modal',
      'application',
    ]);
  });
});

describe('pre-login startup dwell', () => {
  it('keeps the ADAPT loader visible for four seconds when readiness finishes early', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ready = vi.fn();
    const dwell = createStartupLoginDwell(Date.now(), ready);
    dwell.start();

    const waiting: StartupSnapshot = {
      ...base,
      nativeAuthReturned: true,
      appSession: 'ready',
      identityResolved: true,
      applicationReady: true,
      loginDwellComplete: false,
      firstOpen: 'gate',
    };
    expect(STARTUP_LOGIN_MINIMUM_MS).toBe(4_000);
    expect(startupPhase(waiting)).toBe('login-dwell');
    vi.advanceTimersByTime(STARTUP_LOGIN_MINIMUM_MS - 1);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledOnce();
    expect(startupPhase({ ...waiting, loginDwellComplete: true })).toBe('first-open');
  });

  it('cancels and deduplicates the dwell timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ready = vi.fn();
    const dwell = createStartupLoginDwell(Date.now(), ready);
    dwell.start();
    dwell.start();
    expect(vi.getTimerCount()).toBe(1);
    dwell.dispose();
    vi.runAllTimers();
    expect(ready).not.toHaveBeenCalled();
  });
});

describe('frame ownership', () => {
  it('keeps one ADAPT loading mark while startup status advances', () => {
    expect(startupSource.match(/<StartupLoadingSurface/g)).toHaveLength(1);
    for (const phase of [
      'native-auth-pending',
      'app-session-bootstrap',
      'access-bootstrap',
      'application-bootstrap',
    ] as const) {
      const markup = renderToStaticMarkup(<StartupLoadingSurface phase={phase} />);
      expect(markup.match(/data-startup-loader="adapt-primary"/g)).toHaveLength(1);
      expect(markup.match(/class="adapt-loading-mark"/g)).toHaveLength(1);
      expect(markup).toContain('d="M 15 100 L 50 13 L 85 100"');
      expect(markup).not.toContain('ast-flick-slot');
    }
  });

  it('changes permission/readiness copy without mounting a permission animation', () => {
    const access = renderToStaticMarkup(<StartupLoadingSurface phase="access-bootstrap" />);
    const readiness = renderToStaticMarkup(<StartupLoadingSurface phase="application-bootstrap" />);
    expect(access).toContain('Checking access');
    expect(readiness).toContain('Preparing Ask');
    expect(access.match(/class="adapt-loading-mark"/g)).toHaveLength(1);
    expect(access).not.toMatch(/permission.*(?:spin|anim)/i);
  });

  it('renders no protected child or route loader behind the access modal', () => {
    const markup = renderToStaticMarkup(
      <AccessGate enabled preloadedIdentity={gateIdentity()}>
        <div data-testid="route-loading">protected</div>
      </AccessGate>
    );
    expect(markup).toContain('Access check');
    expect(markup).toContain('class="access-gate-panel ast-login-panel ast-dialog-panel"');
    expect(markup).not.toContain('route-loading');
    expect(markup).not.toContain('data-startup-symbol');
  });

  it('renders FirstOpen directly, with no startup or route loader behind it', () => {
    const markup = renderToStaticMarkup(<FirstOpenGate identity={identity()} />);
    expect(markup).toContain('role="dialog"');
    expect(markup).not.toContain('route-loading');
    expect(markup).not.toContain('data-startup-symbol');
    expect(markup).not.toContain('ast-opening');
  });

  it('renders access-denied and unread authorization as stable modal states', () => {
    const missing = renderToStaticMarkup(
      <FirstOpenGate
        identity={identity({ session: session({ state: 'stale', missingScopes: ['dashboards.genie'] }) })}
      />
    );
    const unread = renderToStaticMarkup(
      <FirstOpenGate identity={identity({ session: session({ state: 'undetermined', tokenScopes: null }) })} />
    );
    for (const markup of [missing, unread]) {
      expect(markup).toContain('role="dialog"');
      expect(markup).not.toContain('data-startup-symbol');
      expect(markup.match(/role="dialog"/g)).toHaveLength(1);
    }
  });

  it('keeps the index shell blank and color-stable across native authorization redirects', () => {
    expect(indexShell).toContain('<div id="root"></div>');
    expect(indexShell).not.toContain('data-startup-symbol');
    expect(indexShell).toContain("html[data-theme='dark'] body");
  });

  it('mounts the hidden shell for readiness only after session and access resolve', () => {
    expect(startupCanMountApplication(base)).toBe(false);
    expect(startupCanMountApplication({ ...base, appSession: 'ready', identityResolved: true })).toBe(true);
    expect(
      startupCanMountApplication({
        ...base,
        appSession: 'ready',
        identityResolved: true,
        accessDecisionRequired: true,
      })
    ).toBe(false);
  });

  it('gives timeout sole ownership without mounting stale protected content', () => {
    const expired: StartupSnapshot = {
      ...base,
      nativeAuthReturned: true,
      appSession: 'timed-out',
      identityResolved: true,
      applicationReady: true,
      firstOpen: 'open',
    };

    expect(startupPhase(expired)).toBe('timed-out');
    expect(startupSurfaceOwner(startupPhase(expired))).toBe('session-timeout');
    expect(startupCanMountApplication(expired)).toBe(false);
  });
});

describe('StrictMode replay', () => {
  it('starts activity only while ready and safely cleans up before restart', () => {
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();
    const start = vi.fn().mockReturnValueOnce(stopFirst).mockReturnValueOnce(stopSecond);

    expect(startStartupActivity('booting', start)).toBeUndefined();
    expect(startStartupActivity('unavailable', start)).toBeUndefined();
    const cleanupFirst = startStartupActivity('ready', start);
    expect(start).toHaveBeenCalledTimes(1);
    cleanupFirst?.();
    expect(stopFirst).toHaveBeenCalledTimes(1);
    expect(startStartupActivity('timed-out', start)).toBeUndefined();
    const cleanupSecond = startStartupActivity('ready', start);
    expect(start).toHaveBeenCalledTimes(2);
    cleanupSecond?.();
    expect(stopSecond).toHaveBeenCalledTimes(1);
  });

  it('makes the production startup coordinator own explicit-activity listener cleanup', () => {
    expect(mainSource).toContain('<StartupBoundary>');
    expect(mainSource).not.toContain('<AppSessionBoundary>');
    expect(startupSource).toContain('startExplicitUserActivity');
    expect(startupSource).toContain("return appSession === 'ready' ? start() : undefined;");
    expect(startupSource).toContain('useEffect(() => startStartupActivity(appSession), [appSession]);');
  });

  it('deduplicates app-session bootstrap and identity reads', async () => {
    const bootstrapFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const first = bootstrapAppSession(bootstrapFetch);
    const second = bootstrapAppSession(bootstrapFetch);
    await Promise.all([first, second]);
    expect(bootstrapFetch).toHaveBeenCalledTimes(1);

    const identityFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ signedInAs: 'reader@example.com' }),
    });
    vi.stubGlobal('fetch', identityFetch);
    await Promise.all([identityRequest(), identityRequest()]);
    expect(identityFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a static essential startup indicator available when motion is suppressed', () => {
    const loader = renderToStaticMarkup(<StartupLoadingSurface phase="app-session-bootstrap" />);
    const firstOpen = renderToStaticMarkup(<FirstOpenGate identity={identity()} />);
    expect(loader).toContain('adapt-loading-peak');
    expect(loader).toContain('Starting secure app session');
    expect(firstOpen).not.toContain('ast-anim-');
    expect(startupSource).toContain('AdaptLoadingAnimation');
    expect(startupSource).not.toContain('ConceptFlicker');
    expect(adaptLoadingStyles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
