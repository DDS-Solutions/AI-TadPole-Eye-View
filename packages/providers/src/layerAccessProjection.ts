import type {
  LayerAccessCredentialRuntime,
  LayerAccessEntry,
  LayerAccessReadModel,
  LayerAccessRuntimeSnapshot,
  LayerAccessTermsState,
  LayerEffectiveAccessState,
  ProviderRegistry,
} from '@gev/contracts';
import { summarizeProviderRegistry } from './registry.js';

const UNAVAILABLE_LOCAL_STATUS_REASON =
  'Masked local access status is unavailable from the current operator authority';

interface StaticProviderProjection {
  provider: ProviderRegistry['providers'][number];
  documentationPaths: string[];
}

const staticProjectionCache = new WeakMap<ProviderRegistry, StaticProviderProjection[]>();

function staticProviders(registry: ProviderRegistry): StaticProviderProjection[] {
  const cached = staticProjectionCache.get(registry);
  if (cached) return cached;
  const projected = registry.providers.map((provider) => ({
    provider,
    documentationPaths: [...new Set(provider.layers.map((layer) => layer.documentation_path))],
  }));
  projected.sort(
    (left, right) =>
      left.provider.source_access.domain.localeCompare(
        right.provider.source_access.domain,
        'en-US'
      ) ||
      left.provider.name.localeCompare(right.provider.name, 'en-US') ||
      left.provider.id.localeCompare(right.provider.id, 'en-US')
  );
  staticProjectionCache.set(registry, projected);
  return projected;
}

function unavailableLocalStatus(reason: string) {
  return { visibility: 'unavailable' as const, reason };
}

function availableLocalStatus() {
  return { visibility: 'available' as const, reason: null };
}

function defaultCredential(
  kind: LayerAccessEntry['credential']['kind']
): LayerAccessCredentialRuntime | null {
  return kind === 'none'
    ? { status: 'not_required', masked_fingerprint: null, validated_at: null }
    : null;
}

function defaultTerms(status: 'not_required' | 'record_required'): LayerAccessTermsState | null {
  return status === 'not_required' ? 'not_required' : null;
}

function addGate(
  reasons: LayerAccessEntry['lock_reasons'],
  gate: LayerAccessEntry['lock_reasons'][number]['gate'],
  code: string,
  message: string
): void {
  reasons.push({ gate, code, message });
}

function resolveEffectiveAccess(
  entry: Omit<LayerAccessEntry, 'effective_access'>,
  requestedMode: ProviderRegistry['requested_mode']
): LayerEffectiveAccessState {
  if (entry.policy.stasis_active) return 'stasis';
  if (
    entry.implementation !== 'implemented' ||
    entry.layers.every((layer) => layer.implementation !== 'implemented')
  ) {
    return 'planned';
  }
  if (!entry.policy.enabled) return 'disabled';
  if (requestedMode === 'live') {
    if (
      entry.credential.local_status.visibility === 'unavailable' ||
      (entry.credential.status !== 'not_required' && entry.credential.status !== 'valid')
    ) {
      return entry.credential.status === null ? 'unavailable' : 'setup_required';
    }
    if (
      entry.terms.local_status.visibility === 'unavailable' ||
      (entry.terms.status !== 'not_required' && entry.terms.status !== 'approved')
    ) {
      return entry.terms.status === null ? 'unavailable' : 'approval_required';
    }
    if (
      entry.configuration.local_status.visibility === 'unavailable' ||
      (entry.configuration.current_state !== 'not_required' &&
        entry.configuration.current_state !== 'valid')
    ) {
      return entry.configuration.current_state === null ? 'unavailable' : 'configuration_required';
    }
  }
  if (entry.runtime.mode === 'unavailable' || entry.runtime.status === 'unavailable') {
    return 'unavailable';
  }
  return 'available';
}

