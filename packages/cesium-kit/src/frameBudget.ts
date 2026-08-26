import { type SimClock, SystemClock } from '@gev/core';
import type { Scene } from 'cesium';

export interface FrameMetrics {
  totalFrames: number;
  elapsedSec: number;
  instantaneousFps: number;
  averageFps: number;
  minDeltaMs: number;
  maxDeltaMs: number;
  avgDeltaMs: number;
  p50DeltaMs: number;
  p95DeltaMs: number;
  p99DeltaMs: number;
  breachCount: number;
  breachRatePct: number;
}

export interface FrameBudgetReport {
  targetBudgetMs: number;
  targetFps: number;
  passed: boolean;
  metrics: FrameMetrics;
  timestamp: number;
}

export interface FrameBudgetMonitorOptions {
  targetBudgetMs?: number; // default 16.66ms for 60 FPS
  targetFps?: number; // default 60
  sampleWindowSize?: number; // default 120 frames
  clock?: SimClock;
}

/**
 * Frame Budget Monitor (PLAN.md §10 Phase 2 & ADR-0025)
 * Tracks rendering frame deltas, FPS statistics, and 60 FPS budget violations (< 16.66ms p95).
 */
export class FrameBudgetMonitor {
  public readonly targetBudgetMs: number;
  public readonly targetFps: number;
  public readonly sampleWindowSize: number;
  public readonly clock: SimClock;

  private frameTimes: number[] = [];
  private lastFrameTimestamp: number | null = null;
  private totalFrames = 0;
  private breachCount = 0;
  private startTime: number;
  private sceneEventListenerRemover: (() => void) | null = null;
  private isMonitoring = false;

  constructor(options: FrameBudgetMonitorOptions = {}) {
    this.targetBudgetMs = options.targetBudgetMs ?? 16.666;
    this.targetFps = options.targetFps ?? 60;
    this.sampleWindowSize = options.sampleWindowSize ?? 120;
    this.clock = options.clock ?? new SystemClock();
    this.startTime = this.clock.now();
  }

  /**
   * Records a single frame event with the given high-resolution timestamp (ms).
   */
  recordFrame(nowMs?: number): number {
    const timestamp =
      nowMs ?? (typeof performance !== 'undefined' ? performance.now() : this.clock.now());
    this.totalFrames++;

    if (this.lastFrameTimestamp === null) {
      this.lastFrameTimestamp = timestamp;
      return 0;
    }

    const deltaMs = Math.max(0, timestamp - this.lastFrameTimestamp);
    this.lastFrameTimestamp = timestamp;

    this.frameTimes.push(deltaMs);
    if (this.frameTimes.length > this.sampleWindowSize) {
      this.frameTimes.shift();
    }

    if (deltaMs > this.targetBudgetMs) {
      this.breachCount++;
    }

    return deltaMs;
  }

  /**
   * Attaches to a Cesium Scene postRender event to monitor frames automatically.
   */
  attachToScene(scene: Scene): void {
    if (this.sceneEventListenerRemover) {
      this.detach();
    }

    this.isMonitoring = true;
    this.startTime = this.clock.now();
    this.lastFrameTimestamp = null;

    const removeCallback = scene.postRender.addEventListener(() => {
      this.recordFrame();
    });

    this.sceneEventListenerRemover = () => {
      removeCallback();
      this.isMonitoring = false;
    };
  }

  /**
   * Detaches the monitor from any active Cesium scene event listener.
   */
  detach(): void {
    if (this.sceneEventListenerRemover) {
      this.sceneEventListenerRemover();
      this.sceneEventListenerRemover = null;
    }
    this.isMonitoring = false;
  }

  /**
   * Calculates rolling and cumulative frame metrics.
   */
  getMetrics(): FrameMetrics {
    const samples = [...this.frameTimes];
    const n = samples.length;
    const now = this.clock.now();
    const elapsedSec = Math.max(0.001, (now - this.startTime) / 1000);

    if (n === 0) {
      return {
        totalFrames: this.totalFrames,
        elapsedSec,
        instantaneousFps: 0,
        averageFps: 0,
        minDeltaMs: 0,
        maxDeltaMs: 0,
        avgDeltaMs: 0,
        p50DeltaMs: 0,
        p95DeltaMs: 0,
        p99DeltaMs: 0,
        breachCount: this.breachCount,
        breachRatePct: 0,
      };
    }

    const lastDelta = samples[samples.length - 1] ?? 16.66;
    const instantaneousFps = lastDelta > 0 ? Math.min(240, 1000 / lastDelta) : 60;
    const averageFps = this.totalFrames / elapsedSec;

    let sum = 0;
    let min = samples[0] ?? 0;
    let max = samples[0] ?? 0;

    for (let i = 0; i < n; i++) {
      const v = samples[i] ?? 0;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const avg = sum / n;

    // Percentiles from sorted window
    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = this.getPercentile(sorted, 50);
    const p95 = this.getPercentile(sorted, 95);
    const p99 = this.getPercentile(sorted, 99);

    const breachRatePct = this.totalFrames > 0 ? (this.breachCount / this.totalFrames) * 100 : 0;

    return {
      totalFrames: this.totalFrames,
      elapsedSec,
      instantaneousFps: Number(instantaneousFps.toFixed(1)),
      averageFps: Number(averageFps.toFixed(1)),
      minDeltaMs: Number(min.toFixed(2)),
      maxDeltaMs: Number(max.toFixed(2)),
      avgDeltaMs: Number(avg.toFixed(2)),
      p50DeltaMs: Number(p50.toFixed(2)),
      p95DeltaMs: Number(p95.toFixed(2)),
      p99DeltaMs: Number(p99.toFixed(2)),
      breachCount: this.breachCount,
      breachRatePct: Number(breachRatePct.toFixed(2)),
    };
  }

  /**
   * Generates a pass/fail Frame Budget Report against the 60 FPS target threshold.
   */
  getReport(): FrameBudgetReport {
    const metrics = this.getMetrics();
    // Target: p95 frame latency < targetBudgetMs (16.66ms for 60 FPS)
    const passed = metrics.totalFrames > 0 && metrics.p95DeltaMs <= this.targetBudgetMs;

    return {
      targetBudgetMs: this.targetBudgetMs,
      targetFps: this.targetFps,
      passed,
      metrics,
      timestamp: this.clock.now(),
    };
  }

  /**
   * Computes a nearest-rank percentile value from sorted numeric array.
   */
  private getPercentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
    );
    return sorted[index] ?? 0;
  }

  /**
   * Resets all accumulated samples and counters.
   */
  reset(): void {
    this.frameTimes = [];
    this.lastFrameTimestamp = null;
    this.totalFrames = 0;
    this.breachCount = 0;
    this.startTime = this.clock.now();
  }

  /**
   * Checks if monitor is actively attached to a scene.
   */
  isActive(): boolean {
    return this.isMonitoring;
  }
}
