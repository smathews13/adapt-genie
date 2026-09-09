export interface InsightRailSections {
  dataInScope: boolean;
  savedQueries: boolean;
  watchlist: boolean;
  answerConfidence: boolean;
}

export const DEFAULT_INSIGHT_RAIL_SECTIONS: InsightRailSections = {
  dataInScope: true,
  savedQueries: true,
  watchlist: true,
  answerConfidence: true,
};