function buildLockReasons(
  entry: Omit<LayerAccessEntry, 'effective_access' | 'lock_reasons'>,
  requestedMode: ProviderRegistry['requested_mode']
): LayerAccessEntry['lock_reasons'] {
  const reasons: LayerAccessEntry['lock_reasons'] = [];
  if (entry.implementation !== 'implemented') {
    addGate(
      reasons,
      'implementation',
      entry.implementation,
      entry.implementation === 'planned'
        ? 'Implementation is planned and is not available'
        : 'The provider path is incomplete and cannot be activated'
    );
  }
  if (
    entry.implementation === 'implemented' &&
    entry.layers.every((layer) => layer.implementation !== 'implemented')
  ) {
    addGate(
      reasons,
      'implementation',
      'layer-incomplete',
      'The provider feed exists, but its visual layer is incomplete'
    );
  }
  if (entry.policy.stasis_active) {
    addGate(reasons, 'policy', 'stasis-active', 'STASIS suspends all layer activation');
  }
  if (!entry.policy.enabled) {
    addGate(
      reasons,
      'policy',
      'disabled-by-policy',
      entry.policy.reason ?? 'The platform policy disables this provider'
    );
  }
  if (requestedMode === 'live') {
    if (entry.credential.local_status.visibility === 'unavailable') {
      addGate(
        reasons,
        'credential',
        'credential-status-unavailable',
        entry.credential.local_status.reason ?? UNAVAILABLE_LOCAL_STATUS_REASON
      );
    } else if (entry.credential.status !== 'not_required' && entry.credential.status !== 'valid') {
      addGate(
        reasons,
        'credential',
        `credential-${entry.credential.status ?? 'missing'}`,
        `Credential status is ${entry.credential.status ?? 'missing'}`
      );
    }
    if (entry.terms.local_status.visibility === 'unavailable') {
      addGate(
        reasons,
        'terms',
        'terms-status-unavailable',
        entry.terms.local_status.reason ?? UNAVAILABLE_LOCAL_STATUS_REASON
      );
    } else if (entry.terms.status !== 'not_required' && entry.terms.status !== 'approved') {
      addGate(
        reasons,
        'terms',
        `terms-${entry.terms.status ?? 'unreviewed'}`,
        `Terms status is ${entry.terms.status ?? 'unreviewed'}`
      );
    }
    if (entry.configuration.local_status.visibility === 'unavailable') {
      addGate(
        reasons,
        'configuration',
        'configuration-status-unavailable',
        entry.configuration.local_status.reason ?? UNAVAILABLE_LOCAL_STATUS_REASON
      );
    } else if (
      entry.configuration.current_state !== 'not_required' &&
      entry.configuration.current_state !== 'valid'
    ) {
      addGate(
        reasons,
        'configuration',
        `configuration-${entry.configuration.current_state ?? 'missing'}`,
        `Configuration status is ${entry.configuration.current_state ?? 'missing'}`
      );
    }
  }
  if (entry.runtime.mode === 'unavailable' || entry.runtime.status === 'unavailable') {
    addGate(
      reasons,
      'runtime',
      'source-unavailable',
      entry.runtime.detail ?? 'The provider runtime is unavailable'
    );
  }
  return reasons.slice(0, 8);
}

