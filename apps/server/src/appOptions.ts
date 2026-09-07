import type {
  CablePackManifest,
  LayerAccessProviderRuntimeInput,
  ProviderRegistry,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { GovernanceRuntimeContext } from '@gev/governance';
import type { CablePackFetcher, SatelliteFetcher, SatelliteLiveGroup } from '@gev/providers';
import type { Context } from 'hono';
import type { OpsAuthOptions } from './middleware/opsAuth.js';

export interface CreateAppOptions {
  opsAuth?: OpsAuthOptions;
  providerRegistry?: ProviderRegistry;
  clock?: SimClock;
  governanceContext?: GovernanceRuntimeContext;
  governanceDbPath?: string;
  voiceApiKey?: string;
  resolveClientId?: (c: Context) => string;
  cablesEnabled?: boolean;
  cablePackManifests?: readonly CablePackManifest[];
  cablePackFetcher?: CablePackFetcher;
  satellitesEnabled?: boolean;
  satelliteLiveAccessEnabled?: boolean;
  celestrakTermsApproved?: boolean;
  satelliteGroups?: readonly SatelliteLiveGroup[];
  satelliteFetcher?: SatelliteFetcher;
  layerAccessAuthorizedLocalState?: readonly LayerAccessProviderRuntimeInput[];
}
