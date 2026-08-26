<script lang="ts">
  import { voiceStore } from '../stores/voice.svelte.js';

  let isDrawerOpen = $state(false);
  let textInput = $state('');

  function handleSend() {
    if (textInput.trim()) {
      voiceStore.sendUserMessage(textInput.trim());
      textInput = '';
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSend();
    }
  }

  const statusColors: Record<string, string> = {
    idle: '#4a5568',
    connecting: '#d69e2e',
    listening: '#00f0ff',
    processing: '#9f7aea',
    speaking: '#39ff14',
    stasis_halted: '#ff0055',
    error: '#e53e3e',
  };

  const orbScale = $derived(1 + (voiceStore.state.audioLevel || 0) * 0.4);
  const currentStatus = $derived(voiceStore.state.status);
  const activeColor = $derived(statusColors[currentStatus] || '#00f0ff');
</script>

<div class="voice-widget-container">
  <!-- Tactical Voice Orb Button -->
  <div class="orb-wrapper">
    <button
      class="voice-orb"
      class:speaking={currentStatus === 'speaking'}
      class:listening={currentStatus === 'listening'}
      class:stasis={voiceStore.state.stasisActive}
      style="--orb-color: {activeColor}; --orb-scale: {orbScale};"
      onclick={() => {
        if (currentStatus === 'idle') {
          voiceStore.connect(voiceStore.state.provider);
        } else if (currentStatus === 'speaking') {
          voiceStore.triggerBargeIn();
        } else {
          isDrawerOpen = !isDrawerOpen;
        }
      }}
      title="Tactical Voice Copilot ({currentStatus.toUpperCase()})"
    >
      <div class="orb-core">
        {#if currentStatus === 'speaking'}
          <svg class="orb-icon pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        {:else if currentStatus === 'listening'}
          <svg class="orb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        {:else if currentStatus === 'processing'}
          <div class="spinner"></div>
        {:else if voiceStore.state.stasisActive}
          <span class="stasis-badge">STASIS</span>
        {:else}
          <svg class="orb-icon idle" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        {/if}
      </div>
      <div class="orb-ring"></div>
    </button>

    <!-- Quick Status Pill -->
    <div class="status-pill" style="border-color: {activeColor}; color: {activeColor};">
      <span class="dot" style="background: {activeColor};"></span>
      <span class="label">{currentStatus.toUpperCase()}</span>
      <button class="drawer-toggle-btn" onclick={() => isDrawerOpen = !isDrawerOpen}>
        {isDrawerOpen ? '▼' : '▲'}
      </button>
    </div>
  </div>

  <!-- Slide-out Tactical Transcript & Tool Stream Drawer -->
  {#if isDrawerOpen}
    <div class="voice-drawer glass-panel">
      <div class="drawer-header">
        <div class="header-left">
          <span class="title">VOICE COPILOT // OSINT ACTUATOR</span>
          <span class="provider-pill">{voiceStore.state.provider}</span>
        </div>
        <div class="header-actions">
          <select
            class="provider-select"
            value={voiceStore.state.provider}
            onchange={(e) => {
              const val = (e.target as HTMLSelectElement).value as 'mock' | 'openai-realtime';
              voiceStore.connect(val);
            }}
          >
            <option value="mock">Seed/Mock Driver</option>
            <option value="openai-realtime">OpenAI Realtime GA</option>
          </select>
          <button
            class="btn-action"
            onclick={() => {
              if (currentStatus === 'idle') {
                voiceStore.connect(voiceStore.state.provider);
              } else {
                voiceStore.disconnect();
              }
            }}
          >
            {currentStatus === 'idle' ? 'CONNECT' : 'DISCONNECT'}
          </button>
          <button class="btn-close" onclick={() => isDrawerOpen = false}>✕</button>
        </div>
      </div>

      <!-- Active Tool Call Banner -->
      {#if voiceStore.state.activeTool}
        <div class="tool-banner">
          <span class="tool-tag">⚡ TOOL INVOCATION</span>
          <span class="tool-name">{voiceStore.state.activeTool.name}</span>
          <pre class="tool-args">{JSON.stringify(voiceStore.state.activeTool.args)}</pre>
        </div>
      {/if}

      <!-- Transcript Message Stream -->
      <div class="transcript-feed">
        {#each voiceStore.state.transcript as msg (msg.id)}
          <div class="msg-card" class:agent={msg.role === 'agent'} class:user={msg.role === 'user'} class:system={msg.role === 'system'}>
            <div class="msg-header">
              <span class="msg-role">{msg.role.toUpperCase()}</span>
              <span class="msg-time">{new Date(msg.ts).toLocaleTimeString()}</span>
            </div>
            <div class="msg-text">{msg.text}</div>
          </div>
        {/each}
      </div>

      <!-- Operator Text Input -->
      <div class="drawer-footer">
        <input
          type="text"
          class="chat-input"
          placeholder="Issue voice/text command (e.g. 'Fly to Tokyo', 'Toggle marine layer')..."
          bind:value={textInput}
          onkeydown={handleKeyDown}
        />
        <button class="send-btn" onclick={handleSend}>TRANSMIT</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .voice-widget-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }

  .orb-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .voice-orb {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(10, 25, 40, 0.95) 0%, rgba(5, 10, 20, 0.98) 100%);
    border: 2px solid var(--orb-color);
    box-shadow: 0 0 15px var(--orb-color), inset 0 0 10px var(--orb-color);
    cursor: pointer;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: scale(var(--orb-scale, 1));
    transition: transform 0.1s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    padding: 0;
    outline: none;
  }

  .voice-orb:hover {
    box-shadow: 0 0 25px var(--orb-color), inset 0 0 15px var(--orb-color);
  }

  .orb-core {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--orb-color);
  }

  .orb-icon {
    width: 24px;
    height: 24px;
  }

  .orb-icon.pulse {
    animation: orb-pulse 1.2s infinite ease-in-out;
  }

  @keyframes orb-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.15); opacity: 0.85; }
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(0, 240, 255, 0.2);
    border-top-color: #9f7aea;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .stasis-badge {
    font-size: 9px;
    font-weight: 800;
    color: #ff0055;
  }

  .status-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: rgba(10, 15, 25, 0.9);
    border: 1px solid #00f0ff;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    backdrop-filter: blur(8px);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .drawer-toggle-btn {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 8px;
    padding: 0 2px;
  }

  /* Slide-out Drawer */
  .voice-drawer {
    width: 440px;
    height: 480px;
    background: rgba(10, 16, 26, 0.95);
    border: 1px solid rgba(0, 240, 255, 0.3);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8), 0 0 15px rgba(0, 240, 255, 0.15);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    backdrop-filter: blur(12px);
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: rgba(5, 10, 18, 0.8);
    border-bottom: 1px solid rgba(0, 240, 255, 0.2);
  }

  .title {
    font-size: 11px;
    font-weight: 700;
    color: #00f0ff;
    letter-spacing: 0.8px;
  }

  .provider-pill {
    font-size: 9px;
    background: rgba(0, 240, 255, 0.1);
    color: #00f0ff;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: 6px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .provider-select {
    background: #0a1018;
    color: #a0aec0;
    border: 1px solid rgba(255, 255, 255, 0.15);
    font-size: 10px;
    padding: 3px 6px;
    border-radius: 4px;
  }

  .btn-action {
    background: rgba(0, 240, 255, 0.15);
    color: #00f0ff;
    border: 1px solid rgba(0, 240, 255, 0.4);
    font-size: 9px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-close {
    background: transparent;
    border: none;
    color: #718096;
    cursor: pointer;
    font-size: 12px;
  }

  .tool-banner {
    background: rgba(159, 122, 234, 0.15);
    border-bottom: 1px solid rgba(159, 122, 234, 0.4);
    padding: 8px 14px;
    font-size: 10px;
  }

  .tool-tag {
    color: #d6bcfa;
    font-weight: 800;
    margin-right: 6px;
  }

  .tool-name {
    color: #fff;
    font-weight: 700;
  }

  .tool-args {
    margin: 4px 0 0 0;
    font-size: 9px;
    color: #e9d8fd;
    white-space: pre-wrap;
  }

  .transcript-feed {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .msg-card {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.4;
  }

  .msg-card.agent {
    background: rgba(0, 240, 255, 0.08);
    border-left: 3px solid #00f0ff;
    color: #e2e8f0;
  }

  .msg-card.user {
    background: rgba(57, 255, 20, 0.08);
    border-left: 3px solid #39ff14;
    color: #e2e8f0;
  }

  .msg-card.system {
    background: rgba(255, 255, 255, 0.04);
    border-left: 3px solid #718096;
    color: #a0aec0;
    font-size: 10px;
  }

  .msg-header {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    font-weight: 700;
    margin-bottom: 4px;
    opacity: 0.8;
  }

  .drawer-footer {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    background: rgba(5, 10, 18, 0.8);
    border-top: 1px solid rgba(0, 240, 255, 0.2);
  }

  .chat-input {
    flex: 1;
    background: #060d17;
    border: 1px solid rgba(0, 240, 255, 0.3);
    color: #fff;
    font-size: 11px;
    padding: 6px 10px;
    border-radius: 4px;
    outline: none;
  }

  .chat-input:focus {
    border-color: #00f0ff;
  }

  .send-btn {
    background: #00f0ff;
    color: #050a12;
    border: none;
    font-size: 10px;
    font-weight: 800;
    padding: 0 12px;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
