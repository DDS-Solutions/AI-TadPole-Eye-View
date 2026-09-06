import type { SolarContextResponse } from '@gev/contracts';
import { Cartesian3, Color, CustomDataSource, NearFarScalar, type Viewer } from 'cesium';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

export interface SolarContextLayerOptions {
  viewer: Viewer;
  dataSourceName?: string;
}

const BAND_COLORS = {
  sunset: CESIUM_DESIGN_TOKENS.solar.sunset,
  civil: CESIUM_DESIGN_TOKENS.solar.civil,
  nautical: CESIUM_DESIGN_TOKENS.solar.nautical,
  astronomical: CESIUM_DESIGN_TOKENS.solar.astronomical,
} as const;

/** Coalesces SimClock solar updates through rAF and applies at most one snapshot per second. */
export class SolarContextLayerController {
  readonly dataSource: CustomDataSource;
  private readonly viewer: Viewer;
  private pending: SolarContextResponse | null = null;
  private rafHandle: number | null = null;
  private lastAcceptedMs = Number.NEGATIVE_INFINITY;
  private destroyed = false;
  private appliedUpdates = 0;

  constructor(options: SolarContextLayerOptions) {
    this.viewer = options.viewer;
    this.dataSource = new CustomDataSource(options.dataSourceName ?? 'gev-solar-context');
    this.viewer.dataSources.add(this.dataSource);
  }

  enqueueContext(context: SolarContextResponse): void {
    const computedAt = Date.parse(context.computed_at);
    if (this.destroyed || computedAt - this.lastAcceptedMs < 1000) return;
    this.lastAcceptedMs = computedAt;
    this.pending = context;
    if (this.rafHandle !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      this.drain();
      return;
    }
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.drain();
    });
  }

  private drain(): void {
    const context = this.pending;
    this.pending = null;
    if (!context || this.destroyed) return;
    this.dataSource.entities.suspendEvents();
    this.dataSource.entities.removeAll();
    this.dataSource.entities.add({
      id: 'solar-subsolar-point',
      name: `Subsolar point at ${context.computed_at}`,
      position: Cartesian3.fromDegrees(
        context.subsolar_point.longitude,
        context.subsolar_point.latitude
      ),
      point: {
        pixelSize: 6,
        color: Color.fromCssColorString(CESIUM_DESIGN_TOKENS.solar.sunset),
        outlineColor: Color.fromCssColorString(CESIUM_DESIGN_TOKENS.outlines.default),
        outlineWidth: 1,
        scaleByDistance: new NearFarScalar(150, 1.5, 20_000_000, 0.6),
      },
      properties: { entityKind: 'solar-context', computedAt: context.computed_at },
    });
    for (const boundary of context.boundaries) {
      const degrees = boundary.coordinates.flatMap((point) => [point.longitude, point.latitude]);
      this.dataSource.entities.add({
        id: `solar-boundary-${boundary.band}`,
        name: `${boundary.band} solar boundary`,
        polyline: {
          positions: Cartesian3.fromDegreesArray(degrees),
          width: boundary.band === 'sunset' ? 2 : 1,
          material: Color.fromCssColorString(BAND_COLORS[boundary.band]).withAlpha(0.75),
        },
        properties: { entityKind: 'solar-context', ...boundary },
      });
    }
    this.dataSource.entities.resumeEvents();
    this.appliedUpdates += 1;
  }

  setVisible(visible: boolean): void {
    this.dataSource.show = visible;
  }

  getEntityCount(): number {
    return this.dataSource.entities.values.length;
  }

  getAppliedUpdateCount(): number {
    return this.appliedUpdates;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
    }
    this.viewer.dataSources.remove(this.dataSource, true);
    this.pending = null;
  }
}
