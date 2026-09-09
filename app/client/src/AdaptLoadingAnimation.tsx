import { useEffect, useRef, useState, type ReactNode } from 'react';

const ADAPT_LOADING_MESSAGES = [
  'Preparing Ask',
  'Gathering context',
  'Analyzing your data',
  'Composing answer',
] as const;

const ADAPT_LOADING_CYCLE_MS = 2_400;
const ADAPT_LOADING_CROSSFADE_MS = 320;

export function AdaptLoadingAnimation({
  variant = 'startup',
  label,
  elapsed,
}: {
  variant?: 'startup' | 'ask';
  label?: string;
  elapsed?: string | null;
}) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [crossfading, setCrossfading] = useState(false);
  const swapTimer = useRef<number | undefined>(undefined);
  const cycleMessages = variant === 'startup' && !label;

  useEffect(() => {
    if (!cycleMessages) return;
    const cycleTimer = window.setInterval(() => {
      setCrossfading(true);
      swapTimer.current = window.setTimeout(() => {
        setMessageIndex((current) => (current + 1) % ADAPT_LOADING_MESSAGES.length);
        setCrossfading(false);
      }, ADAPT_LOADING_CROSSFADE_MS);
    }, ADAPT_LOADING_CYCLE_MS);

    return () => {
      window.clearInterval(cycleTimer);
      if (swapTimer.current !== undefined) window.clearTimeout(swapTimer.current);
    };
  }, [cycleMessages]);

  const status = label ?? ADAPT_LOADING_MESSAGES[messageIndex];

  return (
    <div className={`adapt-loading${variant === 'ask' ? ' adapt-loading--ask' : ''}`} aria-hidden="true">
      <svg
        className="adapt-loading-mark"
        viewBox="0 0 100 112"
        width={variant === 'ask' ? 72 : 116}
        height={variant === 'ask' ? 81 : 130}
      >
        <circle className="adapt-loading-ring" cx="50" cy="11" r="8.5" />
        <path className="adapt-loading-peak" pathLength="100" d="M 15 100 L 50 13 L 85 100" />
        <circle className="adapt-loading-dot" cx="50" cy="11" r="8.5" />
        <path className="adapt-loading-bar" pathLength="28" d="M 36 66 L 64 66" />
      </svg>
      {variant === 'startup' ? <strong className="adapt-loading-wordmark">ADAPT</strong> : null}
      <span className={`adapt-loading-status${crossfading ? ' is-crossfading' : ''}`}>
        {status}
        {elapsed ? <span className="adapt-loading-elapsed ast-num"> · {elapsed}</span> : null}
      </span>
    </div>
  );
}

/** The compact animated ADAPT mark used wherever a small busy state is needed. */
export function AdaptBusyMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`adapt-button-mark${className ? ` ${className}` : ''}`}
      viewBox="0 0 20 22"
      width="14"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="adapt-button-mark__ring" cx="10" cy="2.5" r="1.8" />
      <path className="adapt-button-mark__peak" d="M3.5 20 10 3.5 16.5 20" />
      <circle className="adapt-button-mark__dot" cx="10" cy="2.5" r="1.8" />
      <path className="adapt-button-mark__bar" d="M7.2 13.4h5.6" />
    </svg>
  );
}

/** Compact branded progress state for inline, card, and modal loading seats. */
export function AdaptLoader({
  label,
  variant = 'inline',
  className = '',
  announce = true,
  as: Element = 'div',
}: {
  label: string;
  variant?: 'inline' | 'compact' | 'panel';
  className?: string;
  announce?: boolean;
  as?: 'div' | 'span';
}) {
  return (
    <Element
      className={`adapt-loader adapt-loader--${variant}${className ? ` ${className}` : ''}`}
      role={announce ? 'status' : undefined}
      aria-label={announce ? label : undefined}
    >
      <AdaptBusyMark />
      <span aria-hidden="true">{label}</span>
    </Element>
  );
}

/** Stable-width button content for ADAPT actions that are in flight. */
export function AdaptBusyButtonContent({
  busy,
  label,
  busyLabel = label,
  icon,
}: {
  busy: boolean;
  label: string;
  busyLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <>
      <span className="adapt-button-state" data-busy={busy ? 'true' : 'false'} aria-hidden="true">
        <span className="adapt-button-state__idle">
          {icon}
          <span>{label}</span>
        </span>
        <span className="adapt-button-state__busy">
          <AdaptBusyMark />
          <span>{busyLabel}</span>
        </span>
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}