/** Pure deterministic projection from typed registry truth plus a bounded runtime snapshot. */
export function createLayerAccessReadModel(
  inputRegistry: ProviderRegistry,
  inputSnapshot: LayerAccessRuntimeSnapshot
): LayerAccessReadModel {
  const registry = inputRegistry;
  const snapshot = inputSnapshot;
  const runtimeByProvider = new Map(
    snapshot.providers.map((provider) => [provider.provider_id, provider] as const)
  );
  const localStatusReason = snapshot.authority.reason ?? UNAVAILABLE_LOCAL_STATUS_REASON;
  const entries = staticProviders(registry).map(
    ({ provider, documentationPaths }): LayerAccessEntry => {
      const runtimeInput = runtimeByProvider.get(provider.id);
      const credential =
        runtimeInput?.credential ?? defaultCredential(provider.source_access.credential.kind);
      const termsStatus =
        runtimeInput?.terms?.status ?? defaultTerms(provider.source_access.approval.status);
      const configurationState =
        runtimeInput?.configuration?.status ??
        (provider.source_access.configuration.status === 'not_required' ? 'not_required' : null);
      const canReadSensitiveStatus =
        snapshot.authority.kind === 'authenticated_local_operator' &&
        snapshot.authority.credential_status_access === 'masked_status';
      const credentialStatusAvailable =
        credential !== null && (credential.status === 'not_required' || canReadSensitiveStatus);
      const termsStatusAvailable =
        termsStatus === 'not_required' ||
        (runtimeInput?.terms !== undefined && canReadSensitiveStatus);
      const configurationStatusAvailable =
        configurationState === 'not_required' ||
        (runtimeInput?.configuration !== undefined && canReadSensitiveStatus);
      const runtimeStatus = runtimeInput?.runtime?.status ?? provider.health;
      const baseEntry = {
        id: provider.id,
        domain: provider.source_access.domain,
        provider_name: provider.name,
        source: provider.source,
        implementation: provider.implementation,
        feeds: provider.feeds,
        layers: provider.layers,
        products: provider.source_access.products,
        credential: {
          ...provider.source_access.credential,
          local_status: credentialStatusAvailable
            ? availableLocalStatus()
            : unavailableLocalStatus(localStatusReason),
          status: credentialStatusAvailable ? (credential?.status ?? null) : null,
          masked_fingerprint:
            credentialStatusAvailable && credential?.status === 'valid'
              ? credential.masked_fingerprint
              : null,
          validated_at: credentialStatusAvailable ? (credential?.validated_at ?? null) : null,
        },
        terms: {
          ...provider.source_access.approval,
          local_status: termsStatusAvailable
            ? availableLocalStatus()
            : unavailableLocalStatus(localStatusReason),
          status: termsStatusAvailable ? termsStatus : null,
          reviewed_at: termsStatusAvailable ? (runtimeInput?.terms?.reviewed_at ?? null) : null,
          expires_at: termsStatusAvailable ? (runtimeInput?.terms?.expires_at ?? null) : null,
        },
        configuration: {
          ...provider.source_access.configuration,
          local_status: configurationStatusAvailable
            ? availableLocalStatus()
            : unavailableLocalStatus(localStatusReason),
          current_state: configurationStatusAvailable ? configurationState : null,
          checked_at: configurationStatusAvailable
            ? (runtimeInput?.configuration?.checked_at ?? null)
            : null,
        },
        policy: {
          ...provider.source_access.operations,
          enabled: runtimeInput?.policy?.enabled ?? true,
          reason: runtimeInput?.policy?.reason ?? null,
          budget_remaining_usd: snapshot.budget_remaining_usd,
          stasis_active: snapshot.stasis_active,
        },
        runtime: {
          mode: provider.mode,
          status: runtimeStatus,
          observation_at: runtimeInput?.runtime?.observation_at ?? null,
          retrieved_at: runtimeInput?.runtime?.retrieved_at ?? null,
          cache_origin_at: runtimeInput?.runtime?.cache_origin_at ?? null,
          last_success_at: runtimeInput?.runtime?.last_success_at ?? null,
          last_error_at: runtimeInput?.runtime?.last_error_at ?? null,
          next_poll_at: runtimeInput?.runtime?.next_poll_at ?? null,
          detail: runtimeInput?.runtime?.detail ?? null,
        },
        setup_instructions: provider.source_access.setup_instructions,
        documentation_paths: documentationPaths,
      };
      const lockReasons = buildLockReasons(baseEntry, registry.requested_mode);
      return {
        ...baseEntry,
        effective_access: resolveEffectiveAccess(
          { ...baseEntry, lock_reasons: lockReasons },
          registry.requested_mode
        ),
        lock_reasons: lockReasons,
      };
    }
  );
  const effective = {
    available: 0,
    setup_required: 0,
    approval_required: 0,
    configuration_required: 0,
    planned: 0,
    disabled: 0,
    stasis: 0,
    unavailable: 0,
  };
  for (const entry of entries) effective[entry.effective_access] += 1;
  return {
    version: 1,
    generated_at: snapshot.observed_at,
    requested_mode: registry.requested_mode,
    authority: snapshot.authority,
    counts: { registry: summarizeProviderRegistry(registry), effective },
    entries,
  };
}
