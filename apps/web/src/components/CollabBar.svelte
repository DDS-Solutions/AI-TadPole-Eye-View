<script lang="ts">
  import { collabStore } from '../stores/collab.svelte.js';

  let showJoinModal = $state(false);
  let inputRoomId = $state(collabStore.state.roomId);
  let inputCallsign = $state(collabStore.state.callsign);
  let copied = $state(false);

  function handleJoin() {
    collabStore.joinRoom(inputRoomId, inputCallsign, collabStore.state.role);
    showJoinModal = false;
  }

  function handleCopyLink() {
    if (typeof window !== 'undefined') {
      const url = `${window.location.origin}?room=${encodeURIComponent(collabStore.state.roomId)}`;
      navigator.clipboard.writeText(url).then(() => {
        copied = true;
        setTimeout(() => { copied = false; }, 2000);
      });
    }
  }
</script>

<div class="collab-bar glass-panel">
  <!-- Room Connection Status -->
  <div class="room-status">
    <span class="status-dot" class:connected={collabStore.state.isConnected}></span>
    <span class="room-label">ROOM:</span>
    <span class="room-id">{collabStore.state.roomId}</span>
    <button class="icon-btn" onclick={handleCopyLink} title="Copy Room Invite Link">
      {copied ? '✓ COPIED' : '📋 SHARE'}
    </button>
  </div>

  <!-- Connected Peers / Presence List -->
  <div class="peers-stream">
    {#each collabStore.state.presences as peer (peer.clientId)}
      <div class="peer-badge" style="--peer-color: {peer.color || 'var(--collab-accent)'};">
        <span class="peer-dot"></span>
        <span class="peer-name">{peer.callsign}</span>
        <span class="peer-role">[{peer.role.slice(0, 3).toUpperCase()}]</span>
        {#if peer.clientId !== collabStore.state.clientId}
          <button
            class="follow-btn"
            class:active={collabStore.state.followLeaderId === peer.clientId}
            onclick={() => {
              if (collabStore.state.followLeaderId === peer.clientId) {
                collabStore.setFollowLeader(null);
              } else {
                collabStore.setFollowLeader(peer.clientId);
              }
            }}
            title="Follow this operator's camera"
          >
            {collabStore.state.followLeaderId === peer.clientId ? 'LOCK' : 'FOLLOW'}
          </button>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Room Actions -->
  <div class="room-actions">
    {#if collabStore.state.isConnected}
      <button class="btn-disconnect" onclick={() => collabStore.leaveRoom()}>LEAVE</button>
    {:else}
      <button class="btn-connect" onclick={() => showJoinModal = true}>JOIN ROOM</button>
    {/if}
  </div>
</div>

{#if showJoinModal}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={() => (showJoinModal = false)}
    onkeydown={(e) => { if (e.key === 'Escape') showJoinModal = false; }}
  >
    <div
      class="modal-content glass-panel"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="modal-header">
        <span class="modal-title">T2 MULTIPLAYER // JOIN LIVE ROOM</span>
        <button class="btn-close" onclick={() => (showJoinModal = false)}>✕</button>
      </div>
      <div class="modal-body">
        <label class="form-field">
          <span>ROOM ID:</span>
          <input type="text" bind:value={inputRoomId} placeholder="e.g. pacific-task-force" />
        </label>
        <label class="form-field">
          <span>OPERATOR CALLSIGN:</span>
          <input type="text" bind:value={inputCallsign} placeholder="e.g. Spectre-Lead" />
        </label>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick={() => (showJoinModal = false)}>CANCEL</button>
        <button class="btn-submit" onclick={handleJoin}>CONNECT ROOM</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .collab-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 14px;
    background: var(--collab-bar-bg);
    border: 1px solid var(--collab-accent-border-soft);
    border-radius: 6px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    backdrop-filter: blur(8px);
  }

  .room-status {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--collab-muted);
  }

  .status-dot.connected {
    background: var(--collab-connected);
    box-shadow: 0 0 6px var(--collab-connected);
  }

  .room-label {
    color: var(--collab-muted);
    font-weight: 700;
  }

  .room-id {
    color: var(--collab-accent);
    font-weight: 800;
  }

  .icon-btn {
    background: var(--collab-accent-subtle);
    color: var(--collab-accent);
    border: 1px solid var(--collab-accent-border);
    padding: 2px 6px;
    font-size: 9px;
    font-weight: 700;
    border-radius: 3px;
    cursor: pointer;
  }

  .peers-stream {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
  }

  .peer-badge {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    background: var(--hud-shadow-soft);
    border: 1px solid var(--peer-color);
    border-radius: 12px;
    font-size: 10px;
  }

  .peer-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--peer-color);
  }

  .peer-name {
    color: var(--hud-switch-knob);
    font-weight: 700;
  }

  .peer-role {
    color: var(--peer-color);
    font-size: 8px;
    font-weight: 800;
  }

  .follow-btn {
    background: var(--collab-follow-bg);
    color: var(--collab-follow-text);
    border: 1px solid var(--collab-follow-border);
    font-size: 8px;
    padding: 1px 4px;
    border-radius: 2px;
    cursor: pointer;
  }

  .follow-btn.active {
    background: var(--collab-accent);
    color: var(--collab-surface-deep);
    font-weight: 800;
  }

  .btn-connect {
    background: var(--collab-accent-soft);
    color: var(--collab-accent);
    border: 1px solid var(--collab-accent);
    padding: 3px 10px;
    font-size: 10px;
    font-weight: 800;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-disconnect {
    background: var(--collab-disconnect-soft);
    color: var(--collab-disconnect);
    border: 1px solid var(--collab-disconnect);
    padding: 3px 10px;
    font-size: 10px;
    font-weight: 800;
    border-radius: 4px;
    cursor: pointer;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--collab-backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    backdrop-filter: blur(4px);
  }

  .modal-content {
    width: 380px;
    background: var(--collab-modal-bg);
    border: 1px solid var(--collab-accent-border-strong);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-title {
    font-size: 11px;
    font-weight: 800;
    color: var(--collab-accent);
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 10px;
    color: var(--collab-label);
  }

  .form-field input {
    background: var(--collab-surface-deep);
    border: 1px solid var(--collab-accent-border);
    color: var(--hud-switch-knob);
    padding: 6px 10px;
    font-size: 11px;
    border-radius: 4px;
    outline: none;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-cancel {
    background: transparent;
    border: 1px solid var(--collab-cancel-border);
    color: var(--collab-label);
    padding: 5px 12px;
    font-size: 10px;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-submit {
    background: var(--collab-accent);
    border: none;
    color: var(--collab-surface-deep);
    padding: 5px 14px;
    font-size: 10px;
    font-weight: 800;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
