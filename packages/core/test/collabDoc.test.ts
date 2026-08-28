import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  CollabIntentDoc,
  REMOTE_COLLAB_UPDATE_ORIGIN,
  filterRemoteCollabPresences,
  shouldBroadcastCollabUpdate,
} from '../src/index.js';

describe('CollabIntentDoc validated update boundary', () => {
  it('rejects malformed staged state without mutating or notifying the live document', () => {
    const live = new CollabIntentDoc('room-safe');
    live.setLayerState('flights', true);
    const before = live.toJSON();
    const onUpdate = vi.fn();
    live.onUpdate(onUpdate);

    const malicious = new Y.Doc();
    malicious.getMap('intent').set('selectedEntity', { garbage: 1 });
    const update = Y.encodeStateAsUpdate(malicious);

    expect(() => live.applyValidatedUpdate(update, 'untrusted-peer')).toThrow();
    expect(live.toJSON()).toEqual(before);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('preserves remote origin so received updates are never selected for rebroadcast', () => {
    const source = new CollabIntentDoc('room-safe');
    source.setSelectedEntity({ layer: 'flights', id: 'flight-1' });
    const live = new CollabIntentDoc('room-safe');
    const origins: unknown[] = [];
    live.onUpdate((_update, origin) => origins.push(origin));

    live.applyValidatedUpdate(source.encodeState(), REMOTE_COLLAB_UPDATE_ORIGIN);

    expect(live.getSelectedEntity()).toEqual({ layer: 'flights', id: 'flight-1' });
    expect(origins).toEqual([REMOTE_COLLAB_UPDATE_ORIGIN]);
    expect(shouldBroadcastCollabUpdate(REMOTE_COLLAB_UPDATE_ORIGIN)).toBe(false);
    expect(shouldBroadcastCollabUpdate('local-user')).toBe(true);
  });

  it('removes local presence before collaborators reach rendering or follow controls', () => {
    const common = {
      callsign: 'Operator',
      role: 'operator' as const,
      color: '#00f0ff',
      lastSeenTs: 1,
    };
    const filtered = filterRemoteCollabPresences(
      [
        { ...common, clientId: 'self' },
        { ...common, clientId: 'peer' },
      ],
      'self'
    );

    expect(filtered.map((presence) => presence.clientId)).toEqual(['peer']);
  });
});
