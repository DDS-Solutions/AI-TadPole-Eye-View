<script lang="ts">
  import type { LayerAccessEntry, SecretKind } from '@gev/contracts';
  import { layerAccessStore } from '../stores/layerAccess.svelte.js';

  let { entry }: { entry: LayerAccessEntry } = $props();

  let secret = $state('');
  // svelte-ignore state_referenced_locally
  let secretKind = $state<SecretKind>(
    entry.credential.kind === 'oauth2_client_credentials'
      ? 'client_secret'
      : 'api_key'
  );
  let credentialReference = $state('');
  // svelte-ignore state_referenced_locally
  let termsUrl = $state(entry.terms.terms_url ?? '');
  let versionDigest = $state('');
  let approvedUses = $state('situational_awareness, operations');
  let approvedEnvironments = $state('development, staging');
  let reviewNotes = $state('');

  let validating = $state(false);
  let feedbackMessage = $state<string | null>(null);
  let feedbackKind = $state<'success' | 'error'>('success');

  function clearFeedback(): void {
    feedbackMessage = null;
  }

  function formatStatus(status: string | null): string {
    return status ? status.replaceAll('_', ' ').toUpperCase() : 'UNKNOWN';
  }

  async function runAction(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string
  ): Promise<void> {
    clearFeedback();
    try {
      const result = await fn();
      if (result.ok) {
        feedbackKind = 'success';
        feedbackMessage = successMessage;
      } else {
        feedbackKind = 'error';
        feedbackMessage = result.error ?? 'Operation failed.';
      }
    } catch (err) {
      feedbackKind = 'error';
      feedbackMessage = err instanceof Error ? err.message : 'Unexpected failure.';
    }
  }

  function askReason(actionName: string): string | null {
    const input = window.prompt(`Enter reason for ${actionName} (required):`);
    if (input === null) return null;
    const trimmed = input.trim();
    if (!trimmed) {
      feedbackKind = 'error';
      feedbackMessage = `A reason is required to ${actionName}.`;
      return null;
    }
    return trimmed;
  }

  async function handleCredentialSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!secret.trim()) {
      feedbackKind = 'error';
      feedbackMessage = 'Secret value cannot be empty.';
      return;
    }
    await runAction(async () => {
      const res = await layerAccessStore.submitCredential({
        provider_id: entry.id,
        secret: secret.trim(),
        secret_kind: secretKind,
        credential_reference: credentialReference.trim() || undefined,
      });
      if (res.ok) {
        secret = '';
      }
      return res;
    }, 'Credential securely saved and encrypted.');
  }

  async function handleCredentialValidate(): Promise<void> {
    if (validating) return;
    validating = true;
    try {
      await runAction(
        () => layerAccessStore.validateCredential(entry.id),
        'Credential validation passed successfully.'
      );
    } finally {
      validating = false;
    }
  }

  async function handleCredentialRevoke(): Promise<void> {
    const reason = askReason('credential revocation');
    if (reason === null) return;
    await runAction(
      () => layerAccessStore.revokeCredential(entry.id, reason),
      'Credential revoked.'
    );
  }

  async function handleCredentialDelete(): Promise<void> {
    if (!window.confirm(`Delete stored credential for ${entry.provider_name}? This action cannot be undone.`)) {
      return;
    }
    await runAction(
      () => layerAccessStore.deleteCredential(entry.id),
      'Credential deleted.'
    );
  }

  async function handleTermsAccept(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const url = termsUrl.trim();
    const digest = versionDigest.trim();
    if (!url) {
      feedbackKind = 'error';
      feedbackMessage = 'Authoritative terms URL is required.';
      return;
    }
    if (!url.startsWith('https://')) {
      feedbackKind = 'error';
      feedbackMessage = 'Authoritative terms URL must use https://.';
      return;
    }
    if (!digest) {
      feedbackKind = 'error';
      feedbackMessage = 'Version digest / hash is required.';
      return;
    }
    const uses = Array.from(new Set(approvedUses.split(',').map((u) => u.trim()).filter(Boolean)));
    const envs = Array.from(new Set(approvedEnvironments.split(',').map((env) => env.trim()).filter(Boolean)));
    if (uses.length === 0) {
      feedbackKind = 'error';
      feedbackMessage = 'At least one approved use is required.';
      return;
    }
    if (envs.length === 0) {
      feedbackKind = 'error';
      feedbackMessage = 'At least one approved environment is required.';
      return;
    }
    await runAction(
      () =>
        layerAccessStore.acceptTerms({
          provider_id: entry.id,
          terms_url: url,
          version_digest: digest,
          approved_uses: uses,
          approved_environments: envs,
          review_notes: reviewNotes.trim() || undefined,
        }),
      'Terms acceptance record logged.'
    );
  }

  async function handleTermsRevoke(): Promise<void> {
    const reason = askReason('terms revocation');
    if (reason === null) return;
    await runAction(
      () => layerAccessStore.revokeTerms(entry.id, reason),
      'Terms acceptance revoked.'
    );
  }
