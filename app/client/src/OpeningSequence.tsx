/**
 * The app opening: a flat navy screen, the four concepts, the wordmark.
 *
 * The full-viewport half of the sequence. The gate that rises over it at 60% is
 * the REAL gate and is not drawn here -- `loading-suite.md`: "The gate is the real
 * gate (login-gate.md); the sequence only precedes it." `FirstOpenGate` owns both
 * and is where the clock lives.
 *
 * NO CONSTELLATION. The intro used to draw a `ConstellationField` -- twenty-two
 * stars and their connectors -- behind the lockup, and the sky stayed mounted
 * behind the gate after the intro ended. That was the last of the stars theme,
 * removed with the rest of it: this app's analyst audience meets the ADAPT
 * wordmark on the flat sky surface (`.ast-opening` is `--ast-sky-fill`) rather
 * than over a starfield. `ConstellationField` itself stays -- the agent-working
 * animation still draws the real run as a constellation -- it is just not the
 * app's opening backdrop any more.
 *
 * What ENDS is the middle: the concepts and the wordmark are one-shot animations
 * that are over by 64% of the sequence, and the component stops rendering them
 * once the gate is up. A concept mark cycling behind a login card would be the
 * app still introducing itself to somebody who is trying to read their own email
 * address.
 *
 * DECORATIVE, ENTIRELY. The whole layer is `aria-hidden`: it says nothing a screen
 * reader can use, and the gate that follows it carries the words.
 *
 * `leaving` fades the layer out as the app crossfades up under it
 * (`ast-anim-x-sky`), which is the other end of the same sequence.
 */
import { AstrolabeMark } from './AstrolabeMark';
import { FLICKER_ORDER, WORDMARK } from './astrolabe-mark';
import { CONCEPT_SIZE, OPENING_SECONDS, conceptDelay } from './opening-sequence';

export function OpeningSequence({ intro, leaving = false }: { intro: boolean; leaving?: boolean }) {
  const cycle = `${OPENING_SECONDS}s`;
  return (
    <div className={`ast-opening${leaving ? ' ast-anim-x-sky' : ''}`} aria-hidden="true">
      {intro ? (
        <div className="ast-opening-centre">
          {/* Four marks in one stacked slot, a turn each. The same four concepts
              the loaders flicker through, in the same order, at 96px instead of
              72 and 1.6s instead of 0.8 -- this is the app saying its own name
              rather than reporting that something is in flight.
              `ink="dark"` is the white-on-navy cut: the canvas is #11171C. */}
          <div className="ast-opening-concepts">
            {FLICKER_ORDER.map((concept, at) => (
              <AstrolabeMark
                key={concept}
                size={CONCEPT_SIZE}
                concept={concept}
                ink="dark"
                className="ast-anim-concept"
                style={{ animationDuration: cycle, animationDelay: `${conceptDelay(at)}s` }}
              />
            ))}
          </div>
          {/* The wordmark, held under them. Type rather than artwork and lowercase
              in the string rather than by `text-transform`, for the same two
              reasons the lockup is: it survives a font change, and a reader who
              copies it gets what the app is called. */}
          <p className="ast-opening-wordmark ast-anim-hold" style={{ animationDuration: cycle }}>
            {WORDMARK}
          </p>
        </div>
      ) : null}
    </div>
  );
}
