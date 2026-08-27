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

export const DEFAULT_CAPABILITY_MANIFEST: CapabilityManifest = {
  version: '1.1.0',
  systemStatus: 'prototype',
  governanceRung: 'M1-observer',
  authRequired: true,
  layers: [
    {
      id: 'flights',
      name: 'OpenSky Network ADS-B',
      maturity: 'seed-demo',
      transport: 'http-polling',
      seedSupported: true,
      liveSupported: true,
      attribution: 'The OpenSky Network (https://opensky-network.org)',
      requiredSecrets: [],
    },
    {
      id: 'marine',
      name: 'AISStream Vessel Telemetry',
      maturity: 'seed-demo',
      transport: 'websocket-stream',
      seedSupported: true,
      liveSupported: true,
      attribution: 'AISStream (https://aisstream.io)',
      requiredSecrets: ['AISSTREAM_API_KEY'],
    },
    {
      id: 'quakes',
      name: 'USGS Earthquake Hazards',
      maturity: 'seed-demo',
      transport: 'http-polling',
      seedSupported: true,
      liveSupported: true,
      attribution: 'U.S. Geological Survey (USGS)',
      requiredSecrets: [],
    },
    {
      id: 'firms',
      name: 'NASA FIRMS Hotspots',
      maturity: 'seed-demo',
      transport: 'http-polling',
      seedSupported: true,
      liveSupported: true,
      attribution: 'NASA LANCE / FIRMS MODIS & VIIRS',
      requiredSecrets: ['NASA_FIRMS_MAP_KEY'],
    },
    {
      id: 'gbfs',
      name: 'GBFS Micro-Mobility',
      maturity: 'seed-demo',
      transport: 'http-polling',
      seedSupported: true,
      liveSupported: true,
      attribution: 'General Bikeshare Feed Specification feeds',
      requiredSecrets: [],
    },
    {
      id: 'cctv',
      name: 'Public CCTV Cameras',
      maturity: 'seed-demo',
      transport: 'media-hls',
      seedSupported: true,
      liveSupported: true,
      attribution: 'Public Department of Transportation feeds',
      requiredSecrets: [],
    },
    {
      id: 'radio',
      name: 'Radio & ATC Audio',
      maturity: 'seed-demo',
      transport: 'http-polling',
      seedSupported: true,
      liveSupported: true,
      attribution: 'Radio Browser / Open Community Streams',
      requiredSecrets: [],
    },
    {
      id: 'launches',
      name: 'Orbital Rocket Launches',
      maturity: 'seed-demo',
      transport: 'seed-fixture',
      seedSupported: true,
      liveSupported: false,
      attribution: 'Launch Library 2 (The Space Devs)',
      requiredSecrets: [],
    },
    {
      id: 'weather',
      name: 'RainViewer Radar Imagery',
      maturity: 'seed-demo',
      transport: 'seed-fixture',
      seedSupported: true,
      liveSupported: false,
      attribution: 'RainViewer API',
      requiredSecrets: [],
    },
  ],
  generatedAt: '2026-08-26T20:00:00.000Z',
};