</script>

{#key entry.id}
  <section class="admin-section" aria-label="Tenant Administration">
    <header class="admin-header">
      <h4>Tenant Administration</h4>
      <span class="role-badge">TENANT ADMIN ONLY</span>
    </header>

    {#if feedbackMessage}
      <div
        class="feedback-banner"
        class:success={feedbackKind === 'success'}
        class:error={feedbackKind === 'error'}
        role={feedbackKind === 'error' ? 'alert' : 'status'}
      >
        <span>{feedbackMessage}</span>
        <button class="btn-dismiss" onclick={clearFeedback} aria-label="Dismiss feedback">✕</button>
      </div>
    {/if}

    <div class="admin-grid">
      <article class="admin-card" aria-label="Credential Administration">
        <div class="card-title">
          <h5>Credential Administration</h5>
          <span class="status-tag mono">{formatStatus(entry.credential.status)}</span>
        </div>

        {#if entry.credential.masked_fingerprint}
          <div class="current-fingerprint">
            <span class="label">Stored Key:</span>
            <code class="mono">{entry.credential.masked_fingerprint}</code>
          </div>
          <div class="action-row">
            <button
              type="button"
              class="btn-action"
              onclick={handleCredentialValidate}
              disabled={validating || layerAccessStore.mutating}
            >
              {validating ? 'Validating…' : 'Validate'}
            </button>
            <button
              type="button"
              class="btn-action warning"
              onclick={handleCredentialRevoke}
              disabled={layerAccessStore.mutating}
            >
              Revoke
            </button>
            <button
              type="button"
              class="btn-action danger"
              onclick={handleCredentialDelete}
              disabled={layerAccessStore.mutating}
            >
              Delete
            </button>
          </div>
        {/if}

        {#if entry.credential.kind !== 'none'}
          <form onsubmit={handleCredentialSubmit} class="admin-form">
            <fieldset class="form-fieldset" disabled={layerAccessStore.mutating}>
              <div class="field-group">
                <label for={`secret-kind-${entry.id}`}>Secret Kind</label>
                <select id={`secret-kind-${entry.id}`} bind:value={secretKind}>
                  <option value="api_key">API Key</option>
                  <option value="token">Bearer Token</option>
                  <option value="client_secret">Client Secret</option>
                </select>
              </div>
              <div class="field-group">
                <label for={`secret-input-${entry.id}`}>Secret Value</label>
                <input
                  id={`secret-input-${entry.id}`}
                  type="password"
                  bind:value={secret}
                  placeholder="••••••••••••••••••••"
                  autocomplete="new-password"
                  spellcheck="false"
                  required
                />
                <small class="hint">Encrypted at rest with AES-256-GCM. Plain text is never returned or logged.</small>
              </div>
              <div class="field-group">
                <label for={`cred-ref-${entry.id}`}>Credential Reference (Optional)</label>
                <input
                  id={`cred-ref-${entry.id}`}
                  type="text"
                  bind:value={credentialReference}
                  placeholder="e.g. Primary Organization Key"
                />
              </div>
              <button
                type="submit"
                class="btn-primary"
                disabled={layerAccessStore.mutating || !secret.trim()}
              >
                {entry.credential.masked_fingerprint ? 'Rotate Credential' : 'Save Credential'}
              </button>
            </fieldset>
          </form>
        {:else}
          <p class="not-required-notice">This layer does not require tenant credentials.</p>
        {/if}
      </article>

      <article class="admin-card" aria-label="Terms Acceptance Administration">
        <div class="card-title">
          <h5>Terms &amp; Compliance Acceptance</h5>
          <span class="status-tag mono">{formatStatus(entry.terms.status)}</span>
        </div>

        {#if entry.terms.status === 'approved'}
          <div class="current-fingerprint">
            <span class="label">Accepted Owner:</span>
            <span class="mono">{entry.terms.owner}</span>
          </div>
          <div class="action-row">
            <button
              type="button"
              class="btn-action warning"
              onclick={handleTermsRevoke}
              disabled={layerAccessStore.mutating}
            >
              Revoke Terms
            </button>
          </div>
        {/if}

        {#if entry.terms.status !== 'not_required'}
          <form onsubmit={handleTermsAccept} class="admin-form">
            <fieldset class="form-fieldset" disabled={layerAccessStore.mutating}>
              <div class="field-group">
                <label for={`terms-url-${entry.id}`}>Authoritative Terms URL (HTTPS)</label>
                <input
                  id={`terms-url-${entry.id}`}
                  type="url"
                  bind:value={termsUrl}
                  placeholder="https://..."
                  required
                />
              </div>
              <div class="field-group">
                <label for={`version-digest-${entry.id}`}>Version Digest / Hash (Required)</label>
                <input
                  id={`version-digest-${entry.id}`}
                  type="text"
                  bind:value={versionDigest}
                  placeholder="e.g. sha256 or version string"
                  required
                />
              </div>
              <div class="field-group">
                <label for={`approved-uses-${entry.id}`}>Approved Uses (comma-separated)</label>
                <input
                  id={`approved-uses-${entry.id}`}
                  type="text"
                  bind:value={approvedUses}
                />
              </div>
              <div class="field-group">
                <label for={`approved-envs-${entry.id}`}>Approved Environments (comma-separated)</label>
                <input
                  id={`approved-envs-${entry.id}`}
                  type="text"
                  bind:value={approvedEnvironments}
                />
              </div>
              <div class="field-group">
                <label for={`review-notes-${entry.id}`}>Review Notes (Optional)</label>
                <input
                  id={`review-notes-${entry.id}`}
                  type="text"
                  bind:value={reviewNotes}
                  placeholder="Compliance review notes"
                />
              </div>
              <button
                type="submit"
                class="btn-primary"
                disabled={layerAccessStore.mutating}
              >
                Record Terms Acceptance
              </button>
            </fieldset>
          </form>
        {:else}
          <p class="not-required-notice">No license or terms agreement required for this layer.</p>
        {/if}
      </article>
    </div>
  </section>
{/key}

<style>
  .admin-section { border-top: 1px solid var(--hud-divider); padding-top: 14px; margin-top: 4px; }
  .admin-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .admin-header h4 { margin: 0; color: var(--hud-accent); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; }
  .role-badge { background: var(--hud-accent-soft); border: 1px solid var(--hud-accent-border); color: var(--hud-accent); font: 700 0.62rem ui-monospace, monospace; padding: 2px 6px; border-radius: 4px; }
  .feedback-banner { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; font-size: 0.72rem; }
  .feedback-banner.success { background: var(--hud-accent-soft); border: 1px solid var(--hud-accent); color: var(--hud-accent); }
  .feedback-banner.error { background: var(--hud-danger-soft); border: 1px solid var(--hud-danger); color: var(--hud-danger); }
  .btn-dismiss { background: transparent; border: none; color: inherit; font-size: 0.75rem; cursor: pointer; }
  .admin-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .admin-card { background: var(--hud-row-bg); border: 1px solid var(--hud-border-muted); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .card-title { display: flex; align-items: center; justify-content: space-between; }
  .card-title h5 { margin: 0; color: var(--hud-text-primary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .status-tag { font-size: 0.64rem; color: var(--hud-accent); background: var(--hud-accent-faint); padding: 2px 6px; border-radius: 3px; }
  .current-fingerprint { display: flex; align-items: center; gap: 8px; font-size: 0.7rem; }
  .current-fingerprint .label { color: var(--hud-text-dim); }
  .current-fingerprint code { color: var(--hud-accent); background: var(--hud-row-bg); padding: 2px 6px; border-radius: 3px; }
  .action-row { display: flex; gap: 6px; }
  .btn-action { background: var(--hud-row-bg); border: 1px solid var(--hud-border-muted); color: var(--hud-text-primary); padding: 4px 8px; font-size: 0.68rem; border-radius: 4px; cursor: pointer; font-family: ui-monospace, monospace; text-transform: uppercase; }
  .btn-action:hover:not(:disabled) { background: var(--hud-border-solid-soft); }
  .btn-action.warning { border-color: var(--hud-border-solid-soft); color: var(--hud-warning); }
  .btn-action.warning:hover:not(:disabled) { background: var(--hud-accent-soft); }
  .btn-action.danger { border-color: var(--hud-danger-soft); color: var(--hud-danger); }
  .btn-action.danger:hover:not(:disabled) { background: var(--hud-danger-soft); }
  .admin-form { display: flex; flex-direction: column; gap: 8px; }
  .form-fieldset { margin: 0; padding: 0; border: none; display: flex; flex-direction: column; gap: 8px; }
  .field-group { display: flex; flex-direction: column; gap: 3px; }
  .field-group label { font-size: 0.65rem; color: var(--hud-text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
  .field-group input, .field-group select { background: var(--hud-row-bg); border: 1px solid var(--hud-border-muted); color: var(--hud-text-data); padding: 6px 8px; font-size: 0.72rem; border-radius: 4px; outline: none; font-family: inherit; }
  .field-group input:focus, .field-group select:focus { border-color: var(--hud-accent); }
  .hint { font-size: 0.62rem; color: var(--hud-text-dim); line-height: 1.3; }
  .btn-primary { background: var(--hud-accent-soft); border: 1px solid var(--hud-accent); color: var(--hud-accent); padding: 6px 12px; font-size: 0.7rem; font-weight: 700; border-radius: 4px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.06em; font-family: ui-monospace, monospace; margin-top: 4px; }
  .btn-primary:hover:not(:disabled) { background: var(--hud-accent-border); }
  .btn-primary:disabled, .btn-action:disabled { opacity: 0.5; cursor: not-allowed; }
  .not-required-notice { font-size: 0.7rem; color: var(--hud-text-dim); margin: 4px 0; }
  .mono { font-family: ui-monospace, monospace; }
  @media (max-width: 820px) { .admin-grid { grid-template-columns: 1fr; } }
</style>
