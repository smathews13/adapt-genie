/**
 * The ADAPT mark, as geometry rather than as a picture. Filenames retain their
 * compatibility names.
 *
 * THE RULE THE WHOLE FILE EXISTS TO KEEP IS "NEVER REDRAW, NEVER RESTROKE"
 * The ADAPT design specification and asset README both state this requirement.
 * Every number below is read off the delivered SVG in `assets/logo/`, and
 * The compatibility-named mark test reads those same files off disk and fails if one
 * coordinate, radius, stroke width or dash pattern here differs from them. So
 * this is not a second drawing of the mark; it is the delivered drawing, in a
 * form a component can size and ink.
 *
 * WHY NOT JUST USE THE COMPATIBILITY-NAMED SVG, which would make redrawing
 * impossible by construction. Three seatings the design asks for cannot be had
 * from the two delivered inks:
 *
 *   1. The in-button loader is ALL white -- rim, cross and accent dots -- on the
 *      blue primary button (`loading-suite.md`, Seatings). The `-white` files
 *      keep #6FAEDD on the accents, which disappears on blue.
 *   2. The small cut is a different drawing of the same mark and is not one of
 *      the delivered files: §1 specifies it numerically and nothing ships it.
 *   3. An `<img>` cannot be handed the two inks by CSS, so a mark that has to
 *      survive a repaint of the palette would be eight files instead of one.
 *
 * So the paints are named rather than written: every element says `ink` or
 * `accent`, and `--ast-mark-ink` / `--ast-mark-accent` in astrolabe-mark.css
 * decide what those are for the surface the mark is standing on. That is also
 * what keeps this file out of palette.test.ts's way -- there is no hex here.
 */

/** The four mark concepts. `dpad` is the identity mark; the other three are archive. */
export type MarkConcept = 'dpad' | 'rete' | 'reticle' | 'horizon';

/**
 * Which of the two inks an element takes.
 *
 * `ink` is the mark's structure and `accent` is the blue. What each resolves to
 * is the seating's business: navy and blue on white, white and #6FAEDD on navy,
 * white and white on the blue button.
 */
export type MarkPaint = 'ink' | 'accent';

export type MarkElement =
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      fill?: MarkPaint;
      stroke?: MarkPaint;
      strokeWidth?: number;
      dash?: string;
      opacity?: number;
    }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number; fill: MarkPaint }
  | {
      kind: 'path';
      d: string;
      fill?: MarkPaint;
      stroke?: MarkPaint;
      strokeWidth?: number;
      round?: boolean;
      opacity?: number;
    }
  | { kind: 'group'; stroke: MarkPaint; strokeWidth: number; opacity: number; children: MarkElement[] };

/** Every mark in this family is drawn on this grid, and none of them may leave it. */
export const MARK_VIEWBOX = 64;

/**
 * The ADAPT identity mark, from the compatibility-named d-pad asset.
 *
 * The ADAPT Apex "A": two rails rising to a peak (the ink structure), an accent
 * data crossbar, and an accent dot at the apex. Authored on the 80-unit Apex
 * grid in adapt-logo-01-apex.svg and scaled to this family's 64-unit grid (x0.8),
 * so the peak's `20 63 / 40 21 / 60 63` becomes `16 50.4 / 32 16.8 / 48 50.4` and
 * the 7-wide strokes become 5.6. The crossbar and the apex dot are the accent,
 * exactly as the mockup inks them.
 */
const DPAD: MarkElement[] = [
  { kind: 'path', d: 'M16 50.4 L32 16.8 L48 50.4', stroke: 'ink', strokeWidth: 5.6, round: true },
  { kind: 'path', d: 'M23.2 36.8 L40.8 36.8', stroke: 'accent', strokeWidth: 5.6, round: true },
  { kind: 'circle', cx: 32, cy: 16.8, r: 3.6, fill: 'accent' },
];

