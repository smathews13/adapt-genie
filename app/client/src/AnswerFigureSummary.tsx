import type { Figure } from './answer-shape';

export function AnswerFigureSummary({ figures }: { figures: readonly Figure[] }) {
  const keyFigures = figures.slice(0, 4);
  if (keyFigures.length === 0) return null;

  return (
    <section className="answer-figure-summary" aria-label="Key figures">
      <h3 className="answer-figure-heading">Key figures</h3>
      <div className="answer-figure-grid">
        {keyFigures.map((figure) => (
          <div className="answer-figure-tile" key={`${figure.label}-${figure.value}-${figure.display}`}>
            <span className="answer-figure-label">{figure.label}</span>
            <strong className="answer-figure-value ast-num">{figure.display || String(figure.value)}</strong>
            {figure.comparison ? <span className="answer-figure-comparison">{figure.comparison}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
