/**
 * The evidence half of an answer: requested rows first, then their visual story.
 *
 * A business breakout is useful in two different ways: the table is the exact
 * answer and the chart makes its pattern consumable. Both stay visible, in the
 * same order, on the live card and in Run Explorer.
 */
import { AnswerCharts } from './AnswerCharts';
import { renderableCharts } from './answer-chart-data';
import { AnswerProse } from './DataEntityLinks';
import { carriesTable } from './answer-markdown';
import { tableOriginMaps } from './answer-table-origins';
import { mentionedIdentifiers } from './data-entities';
import type { Answer } from './app-types';
import type { SourceRef } from './answer-shape';

export function AnswerEvidence({
  narrative,
  content,
  charts,
  sources,
}: {
  narrative: string;
  content?: string | null;
  charts?: Answer['charts'];
  sources: readonly SourceRef[];
}) {
  const visibleCharts = renderableCharts(charts);
  const hasCharts = visibleCharts.length > 0;
  const hasTables = carriesTable(narrative, content);
  if (!hasCharts && !hasTables) return null;
  const [narrativeOrigins, contentOrigins] = tableOriginMaps([narrative, content], sources);
  const tables = (
    <>
      <AnswerProse
        text={narrative}
        sources={sources}
        columns={mentionedIdentifiers([narrative])}
        blocks="tables"
        originMap={narrativeOrigins}
      />
      {content ? (
        <AnswerProse
          text={content}
          sources={sources}
          columns={mentionedIdentifiers([content])}
          blocks="tables"
          originMap={contentOrigins}
        />
      ) : null}
    </>
  );
  return (
    <section
      className="answer-evidence"
      aria-label={hasCharts && hasTables ? 'Table and chart evidence' : hasCharts ? 'Chart evidence' : 'Table evidence'}
    >
      {hasTables ? tables : null}
      {hasCharts ? <AnswerCharts charts={visibleCharts} sources={sources} /> : null}
    </section>
  );
}
