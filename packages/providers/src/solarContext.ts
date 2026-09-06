import { type SolarContextResponse, SolarContextResponseSchema } from '@gev/contracts';
import { type SimClock, SystemClock, calculateSolarContext } from '@gev/core';
import { createDataProvenance } from './provenance.js';

export interface SolarContextAdapterOptions {
  clock?: SimClock;
  enabled?: boolean;
  seedMode?: boolean;
}

export class OperationalSourceError extends Error {
  constructor(
    readonly code:
      | 'PROVIDER_DISABLED'
      | 'TERMS_APPROVAL_REQUIRED'
      | 'SOURCE_UNAVAILABLE'
      | 'SOURCE_STALE'
      | 'UPSTREAM_CONTRACT_ERROR'
      | 'RATE_LIMITED'
      | 'CONFIGURATION_REQUIRED',
    message: string,
    readonly status: 423 | 429 | 502 | 503 = 503
  ) {
    super(message);
    this.name = 'OperationalSourceError';
  }
}

/** Offline solar adapter. The injected SimClock is the only source of time. */
export class SolarContextAdapter {
  private readonly clock: SimClock;
  private readonly enabled: boolean;
  private readonly sourceMode: 'seed' | 'live';

  constructor(options: SolarContextAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.enabled = options.enabled ?? process.env.GEV_SOLAR_CONTEXT_ENABLED !== '0';
    const envLive = process.env.GEV_LIVE_MODE === '1' && process.env.GEV_SEED_MODE !== '1';
    this.sourceMode = (options.seedMode ?? !envLive) ? 'seed' : 'live';
  }

  getSolarContext(): SolarContextResponse {
    if (!this.enabled) {
      throw new OperationalSourceError('PROVIDER_DISABLED', 'Solar context is disabled by policy');
    }
    const context = calculateSolarContext(this.clock);
    return SolarContextResponseSchema.parse({
      ...context,
      provenance: createDataProvenance({
        providerId: 'gev-solar-context',
        feedId: 'solar-context',
        clock: this.clock,
        sourceMode: this.sourceMode,
        observationPeriod: {
          status: 'available',
          start: context.computed_at,
          end: context.computed_at,
        },
        ...(this.sourceMode === 'seed' ? { fixtureId: 'solar-reference-v1' } : {}),
      }),
    });
  }
}
