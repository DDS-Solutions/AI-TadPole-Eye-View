import fs from 'node:fs';
import {
  NWS_ALERT_MAX_RECORDS,
  type NwsAlert,
  type NwsAlertCollection,
  NwsAlertCollectionSchema,
  type NwsAlertReference,
  type OperationalAoi,
  OperationalAoiSchema,
  OperationalAreaGeometrySchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { z } from 'zod';
import { resolveFixturePath } from './opensky.js';
import {
  type OperationalFetcher,
  assertIdentifiedUserAgent,
  defaultOperationalFetcher,
  geometryIntersectsAoi,
  normalizeIsoTime,
  readBoundedJson,
} from './operationalHttp.js';
import { createDataProvenance, observationPeriodFromIso } from './provenance.js';
import { OperationalSourceError } from './solarContext.js';

const NWS_MAX_BYTES = 2_097_152;
const NWS_MAX_STALE_MS = 300_000;
const NWS_ENDPOINT = 'https://api.weather.gov/alerts/active';

const RawReferenceSchema = z.union([
  z.string().min(1).max(1024),
  z.object({ sender: z.string(), identifier: z.string(), sent: z.union([z.string(), z.number()]) }),
]);
const RawAlertPropertiesSchema = z
  .object({
    id: z.string().optional(),
    event: z.string(),
    headline: z.string().nullable().optional(),
    areaDesc: z.string().nullable().optional(),
    severity: z.string(),
    certainty: z.string(),
    urgency: z.string(),
    status: z.string(),
    messageType: z.string(),
    sent: z.union([z.string(), z.number()]),
    effective: z.union([z.string(), z.number()]),
    onset: z.union([z.string(), z.number()]).nullable().optional(),
    expires: z.union([z.string(), z.number()]),
    ends: z.union([z.string(), z.number()]).nullable().optional(),
    references: z.array(RawReferenceSchema).default([]),
  })
  .passthrough();
const RawNwsFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z
    .array(
      z.object({
        type: z.literal('Feature'),
        id: z.string().optional(),
        geometry: OperationalAreaGeometrySchema.nullable(),
        properties: RawAlertPropertiesSchema,
      })
    )
    .max(NWS_ALERT_MAX_RECORDS),
});

export interface NwsAlertsAdapterOptions {
  clock?: SimClock;
  seedMode?: boolean;
  enabled?: boolean;
  liveAccessEnabled?: boolean;
  termsApproved?: boolean;
  userAgent?: string;
  seedFixturePath?: string;
  fetcher?: OperationalFetcher;
}

function normalizedEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeReference(reference: z.infer<typeof RawReferenceSchema>) {
  if (typeof reference !== 'string') {
    return {
      sender: reference.sender,
      identifier: reference.identifier,
      sent: normalizeIsoTime(reference.sent, 'CAP reference sent time'),
    };
  }
  const [sender, identifier, sent] = reference.split(',');
  if (!sender || !identifier || !sent) return null;
  return { sender, identifier, sent: normalizeIsoTime(sent, 'CAP reference sent time') };
}

export function parseNwsAlerts(
  payload: unknown,
  aoi: OperationalAoi,
  clock: SimClock,
  sourceMode: 'seed' | 'live'
): NwsAlertCollection {
  const raw = RawNwsFeatureCollectionSchema.parse(payload);
  const now = clock.now();
  const alerts: NwsAlert[] = [];
  let newestSentMs = Number.NEGATIVE_INFINITY;

  for (const feature of raw.features) {
    const geometry = feature.geometry;
    if (!geometry || !geometryIntersectsAoi(geometry, aoi)) continue;
    const properties = feature.properties;
    const sent = normalizeIsoTime(properties.sent, 'CAP sent time');
    const effective = normalizeIsoTime(properties.effective, 'CAP effective time');
    const expires = normalizeIsoTime(properties.expires, 'CAP expiry time');
    const ends = properties.ends == null ? null : normalizeIsoTime(properties.ends, 'CAP end time');
    newestSentMs = Math.max(newestSentMs, Date.parse(sent));
    if (Math.min(Date.parse(expires), ends ? Date.parse(ends) : Number.POSITIVE_INFINITY) <= now) {
      continue;
    }
    const references = properties.references
      .map(normalizeReference)
      .filter((value): value is NwsAlertReference => value !== null);
    alerts.push({
      id: properties.id ?? feature.id ?? `nws-alert-${alerts.length}`,
      event: properties.event,
      headline: properties.headline ?? properties.event,
      area_description: properties.areaDesc ?? 'NWS alert area',
      severity: normalizedEnum(
        properties.severity,
        ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'],
        'Unknown'
      ),
      certainty: normalizedEnum(
        properties.certainty,
        ['Observed', 'Likely', 'Possible', 'Unlikely', 'Unknown'],
        'Unknown'
      ),
      urgency: normalizedEnum(
        properties.urgency,
        ['Immediate', 'Expected', 'Future', 'Past', 'Unknown'],
        'Unknown'
      ),
      status: normalizedEnum(
        properties.status,
        ['Actual', 'Exercise', 'System', 'Test', 'Draft'],
        'Draft'
      ),
      message_type: normalizedEnum(
        properties.messageType,
        ['Alert', 'Update', 'Cancel', 'Ack', 'Error'],
        'Error'
      ),
      sent,
      effective,
      onset: properties.onset == null ? null : normalizeIsoTime(properties.onset, 'CAP onset time'),
      expires,
      ends,
      references,
      geometry,
    });
  }

  if (Number.isFinite(newestSentMs) && now - newestSentMs > NWS_MAX_STALE_MS) {
    throw new OperationalSourceError(
      'SOURCE_STALE',
      'NWS alert data is more than five minutes old and is unavailable'
    );
  }
  const generatedAt = clock.iso();
  const observationTime = Number.isFinite(newestSentMs)
    ? new Date(newestSentMs).toISOString()
    : generatedAt;
  return NwsAlertCollectionSchema.parse({
    generated_at: generatedAt,
    count: alerts.length,
    alerts,
    provenance: createDataProvenance({
      providerId: 'noaa-nws-alerts',
      feedId: 'nws-alerts',
      clock,
      sourceMode,
      observationPeriod: observationPeriodFromIso(observationTime),
      ...(sourceMode === 'seed' ? { fixtureId: 'nws-alerts-synthetic-v1' } : {}),
    }),
  });
}

