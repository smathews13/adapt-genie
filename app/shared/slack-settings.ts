import { z } from 'zod';

export const SlackReplyStyleSchema = z.enum(['thread', 'direct']);

export const SlackOperationalSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  killSwitch: z.boolean(),
  allowedRegistrationId: z.string().trim().min(1).max(128),
  replyStyle: SlackReplyStyleSchema,
  limits: z.strictObject({
    globalConcurrency: z.number().int().min(1).max(100),
    workspaceConcurrency: z.number().int().min(1).max(50),
    userConcurrency: z.number().int().min(1).max(20),
    conversationConcurrency: z.number().int().min(1).max(10),
    globalPerMinute: z.number().int().min(1).max(10_000),
    workspacePerMinute: z.number().int().min(1).max(5_000),
    userPerMinute: z.number().int().min(1).max(1_000),
    conversationPerMinute: z.number().int().min(1).max(500),
  }),
});

export const SlackOperationalSettingsPatchSchema = SlackOperationalSettingsSchema.partial();
export type SlackOperationalSettings = z.infer<typeof SlackOperationalSettingsSchema>;

export const DEFAULT_SLACK_OPERATIONAL_SETTINGS: SlackOperationalSettings = {
  enabled: false,
  killSwitch: true,
  allowedRegistrationId: 'disabled',
  replyStyle: 'thread',
  limits: {
    globalConcurrency: 1,
    workspaceConcurrency: 1,
    userConcurrency: 1,
    conversationConcurrency: 1,
    globalPerMinute: 1,
    workspacePerMinute: 1,
    userPerMinute: 1,
    conversationPerMinute: 1,
  },
};

export function parseSlackOperationalSettings(value: unknown): SlackOperationalSettings {
  return SlackOperationalSettingsSchema.parse(value);
}
