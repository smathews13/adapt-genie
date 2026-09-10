export const ASK_STARTERS_MAX = 12;

export interface AskStarter {
  id: string;
  kicker: string;
  question: string;
}

export interface AskStarterSettings {
  questions: AskStarter[];
}

export const DEFAULT_ASK_STARTER_SETTINGS: AskStarterSettings = {
  questions: [
    {
      id: 'brand-sales',
      kicker: 'Brand',
      question: 'Which brand had the most sales yesterday?',
    },
    {
      id: 'nba-2k26-impressions',
      kicker: '2K26',
      question: 'For NBA 2K26, how are our homepage impressions doing relative to its daily run rate?',
    },
    {
      id: 'civilization-steam',
      kicker: 'Steam',
      question: 'Show Steam impressions, visits and click-through rate for Civilization over the last 3 weeks.',
    },
    {
      id: 't2-net-revenue',
      kicker: 'Revenue',
      question: 'Which T2 game titles generated the most net revenue last month?',
    },
  ],
};
