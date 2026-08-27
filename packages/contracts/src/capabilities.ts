import { z } from 'zod';

export const ProviderMaturitySchema = z.enum([
  'seed-demo',
  'experimental-live',
  'release-candidate',
  'production-supported',
]);
export type ProviderMaturity = z.infer<typeof ProviderMaturitySchema>;

export const ProviderTransportSchema = z.enum([
  'seed-fixture',
  'http-polling',
  'websocket-stream',
  'media-hls',
]);
export type ProviderTransport = z.infer<typeof ProviderTransportSchema>;

export const GovernanceRungSchema = z.enum([
  'M1-observer',
  'M2-gatekeeper-stub',
  'M2-gatekeeper-verified',
  'M3-governor',
  'M4-runtime',
]);
export type GovernanceRung = z.infer<typeof GovernanceRungSchema>;

export const LayerCapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  maturity: ProviderMaturitySchema,
  transport: ProviderTransportSchema,
  seedSupported: z.boolean(),
  liveSupported: z.boolean(),
  attribution: z.string(),
  requiredSecrets: z.array(z.string()).default([]),
});
export type LayerCapability = z.infer<typeof LayerCapabilitySchema>;

export const CapabilityManifestSchema = z.object({
  version: z.string(),
  systemStatus: z.enum(['prototype', 'pre-release', 'production']),
  governanceRung: GovernanceRungSchema,
  authRequired: z.boolean(),
  layers: z.array(LayerCapabilitySchema),
  generatedAt: z.string().datetime(),
});
export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
