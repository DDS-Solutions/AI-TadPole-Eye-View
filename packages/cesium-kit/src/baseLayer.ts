import type { SimClock } from '@gev/core';
import { SystemClock } from '@gev/core';
import { CustomDataSource, type Entity, type Viewer } from 'cesium';

export interface BaseLayerOptions {
  viewer: Viewer;
  clock?: SimClock;
  dataSourceName?: string;
}

/**
 * Abstract Base Layer Controller (Rule 1 & Rule 5)
 * Consolidates rAF-coalesced ingestion, entity reconciliation, lifecycle, and event suspension
 * across all Cesium telemetry layer controllers.
 */
export abstract class BaseLayerController<
  TItem,
  TOptions extends BaseLayerOptions = BaseLayerOptions,
> {
  public readonly dataSource: CustomDataSource;
  public readonly clock: SimClock;
  protected readonly viewer: Viewer;
  protected readonly entityMap = new Map<string, Entity>();
  protected pendingUpdates: TItem[] = [];
  private rafHandle: number | null = null;
  protected isDestroyed = false;

  constructor(options: TOptions, defaultDataSourceName: string) {
    this.viewer = options.viewer;
    this.clock = options.clock ?? new SystemClock();
    this.dataSource = new CustomDataSource(options.dataSourceName ?? defaultDataSourceName);
    this.viewer.dataSources.add(this.dataSource);
  }

  /**
   * Enqueues a batch of updates for the next rAF drain cycle.
   */
  protected enqueueUpdates(items: TItem[]): void {
    if (this.isDestroyed) return;
    this.pendingUpdates = items;
    this.scheduleRafDrain();
  }

  /**
   * Toggles visibility of the entire layer data source.
   */
  setVisible(visible: boolean): void {
    this.dataSource.show = visible;
  }

  /**
   * Gets current active entity count.
   */
  getEntityCount(): number {
    return this.entityMap.size;
  }

  /**
   * Gets all active entity IDs in this layer.
   */
  getEntityIds(): string[] {
    return Array.from(this.entityMap.keys());
  }

  /**
   * Extracts the unique entity ID for a given telemetry item.
   */
  protected abstract getEntityId(item: TItem): string;

  /**
   * Creates or updates a Cesium entity for the given telemetry item.
   */
  protected abstract processEntity(item: TItem, id: string): void;

  /**
   * Optional hook called immediately after suspending events before entity loop.
   */
  protected beforeDrain?(): void;

  /**
   * Optional hook called before resuming events after entity loop and reconciliation.
   */
  protected afterDrain?(): void;

  /**
   * Schedules a single rAF drain if not already pending.
   */
  private scheduleRafDrain(): void {
    if (this.rafHandle !== null || typeof requestAnimationFrame !== 'function') {
      if (typeof requestAnimationFrame !== 'function') {
        this.drainQueue();
      }
      return;
    }

    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.drainQueue();
    });
  }

  /**
   * Drains all pending updates into Cesium entities in a single frame with entity reconciliation.
   */
  private drainQueue(): void {
    if (this.pendingUpdates.length === 0 || this.isDestroyed) return;

    const updates = this.pendingUpdates;
    this.pendingUpdates = [];

    this.dataSource.entities.suspendEvents();
    this.beforeDrain?.();

    const seenIds = new Set<string>();

    for (let i = 0; i < updates.length; i++) {
      const item = updates[i];
      if (!item) continue;

      const id = this.getEntityId(item);
      if (!id) continue;

      seenIds.add(id);
      this.processEntity(item, id);
    }

    // Reconcile: remove entities absent from latest snapshot
    for (const [id, entity] of this.entityMap) {
      if (!seenIds.has(id)) {
        this.dataSource.entities.removeById(entity.id);
        this.entityMap.delete(id);
      }
    }

    this.afterDrain?.();
    this.dataSource.entities.resumeEvents();
  }

  /**
   * Destroys the layer, cancels pending frames, and removes entities from Cesium.
   */
  destroy(): void {
    this.isDestroyed = true;
    if (this.rafHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.viewer.dataSources.remove(this.dataSource, true);
    this.entityMap.clear();
    this.pendingUpdates = [];
  }
}
