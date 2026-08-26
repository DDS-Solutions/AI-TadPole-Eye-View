import {
  type AoiAnnotation,
  type EntityReference,
  type RoomIntentState,
  RoomIntentStateSchema,
} from '@gev/contracts';
import * as Y from 'yjs';

/**
 * Collaborative Intent CRDT Document.
 * Implements "Sync intent, never telemetry" (PLAN.md §9).
 * Synchronizes entity selections, layer toggles, AOIs, and camera tracking references.
 */
export class CollabIntentDoc {
  readonly doc: Y.Doc;
  readonly roomId: string;

  private intentMap: Y.Map<unknown>;
  private layersMap: Y.Map<boolean>;
  private aoiArray: Y.Array<AoiAnnotation>;

  constructor(roomId: string, doc?: Y.Doc) {
    this.roomId = roomId;
    this.doc = doc ?? new Y.Doc();

    this.intentMap = this.doc.getMap('intent');
    this.layersMap = this.doc.getMap('layers');
    this.aoiArray = this.doc.getArray('aois');
  }

  // --- Intent Accessors ---

  getSelectedEntity(): EntityReference | null {
    const val = this.intentMap.get('selectedEntity');
    if (!val) return null;
    return val as EntityReference;
  }

  setSelectedEntity(entity: EntityReference | null): void {
    if (entity === null) {
      this.intentMap.delete('selectedEntity');
    } else {
      this.intentMap.set('selectedEntity', entity);
    }
  }

  getFollowLeaderId(): string | null {
    return (this.intentMap.get('followLeaderId') as string | null) ?? null;
  }

  setFollowLeaderId(leaderId: string | null): void {
    if (leaderId === null) {
      this.intentMap.delete('followLeaderId');
    } else {
      this.intentMap.set('followLeaderId', leaderId);
    }
  }

  getSimTimeOffset(): number {
    return (this.intentMap.get('simTimeOffsetSec') as number) ?? 0;
  }

  setSimTimeOffset(offsetSec: number): void {
    this.intentMap.set('simTimeOffsetSec', offsetSec);
  }

  // --- Layer State ---

  getActiveLayers(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const key of this.layersMap.keys()) {
      result[key] = Boolean(this.layersMap.get(key));
    }
    return result;
  }

  setLayerState(layer: string, enabled: boolean): void {
    this.layersMap.set(layer, enabled);
  }

  // --- AOIs ---

  getAois(): AoiAnnotation[] {
    return this.aoiArray.toArray();
  }

  addAoi(aoi: AoiAnnotation): void {
    this.aoiArray.push([aoi]);
  }

  removeAoi(aoiId: string): void {
    const arr = this.aoiArray.toArray();
    const idx = arr.findIndex((a) => a.id === aoiId);
    if (idx !== -1) {
      this.aoiArray.delete(idx, 1);
    }
  }

  // --- Serialization ---

  toJSON(): RoomIntentState {
    const raw = {
      roomId: this.roomId,
      selectedEntity: this.getSelectedEntity(),
      activeLayers: this.getActiveLayers(),
      aois: this.getAois(),
      followLeaderId: this.getFollowLeaderId(),
      simTimeOffsetSec: this.getSimTimeOffset(),
    };
    return RoomIntentStateSchema.parse(raw);
  }

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update);
  }

  onUpdate(callback: (update: Uint8Array, origin: unknown) => void): () => void {
    const handler = (update: Uint8Array, origin: unknown) => {
      callback(update, origin);
    };
    this.doc.on('update', handler);
    return () => {
      this.doc.off('update', handler);
    };
  }
}
