import { z } from 'zod';

export const VoiceModel = z.enum(['gpt-4o-realtime-preview', 'gpt-4o-mini-realtime-preview']);
export type VoiceModel = z.infer<typeof VoiceModel>;

export const VoiceVoiceName = z.enum([
  'alloy',
  'echo',
  'shimmer',
  'ash',
  'ballad',
  'coral',
  'sage',
  'verse',
]);
export type VoiceVoiceName = z.infer<typeof VoiceVoiceName>;

/**
 * OpenAI Realtime Voice Session Request.
 */
export const VoiceSessionRequest = z.object({
  model: VoiceModel.default('gpt-4o-realtime-preview'),
  voice: VoiceVoiceName.default('alloy'),
  instructions: z.string().optional(),
  modalities: z.array(z.enum(['text', 'audio'])).default(['text', 'audio']),
});
export type VoiceSessionRequest = z.infer<typeof VoiceSessionRequest>;

/**
 * Ephemeral client secret response envelope.
 */
export const VoiceSessionResponse = z.object({
  /** Ephemeral client session token ('ek_...'). */
  client_secret: z.string().min(1),
  /** Unix timestamp in seconds when the ephemeral token expires. */
  expires_at: z.number().int().nonnegative(),
  /** Model provisioned. */
  model: z.string(),
  /** Session ID. */
  session_id: z.string().min(1),
});
export type VoiceSessionResponse = z.infer<typeof VoiceSessionResponse>;
