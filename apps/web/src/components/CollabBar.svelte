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
      <div class="peer-badge" style="--peer-color: {peer.color || '#00f0ff'};">
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
    background: rgba(8, 14, 22, 0.85);
    border: 1px solid rgba(0, 240, 255, 0.2);
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
    background: #718096;
  }

  .status-dot.connected {
    background: #39ff14;
    box-shadow: 0 0 6px #39ff14;
  }

  .room-label {
    color: #718096;
    font-weight: 700;
  }

  .room-id {
    color: #00f0ff;
    font-weight: 800;
  }

  .icon-btn {
    background: rgba(0, 240, 255, 0.1);
    color: #00f0ff;
    border: 1px solid rgba(0, 240, 255, 0.3);
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
    background: rgba(0, 0, 0, 0.4);
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
    color: #fff;
    font-weight: 700;
  }

  .peer-role {
    color: var(--peer-color);
    font-size: 8px;
    font-weight: 800;
  }

  .follow-btn {
    background: rgba(255, 255, 255, 0.1);
    color: #cbd5e0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    font-size: 8px;
    padding: 1px 4px;
    border-radius: 2px;
    cursor: pointer;
  }

  .follow-btn.active {
    background: #00f0ff;
    color: #050a12;
    font-weight: 800;
  }

  .btn-connect {
    background: rgba(0, 240, 255, 0.15);
    color: #00f0ff;
    border: 1px solid #00f0ff;
    padding: 3px 10px;
    font-size: 10px;
    font-weight: 800;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-disconnect {
    background: rgba(255, 0, 85, 0.15);
    color: #ff0055;
    border: 1px solid #ff0055;
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
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    backdrop-filter: blur(4px);
  }

  .modal-content {
    width: 380px;
    background: #0a1018;
    border: 1px solid rgba(0, 240, 255, 0.4);
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
    color: #00f0ff;
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
    color: #a0aec0;
  }

  .form-field input {
    background: #050a12;
    border: 1px solid rgba(0, 240, 255, 0.3);
    color: #fff;
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
    border: 1px solid #4a5568;
    color: #a0aec0;
    padding: 5px 12px;
    font-size: 10px;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-submit {
    background: #00f0ff;
    border: none;
    color: #050a12;
    padding: 5px 14px;
    font-size: 10px;
    font-weight: 800;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