export class NwsAlertsAdapter {
  private readonly clock: SimClock;
  private readonly seedMode: boolean;
  private readonly enabled: boolean;
  private readonly liveAccessEnabled: boolean;
  private readonly termsApproved: boolean;
  private readonly userAgent?: string;
  private readonly seedFixturePath: string;
  private readonly fetcher: OperationalFetcher;

  constructor(options: NwsAlertsAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    const envLive = process.env.GEV_LIVE_MODE === '1' && process.env.GEV_SEED_MODE !== '1';
    this.seedMode = options.seedMode ?? !envLive;
    this.enabled = options.enabled ?? process.env.GEV_NWS_ALERTS_ENABLED !== '0';
    this.liveAccessEnabled =
      options.liveAccessEnabled ?? process.env.GEV_NWS_ALERTS_LIVE_ACCESS === '1';
    this.termsApproved = options.termsApproved ?? process.env.GEV_NWS_ALERTS_TERMS_APPROVED === '1';
    this.userAgent = options.userAgent ?? process.env.GEV_NWS_USER_AGENT;
    this.seedFixturePath =
      options.seedFixturePath ?? resolveFixturePath('nws-alerts-synthetic-v1.geojson');
    this.fetcher = options.fetcher ?? defaultOperationalFetcher;
  }

  async getAlerts(input: OperationalAoi): Promise<NwsAlertCollection> {
    if (!this.enabled)
      throw new OperationalSourceError('PROVIDER_DISABLED', 'NWS alerts are disabled by policy');
    const aoi = OperationalAoiSchema.parse(input);
    const payload = this.seedMode ? await this.readSeedFixture() : await this.fetchLive(aoi);
    try {
      return parseNwsAlerts(payload, aoi, this.clock, this.seedMode ? 'seed' : 'live');
    } catch (error) {
      if (error instanceof OperationalSourceError) throw error;
      throw new OperationalSourceError(
        'UPSTREAM_CONTRACT_ERROR',
        'NWS alert response failed contract validation',
        502
      );
    }
  }

  private async readSeedFixture(): Promise<unknown> {
    return JSON.parse(await fs.promises.readFile(this.seedFixturePath, 'utf8')) as unknown;
  }

  private async fetchLive(aoi: OperationalAoi): Promise<unknown> {
    if (!this.liveAccessEnabled || !this.termsApproved) {
      throw new OperationalSourceError(
        'TERMS_APPROVAL_REQUIRED',
        'Live NWS alerts require recorded source approval and explicit live access',
        423
      );
    }
    const userAgent = assertIdentifiedUserAgent(this.userAgent, true);
    const point = `${((aoi.min_lat + aoi.max_lat) / 2).toFixed(4)},${((aoi.min_lon + aoi.max_lon) / 2).toFixed(4)}`;
    const response = await this.fetcher(`${NWS_ENDPOINT}?point=${encodeURIComponent(point)}`, {
      timeoutMs: 10_000,
      maxBytes: NWS_MAX_BYTES,
      allowedHosts: ['api.weather.gov'],
      allowedPaths: [{ host: 'api.weather.gov', pathPrefix: '/alerts/active' }],
      headers: { Accept: 'application/geo+json', 'User-Agent': userAgent },
    });
    return readBoundedJson(response, NWS_MAX_BYTES);
  }
}