/** ADAPT archive concept from the compatibility-named rete asset; the flicker seats it. */
const RETE: MarkElement[] = [
  { kind: 'circle', cx: 32, cy: 32, r: 27, stroke: 'ink', strokeWidth: 3.5 },
  { kind: 'circle', cx: 32, cy: 32, r: 22.5, stroke: 'ink', strokeWidth: 1.1, dash: '1.5 5.55', opacity: 0.5 },
  {
    kind: 'group',
    stroke: 'ink',
    strokeWidth: 1.4,
    opacity: 0.5,
    children: [
      { kind: 'path', d: 'M32 32 19 20' },
      { kind: 'path', d: 'M32 32 45 23' },
      { kind: 'path', d: 'M32 32 24 44' },
      { kind: 'path', d: 'M32 32 43 42' },
      { kind: 'path', d: 'M19 20 45 23' },
      { kind: 'path', d: 'M24 44 43 42' },
    ],
  },
  { kind: 'circle', cx: 19, cy: 20, r: 4, fill: 'accent' },
  { kind: 'circle', cx: 45, cy: 23, r: 4, fill: 'accent' },
  { kind: 'circle', cx: 24, cy: 44, r: 4, fill: 'accent' },
  { kind: 'circle', cx: 43, cy: 42, r: 4, fill: 'accent' },
  { kind: 'circle', cx: 32, cy: 32, r: 4, fill: 'ink' },
];

/** ADAPT archive concept from the compatibility-named reticle asset. */
const RETICLE: MarkElement[] = [
  { kind: 'circle', cx: 32, cy: 32, r: 27, stroke: 'ink', strokeWidth: 3.5 },
  { kind: 'circle', cx: 32, cy: 32, r: 21, stroke: 'ink', strokeWidth: 1.5, dash: '1.8 6.45', opacity: 0.7 },
  { kind: 'path', d: 'M32 2v10', stroke: 'accent', strokeWidth: 4, round: true },
  { kind: 'path', d: 'M52 32h7M32 52v7M12 32H5', stroke: 'ink', strokeWidth: 3, round: true },
  { kind: 'circle', cx: 32, cy: 32, r: 4, fill: 'accent' },
  { kind: 'circle', cx: 41, cy: 23, r: 2.5, fill: 'ink' },
];

/** ADAPT archive concept from the compatibility-named horizon asset. */
const HORIZON: MarkElement[] = [
  { kind: 'circle', cx: 32, cy: 32, r: 27, stroke: 'ink', strokeWidth: 3.5 },
  { kind: 'path', d: 'M8 40q24-10 48 0', stroke: 'ink', strokeWidth: 3, round: true },
  { kind: 'path', d: 'M14 31q18-7 36 0', stroke: 'ink', strokeWidth: 2, round: true, opacity: 0.55 },
  { kind: 'path', d: 'M44 24l2.6 5.9 5.9 2.6-5.9 2.6-2.6 5.9-2.6-5.9-5.9-2.6 5.9-2.6z', fill: 'accent' },
];

export const MARK_CONCEPTS: Readonly<Record<MarkConcept, readonly MarkElement[]>> = {
  dpad: DPAD,
  rete: RETE,
  reticle: RETICLE,
  horizon: HORIZON,
};

/**
 * The small cut, for 13-30px seatings: chips, the top bar's lockup, the gate's.
 *
 * The Apex "A" again, but drawn bolder rather than merely shrunk: the two rails
 * and the crossbar go from 5.6 to 6.6 so the mark keeps its weight at chip size,
 * where a hairline peak would thin out to a smudge, and the apex dot grows from
 * 3.6 to 4 to stay a legible point. Same geometry as the full mark otherwise, on
 * the one 64-unit grid, so a chip and the header read as one drawing.
 */
export const SMALL_CUT: readonly MarkElement[] = [
  { kind: 'path', d: 'M16 50.4 L32 16.8 L48 50.4', stroke: 'ink', strokeWidth: 6.6, round: true },
  { kind: 'path', d: 'M23.2 36.8 L40.8 36.8', stroke: 'accent', strokeWidth: 6.6, round: true },
  { kind: 'circle', cx: 32, cy: 16.8, r: 4, fill: 'accent' },
];

/**
 * The size at or above which the graduation ring is drawn.
 *
 * §1: "No graduation below 32px". A 1.3-wide dash on a 64 grid is a third of a
 * device pixel at 16px, which renders as a grey smudge around the rim rather
 * than as graduations -- so the small cut is not a simplification for its own
 * sake, it is the drawing that survives being small.
 */
export const GRADUATION_FLOOR = 32;

/** Which drawing a seating gets, decided by its size and nothing else. */
export function markElements(size: number, concept: MarkConcept = 'dpad'): readonly MarkElement[] {
  if (concept !== 'dpad') return MARK_CONCEPTS[concept];
  return size >= GRADUATION_FLOOR ? DPAD : SMALL_CUT;
}

