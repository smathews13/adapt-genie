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
      id: 'sell-through',
      kicker: 'Sell-through',
      question: 'How did NBA 2K26 sell through on each platform last week?',
    },
    {
      id: 'risk',
      kicker: 'Risk',
      question: 'Which titles saw refund rates climb after the summer sale?',
    },
    {
      id: 'pricing',
      kicker: 'Pricing',
      question: 'Show me discount depth versus units lift for Q1 promos',
    },
    {
      id: 'accounts',
      kicker: 'Accounts',
      question: 'Which accounts are pacing behind their Q1 target?',
    },
  ],
};
