import {
  type LayerAccessReadModel,
  LayerAccessReadModelSchema,
  type SecretKind,
} from '@gev/contracts';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function extractResponseErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const record = data as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  if (typeof record.message === 'string') return record.message;
  if (record.error && typeof record.error === 'object') {
    try {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(record.error)) {
        if (key === '_errors') continue;
        if (
          value &&
          typeof value === 'object' &&
          '_errors' in value &&
          Array.isArray((value as { _errors: unknown[] })._errors)
        ) {
          const errList = (value as { _errors: unknown[] })._errors;
          if (errList.length > 0) {
            parts.push(`${key}: ${errList.join(', ')}`);
          }
        } else {
          parts.push(`${key}: ${JSON.stringify(value)}`);
        }
      }
      if (parts.length > 0) return parts.join('; ');
    } catch {
      // fallback to stringify
    }
    return JSON.stringify(record.error);
  }
  return fallback;
}

class LayerAccessStore {
  model = $state<LayerAccessReadModel | null>(null);
  loadState = $state<LoadState>('idle');
  error = $state<string | null>(null);
  mutating = $state<boolean>(false);

  async load(signal?: AbortSignal): Promise<void> {
    if (this.loadState === 'loading') return;
    if (!this.model) {
      this.loadState = 'loading';
    }
    this.error = null;
    try {
      const response = await fetch('/ops/layer-access', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Task-Ref': 'web-layer-access-read' },
        signal,
      });
      if (!response.ok) {
        throw new Error(`Layer Access returned HTTP ${response.status}`);
      }
      this.model = LayerAccessReadModelSchema.parse(await response.json());
      this.loadState = 'ready';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!this.model) {
        this.model = null;
        this.loadState = 'error';
        this.error =
          error instanceof Error ? error.message : 'Layer Access status could not be loaded';
      }
    }
  }

  async submitCredential(input: {
    provider_id: string;
    secret: string;
    secret_kind: SecretKind;
    required_scopes?: string[];
    credential_reference?: string;
    expires_at?: string | null;
  }): Promise<{ ok: boolean; error?: string }> {
    this.mutating = true;
    try {
      const response = await fetch('/ops/layer-access/credentials', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Task-Ref': 'web-layer-access-submit-credential',
        },
        body: JSON.stringify({
          provider_id: input.provider_id,
          secret_kind: input.secret_kind,
          secret_value: input.secret,
        }),
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        return {
          ok: false,
          error: extractResponseErrorMessage(errJson, `HTTP ${response.status}`),
        };
      }
      await this.load();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.mutating = false;
    }
  }

  async validateCredential(providerId: string): Promise<{ ok: boolean; error?: string }> {
    this.mutating = true;
    try {
      const response = await fetch('/ops/layer-access/credentials/validate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Task-Ref': 'web-layer-access-validate-credential',
        },
        body: JSON.stringify({ provider_id: providerId }),
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        return {
          ok: false,
          error: extractResponseErrorMessage(errJson, `HTTP ${response.status}`),
        };
      }
      await this.load();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.mutating = false;
    }
  }

  async revokeCredential(
    providerId: string,
    reason?: string
  ): Promise<{ ok: boolean; error?: string }> {
    this.mutating = true;
    try {
      const response = await fetch('/ops/layer-access/credentials/revoke', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Task-Ref': 'web-layer-access-revoke-credential',
        },
        body: JSON.stringify({ provider_id: providerId, reason }),
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        return {
          ok: false,
          error: extractResponseErrorMessage(errJson, `HTTP ${response.status}`),
        };
      }
      await this.load();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.mutating = false;
    }
  }

  async deleteCredential(providerId: string): Promise<{ ok: boolean; error?: string }> {
    this.mutating = true;
    try {
      const response = await fetch(
        `/ops/layer-access/credentials/${encodeURIComponent(providerId)}`,
        {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: {
            'X-Task-Ref': 'web-layer-access-delete-credential',
          },
        }
      );
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        return {
          ok: false,
          error: extractResponseErrorMessage(errJson, `HTTP ${response.status}`),
        };
      }
      await this.load();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.mutating = false;
    }
  }

  async acceptTerms(input: {
    provider_id: string;
    terms_url: string;
    version_digest: string;
    approved_uses: string[];
    approved_environments: string[];
    review_notes?: string;
    expires_at?: string | null;
  }): Promise<{ ok: boolean; error?: string }> {
    this.mutating = true;
    try {
      const response = await fetch('/ops/layer-access/terms', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Task-Ref': 'web-layer-access-accept-terms',
        },
        body: JSON.stringify({
          provider_id: input.provider_id,
          terms_id: `${input.provider_id}-terms`,
          reviewed_url: input.terms_url,
          version_digest: input.version_digest,
          approved_use: input.approved_uses,
          approved_environments: input.approved_environments,
          expires_at: input.expires_at ?? null,
        }),
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        return {
          ok: false,
          error: extractResponseErrorMessage(errJson, `HTTP ${response.status}`),
        };
      }
      await this.load();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.mutating = false;
    }
  }

  async revokeTerms(providerId: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
    this.mutating = true;
    try {
      const response = await fetch('/ops/layer-access/terms/revoke', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Task-Ref': 'web-layer-access-revoke-terms',
        },
        body: JSON.stringify({ provider_id: providerId, reason }),
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        return {
          ok: false,
          error: extractResponseErrorMessage(errJson, `HTTP ${response.status}`),
        };
      }
      await this.load();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.mutating = false;
    }
  }
}

export const layerAccessStore = new LayerAccessStore();