/* -------------------------------------------------------------------------- */
/* The lockup                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The two lockups, as PAIRS.
 *
 * §1: "mark at cap height x1.4, 8-9px gap. Top bar: 22px + 15px. Dark bands:
 * 26px + 17px." A pair rather than two numbers a caller supplies, because a 22px
 * mark beside a 17px wordmark is neither of the two lockups the design has, and
 * an API that can express it will eventually be asked to.
 *
 * Here rather than beside the component so that AstrolabeMark.tsx exports
 * components and nothing else, which is what lets a fast refresh replace it in
 * place.
 */
export const LOCKUP_SIZES = {
  bar: { mark: 22, wordmark: 15 },
  band: { mark: 26, wordmark: 17 },
  /* The ADAPT login gate lockup uses a 26px mark and 20px/700 wordmark. It is a light surface rather
     than a dark band, and it is the one place the lockup is the heading of a
     card rather than a corner of a frame, so it carries the band's mark at a
     larger wordmark. Its own spec names it; this file does not invent it. */
  gate: { mark: 26, wordmark: 20 },
} as const;

export type LockupSeat = keyof typeof LOCKUP_SIZES;

/**
 * The ADAPT acronym, uppercase everywhere it is set as a lockup, header or title.
 *
 * Kept in the string rather than transformed by CSS, so a reader who copies it
 * out of the page gets what the app is called.
 */
export const WORDMARK = 'ADAPT';

/* -------------------------------------------------------------------------- */
/* The concept flicker                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The four concepts in the order they take the slot, and the delay each waits.
 *
 * `loading-suite.md` (`#17a`): one stacked slot, 0.8s a mark, 3.2s cycle,
 * delays 0 / 0.8 / 1.6 / 2.4. The order is the reference's, which is the order
 * the concepts were drawn in and ends on the d-pad -- so the cycle resolves on
 * the identity mark rather than on an archive one.
 */
export const FLICKER_ORDER: readonly MarkConcept[] = ['rete', 'reticle', 'horizon', 'dpad'];

/** The whole cycle, in seconds. One mark per quarter of it. */
export const FLICKER_CYCLE_SECONDS = 3.2;

/**
 * When each concept's turn begins, in seconds.
 *
 * Rounded to the hundredth because the result is a CSS duration and binary
 * floating point does not give 2.4 for three eighty-hundredths: the unrounded
 * expression is 2.4000000000000004, which is a legal `animation-delay` and an
 * illegible one.
 */
export function flickerDelay(concept: MarkConcept): number {
  const step = FLICKER_CYCLE_SECONDS / FLICKER_ORDER.length;
  return Math.round(FLICKER_ORDER.indexOf(concept) * step * 100) / 100;
}

/**
 * The concept a frozen slot shows.
 *
 * `prefers-reduced-motion: reduce` hides every child of a flicker slot except
 * the one carrying `data-ast-rest`, because CSS cannot choose which of four
 * stacked marks the still frame should be (see the guard at the foot of
 * the compatibility animation partial). It is the d-pad, because a reader who has asked for
 * no motion should be looking at the app's mark rather than at an archive
 * concept they will never see again.
 */
export const FLICKER_REST: MarkConcept = 'dpad';

/**
 * Where a flicker slot is seated, and how big the mark is there.
 *
 * The `loading-suite.md` seatings, as data rather than as numbers typed into
 * that many components: the splash's 72px, the inline row's 20px, the 14px
 * inside the blue primary button, and the 18px on a navy strip.
 *
 * `status` is the agent path's own foot -- the ringed slot beside "Step 07 ·
 * Preparing the findings" -- and it is the one seating `loading-suite.md` does
 * not name, because the band outliving its run is later than that document. Its
 * 11px IS NOT AN INVENTED SIZE: `.ast-sky-status-mark svg` has painted that slot
 * at 11px since the band was drawn, and the static mark it stands in for asks
 * for the same 11. A seat's number has to be the number it is painted at, or the
 * seat gets a cut of the mark drawn for one size stretched to another.
 */
export type FlickerSeat = 'splash' | 'inline' | 'button' | 'strip' | 'status';

export const FLICKER_SIZES: Readonly<Record<FlickerSeat, number>> = {
  splash: 72,
  inline: 20,
  button: 14,
  strip: 18,
  status: 11,
};
