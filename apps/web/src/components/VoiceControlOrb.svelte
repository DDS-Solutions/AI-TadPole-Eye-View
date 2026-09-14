<script lang="ts">
  import { tick } from 'svelte';
  import { MAX_VOICE_COMMAND_CHARS, voiceStore } from '../stores/voice.svelte.js';

  let isDrawerOpen = $state(false);
  let textInput = $state('');
  let isSending = $state(false);
  let shouldFollowTranscript = $state(true);
  let hasUnreadTranscript = $state(false);
  let transcriptContainer = $state<HTMLDivElement>();
  let commandInput = $state<HTMLInputElement>();
  let drawerToggle = $state<HTMLButtonElement>();
  let previousTranscriptSignature = '';

  const currentStatus = $derived(
    voiceStore.state.error && voiceStore.state.status === 'idle'
      ? ('error' as const)
      : voiceStore.state.status
  );
  const shouldConnect = $derived(currentStatus === 'idle' || currentStatus === 'error');

  $effect(() => {
    const transcript = voiceStore.state.transcript;
    const last = transcript.at(-1);
    const signature = last ? `${last.id}:${last.text.length}` : 'empty';
    if (signature === previousTranscriptSignature) return;
    previousTranscriptSignature = signature;
    if (!isDrawerOpen) return;
    if (!shouldFollowTranscript) {
      hasUnreadTranscript = true;
      return;
    }
    void tick().then(() => scrollToLatest('smooth'));
  });

  function setDrawerOpen(open: boolean): void {
    isDrawerOpen = open;
    if (!open) {
      void tick().then(() => drawerToggle?.focus());
      return;
    }
    shouldFollowTranscript = true;
    hasUnreadTranscript = false;
    void tick().then(() => {
      scrollToLatest('auto');
      commandInput?.focus();
    });
  }

  function scrollToLatest(behavior: ScrollBehavior): void {
    transcriptContainer?.scrollTo({
      top: transcriptContainer.scrollHeight,
      behavior,
    });
    shouldFollowTranscript = true;
    hasUnreadTranscript = false;
  }

  function handleTranscriptScroll(): void {
    if (!transcriptContainer) return;
    const distanceFromBottom =
      transcriptContainer.scrollHeight -
      transcriptContainer.scrollTop -
      transcriptContainer.clientHeight;
    shouldFollowTranscript = distanceFromBottom < 48;
    if (shouldFollowTranscript) hasUnreadTranscript = false;
  }

  async function handleSend(): Promise<void> {
    if (isSending || !textInput.trim()) return;
    isSending = true;
    try {
      const sent = await voiceStore.sendUserMessage(textInput);
      if (sent) textInput = '';
    } finally {
      isSending = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void handleSend();
  }

  function handleOrbClick(): void {
    if (shouldConnect) void voiceStore.connect(voiceStore.state.provider);
    else if (currentStatus === 'speaking') voiceStore.triggerBargeIn();
    else setDrawerOpen(!isDrawerOpen);
  }

  function formatToolArgs(args: unknown): string {
    try {
      const serialized = JSON.stringify(args) ?? '';
      return serialized.length > 2048 ? `${serialized.slice(0, 2048)}…` : serialized;
    } catch {
      return '[Unable to display tool arguments]';
    }
  }
</script>

<svelte:window onkeydown={(event) => {
  if (event.key === 'Escape' && isDrawerOpen) setDrawerOpen(false);
}} />

<div class="voice-widget-container" data-status={currentStatus}>
  <div class="orb-wrapper">
    <button
      type="button"
      class="voice-orb"
      class:speaking={currentStatus === 'speaking'}
      class:listening={currentStatus === 'listening'}
      class:stasis={voiceStore.state.stasisActive}
      onclick={handleOrbClick}
      aria-label={`Voice Copilot: ${currentStatus.replace('_', ' ')}`}
      aria-controls="voice-copilot-drawer"
      aria-expanded={isDrawerOpen}
    >
      <span class="orb-core" aria-hidden="true">
        {#if currentStatus === 'speaking'}
          <svg class="orb-icon pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        {:else if currentStatus === 'connecting' || currentStatus === 'processing'}
          <span class="spinner"></span>
        {:else if currentStatus === 'stasis_halted'}
          <span class="stasis-badge">STASIS</span>
        {:else if currentStatus === 'error'}
          <span class="error-badge">!</span>
        {:else}
          <svg class="orb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        {/if}
      </span>
    </button>

    <div class="status-pill" role="status" aria-live="polite">
      <span class="dot"></span>
      <span class="label">{currentStatus.replace('_', ' ').toUpperCase()}</span>
      <button
        bind:this={drawerToggle}
        type="button"
        class="drawer-toggle-btn"
        onclick={() => setDrawerOpen(!isDrawerOpen)}
        aria-label={`${isDrawerOpen ? 'Close' : 'Open'} Voice Copilot drawer`}
        aria-controls="voice-copilot-drawer"
        aria-expanded={isDrawerOpen}
      >{isDrawerOpen ? '▼' : '▲'}</button>
    </div>
  </div>

  {#if isDrawerOpen}
    <section id="voice-copilot-drawer" class="voice-drawer" aria-label="Voice Copilot">
      <header class="drawer-header">
        <div class="header-left">
          <span class="title">VOICE COPILOT // OSINT ACTUATOR</span>
          <span class="provider-pill">{voiceStore.state.provider}</span>
        </div>
        <div class="header-actions">
          <select
            class="provider-select"
            aria-label="Voice provider"
            value={voiceStore.state.provider}
            disabled={currentStatus === 'connecting' || currentStatus === 'stasis_halted'}
            onchange={(event) => {
              const provider = (event.target as HTMLSelectElement).value as
                | 'mock'
                | 'openai-realtime';
              void voiceStore.connect(provider);
            }}
          >
            <option value="mock">Seed/Mock Driver</option>
            <option value="openai-realtime">OpenAI Realtime</option>
          </select>
          <button
            type="button"
            class="btn-action"
            disabled={currentStatus === 'stasis_halted'}
            onclick={() => {
              if (shouldConnect) void voiceStore.connect(voiceStore.state.provider);
              else voiceStore.disconnect();
            }}
          >{currentStatus === 'stasis_halted' ? 'LOCKED' : shouldConnect ? 'CONNECT' : currentStatus === 'connecting' ? 'CANCEL' : 'DISCONNECT'}</button>
          <button type="button" class="btn-close" onclick={() => setDrawerOpen(false)} aria-label="Close Voice Copilot">✕</button>
        </div>
      </header>

      {#if voiceStore.state.error}
        <div class="error-banner" role="alert">{voiceStore.state.error}</div>
      {/if}

      {#if voiceStore.state.activeTool}
        <div class="tool-banner">
          <span class="tool-tag">TOOL INVOCATION</span>
          <span class="tool-name">{voiceStore.state.activeTool.name}</span>
          <pre class="tool-args">{formatToolArgs(voiceStore.state.activeTool.args)}</pre>
        </div>
      {/if}

      <div class="feed-shell">
        <div
          class="transcript-feed"
          bind:this={transcriptContainer}
          onscroll={handleTranscriptScroll}
          role="log"
          aria-label="Voice transcript"
          data-testid="voice-transcript"
        >
          {#each voiceStore.state.transcript as msg (msg.id)}
            <article class="msg-card" class:agent={msg.role === 'agent'} class:user={msg.role === 'user'} class:system={msg.role === 'system'}>
              <div class="msg-header">
                <span class="msg-role">{msg.role.toUpperCase()}</span>
                <time class="msg-time">{new Date(msg.ts).toLocaleTimeString()}</time>
              </div>
              <div class="msg-text">{msg.text}</div>
            </article>
          {/each}
        </div>
        {#if hasUnreadTranscript}
          <button type="button" class="new-messages" onclick={() => scrollToLatest('smooth')}>NEW MESSAGES ↓</button>
        {/if}
      </div>

      <footer class="drawer-footer">
        <input
          bind:this={commandInput}
          type="text"
          class="chat-input"
          aria-label="Voice Copilot command"
          placeholder="Issue a voice or text command…"
          bind:value={textInput}
          maxlength={MAX_VOICE_COMMAND_CHARS}
          onkeydown={handleKeyDown}
          disabled={currentStatus === 'connecting' || currentStatus === 'stasis_halted'}
        />
        <button
          type="button"
          class="send-btn"
          onclick={() => void handleSend()}
          disabled={isSending || !textInput.trim() || currentStatus === 'connecting' || currentStatus === 'stasis_halted'}
        >{isSending ? 'SENDING…' : 'TRANSMIT'}</button>
      </footer>
    </section>
  {/if}
</div>

<style>
  .voice-widget-container {
    --orb-color: var(--voice-idle);
    position: fixed;
    right: max(16px, env(safe-area-inset-right));
    bottom: max(16px, env(safe-area-inset-bottom));
    z-index: 1000;
    display: flex;
    flex-direction: column-reverse;
    align-items: flex-end;
    gap: 12px;
    max-width: calc(100vw - 32px);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    pointer-events: none;
  }
  .voice-widget-container[data-status='connecting'] { --orb-color: var(--voice-connecting); }
  .voice-widget-container[data-status='listening'] { --orb-color: var(--voice-listening); }
  .voice-widget-container[data-status='processing'] { --orb-color: var(--voice-processing); }
  .voice-widget-container[data-status='speaking'] { --orb-color: var(--voice-speaking); }
  .voice-widget-container[data-status='stasis_halted'] { --orb-color: var(--voice-stasis); }
  .voice-widget-container[data-status='error'] { --orb-color: var(--voice-error); }
  :global(body.layer-access-modal-open) .voice-widget-container { visibility: hidden; }
  .orb-wrapper, .voice-drawer { pointer-events: auto; }
  .orb-wrapper { display: flex; align-items: center; gap: 12px; }
  .voice-orb {
    width: 56px; height: 56px; padding: 0; border: 2px solid var(--orb-color); border-radius: 50%;
    background: radial-gradient(circle, var(--hud-panel-bg-raised), var(--hud-surface-dark));
    box-shadow: 0 0 15px var(--orb-color), inset 0 0 10px var(--orb-color);
    color: var(--orb-color); cursor: pointer; display: grid; place-items: center;
  }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--hud-accent); outline-offset: 2px; }
  .orb-core { display: grid; place-items: center; }
  .orb-icon { width: 24px; height: 24px; }
  .orb-icon.pulse { animation: orb-pulse 1.2s infinite ease-in-out; }
  .spinner { width: 20px; height: 20px; border: 2px solid var(--hud-accent-faint); border-top-color: var(--orb-color); border-radius: 50%; animation: spin 0.8s linear infinite; }
  .stasis-badge { color: var(--voice-stasis); font-size: 9px; font-weight: 800; }
  .error-badge { color: var(--voice-error); font-size: 24px; font-weight: 800; }
  .status-pill { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--orb-color); border-radius: 12px; background: var(--hud-panel-bg-raised); color: var(--orb-color); font-size: 10px; font-weight: 700; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--orb-color); }
  .drawer-toggle-btn, .btn-close { border: 0; background: transparent; color: inherit; cursor: pointer; }
  .drawer-toggle-btn { padding: 2px 4px; font-size: 8px; }
  .voice-drawer { width: min(440px, calc(100vw - 32px)); height: min(480px, calc(100dvh - 112px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--hud-accent-border); border-radius: 8px; background: var(--hud-panel-bg-overlay); box-shadow: 0 8px 32px var(--hud-shadow), 0 0 15px var(--hud-accent-faint); backdrop-filter: blur(12px); }
  .drawer-header, .drawer-footer { display: flex; gap: 8px; padding: 10px 14px; background: var(--hud-surface-dark-strong); }
  .drawer-header { align-items: stretch; flex-direction: column; border-bottom: 1px solid var(--hud-border-strong); }
  .header-left { min-width: 0; display: flex; align-items: center; justify-content: space-between; }
  .title { color: var(--voice-listening); font-size: 11px; font-weight: 700; white-space: nowrap; }
  .provider-pill { margin-left: 6px; padding: 2px 6px; border-radius: 4px; background: var(--hud-accent-faint); color: var(--voice-listening); font-size: 9px; white-space: nowrap; }
  .header-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .provider-select { min-width: 0; padding: 3px 6px; border: 1px solid var(--hud-border-prominent); border-radius: 4px; background: var(--hud-surface-dark); color: var(--hud-text-secondary); font-size: 10px; }
  .btn-action { padding: 3px 8px; border: 1px solid var(--hud-accent-border); border-radius: 4px; background: var(--hud-accent-soft); color: var(--voice-listening); cursor: pointer; font-size: 9px; font-weight: 700; }
  .btn-close { padding: 4px; color: var(--hud-text-dim); font-size: 12px; }
  button:disabled, select:disabled, input:disabled { cursor: not-allowed; opacity: 0.55; }
  .error-banner { padding: 7px 14px; border-bottom: 1px solid var(--voice-error); background: var(--hud-danger-soft); color: var(--hud-text-primary); font-size: 10px; overflow-wrap: anywhere; }
  .tool-banner { padding: 8px 14px; border-bottom: 1px solid var(--voice-processing-border); background: var(--voice-processing-soft); font-size: 10px; }
  .tool-tag { color: var(--voice-tool-text); font-weight: 800; }
  .tool-name { color: var(--hud-text-primary); font-weight: 700; }
  .tool-args { max-height: 74px; margin: 4px 0 0; overflow: auto; color: var(--voice-tool-text); font-size: 9px; overflow-wrap: anywhere; white-space: pre-wrap; }
  .feed-shell { position: relative; min-height: 0; flex: 1; }
  .transcript-feed { height: 100%; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .msg-card { padding: 8px 12px; border-radius: 6px; color: var(--hud-text-data); font-size: 11px; line-height: 1.4; }
  .msg-card.agent { border-left: 3px solid var(--voice-listening); background: var(--hud-accent-faint); }
  .msg-card.user { border-left: 3px solid var(--voice-speaking); background: var(--hud-success-soft); }
  .msg-card.system { border-left: 3px solid var(--hud-text-dim); background: var(--hud-surface-dark-soft); color: var(--hud-text-secondary); font-size: 10px; }
  .msg-header { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 9px; font-weight: 700; }
  .msg-text { overflow-wrap: anywhere; white-space: pre-wrap; }
  .new-messages { position: absolute; right: 12px; bottom: 8px; padding: 5px 8px; border: 1px solid var(--hud-accent-border); border-radius: 12px; background: var(--hud-panel-bg-raised); color: var(--voice-listening); cursor: pointer; font-size: 9px; font-weight: 700; }
  .drawer-footer { border-top: 1px solid var(--hud-border-strong); }
  .chat-input { min-width: 0; flex: 1; padding: 6px 10px; border: 1px solid var(--hud-accent-border); border-radius: 4px; background: var(--hud-surface-dark); color: var(--hud-text-primary); font-size: 11px; }
  .send-btn { padding: 0 12px; border: 0; border-radius: 4px; background: var(--voice-listening); color: var(--hud-surface-dark); cursor: pointer; font-size: 10px; font-weight: 800; }
  @keyframes orb-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.15); opacity: 0.85; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 520px) {
    .voice-widget-container { right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom)); max-width: calc(100vw - 24px); }
    .voice-drawer { width: calc(100vw - 24px); height: min(480px, calc(100dvh - 104px)); }
    .provider-select { flex: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .orb-icon.pulse, .spinner { animation: none; }
  }
</style>
