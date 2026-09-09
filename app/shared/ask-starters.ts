import { z } from 'zod';
import { ASK_STARTERS_MAX, DEFAULT_ASK_STARTER_SETTINGS, type AskStarterSettings } from './ask-starters-browser';

export * from './ask-starters-browser';

export const AskStarterSchema = z.strictObject({
  id: z.string().trim().min(1).max(100),
  kicker: z.string().trim().min(1).max(40),
  question: z.string().trim().min(1).max(300),
});

export const AskStarterSettingsSchema = z.strictObject({
  questions: z.array(AskStarterSchema).min(1).max(ASK_STARTERS_MAX),
});

export const AskStarterSettingsPatchSchema = AskStarterSettingsSchema.partial();

export function parseAskStarterSettings(value: unknown): AskStarterSettings {
  const parsed = AskStarterSettingsSchema.parse(value);
  const seen = new Set<string>();
  return {
    questions: parsed.questions.filter(({ id }) => {
      const key = id.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

export const DEFAULT_PARSED_ASK_STARTER_SETTINGS = parseAskStarterSettings(DEFAULT_ASK_STARTER_SETTINGS);
