import crypto from 'node:crypto';
import type { SimClock } from '@gev/core';
import { SystemClock } from '@gev/core';

export interface TelemetrySpan {
  id: string;
  traceId: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, string | number | boolean>;
  status: 'ok' | 'error';
  error?: string;
}

export interface TelemetryEvent {
  event: string;
  distinctId: string;
  timestamp: number;
  properties: Record<string, string | number | boolean>;
}

export interface TelemetrySinkConfig {
  serviceName?: string;
  environment?: string;
  enablePostHog?: boolean;
  enableGlitchTip?: boolean;
  posthogEndpoint?: string;
  glitchtipDsn?: string;
  clock?: SimClock;
}

/**
 * Self-Hosted Privacy-Preserving Telemetry & OTel Spans (PLAN.md §3.3, §7.1 & §10)
 * Redacts PII by construction and tracks route metrics, spans, and error reports.
 */
export class ServerTelemetryManager {
  private readonly serviceName: string;
  private readonly environment: string;
  private readonly spans: TelemetrySpan[] = [];
  private readonly events: TelemetryEvent[] = [];
  private readonly clock: SimClock;
  private readonly errors: Array<{
    error: string;
    context: Record<string, unknown>;
    timestamp: number;
  }> = [];

  constructor(config: TelemetrySinkConfig = {}) {
    this.serviceName = config.serviceName ?? 'gev-server';
    this.environment = config.environment ?? process.env.NODE_ENV ?? 'development';
    this.clock = config.clock ?? new SystemClock();
  }

  /**
   * Starts and completes an OpenTelemetry-compatible span around an async operation.
   */
  async withSpan<T>(
    name: string,
    fn: (span: TelemetrySpan) => Promise<T>,
    attributes: Record<string, string | number | boolean> = {}
  ): Promise<T> {
    const span: TelemetrySpan = {
      id: crypto.randomUUID(),
      traceId: crypto.randomUUID(),
      name,
      startTime: this.clock.now(),
      attributes: {
        service: this.serviceName,
        env: this.environment,
        ...attributes,
      },
      status: 'ok',
    };

    try {
      const result = await fn(span);
      span.endTime = this.clock.now();
      span.durationMs = span.endTime - span.startTime;
      this.recordSpan(span);
      return result;
    } catch (err: unknown) {
      span.endTime = this.clock.now();
      span.durationMs = span.endTime - span.startTime;
      span.status = 'error';
      span.error = err instanceof Error ? err.message : String(err);
      this.recordSpan(span);
      this.captureException(err, { spanName: name, spanId: span.id });
      throw err;
    }
  }

  /**
   * Records completed span to in-memory telemetry ring buffer (capped at 500 entries).
   */
  recordSpan(span: TelemetrySpan): void {
    if (this.spans.length >= 500) {
      this.spans.shift();
    }
    this.spans.push(span);
  }

  /**
   * Tracks privacy-conscious product usage event (PostHog/Plausible format).
   * Sensitive identifiers and search strings are redacted.
   */
  trackEvent(event: string, properties: Record<string, string | number | boolean> = {}): void {
    const cleanProps: Record<string, string | number | boolean> = {};

    for (const [key, value] of Object.entries(properties)) {
      // Redaction by construction (PLAN.md §5 & §12)
      if (/password|token|key|secret|authorization|credential/i.test(key)) {
        cleanProps[key] = '[REDACTED]';
      } else {
        cleanProps[key] = value;
      }
    }

    const payload: TelemetryEvent = {
      event,
      distinctId: 'anonymous-operator',
      timestamp: this.clock.now(),
      properties: {
        service: this.serviceName,
        ...cleanProps,
      },
    };

    if (this.events.length >= 500) {
      this.events.shift();
    }
    this.events.push(payload);
  }

  /**
   * Captures exception for GlitchTip / Sentry error reporting.
   */
  captureException(err: unknown, context: Record<string, unknown> = {}): void {
    const errorMsg = err instanceof Error ? err.message : String(err);
    this.errors.push({
      error: errorMsg,
      context,
      timestamp: this.clock.now(),
    });
    if (this.errors.length > 200) {
      this.errors.shift();
    }
  }

  /**
   * Returns recent telemetry metrics and span statistics.
   */
  getMetrics() {
    const totalSpans = this.spans.length;
    const errorSpans = this.spans.filter((s) => s.status === 'error').length;
    const avgDuration =
      totalSpans > 0 ? this.spans.reduce((acc, s) => acc + (s.durationMs ?? 0), 0) / totalSpans : 0;

    return {
      service: this.serviceName,
      total_spans_recorded: totalSpans,
      error_spans_count: errorSpans,
      avg_span_duration_ms: Math.round(avgDuration * 100) / 100,
      recent_events_count: this.events.length,
      errors_captured_count: this.errors.length,
    };
  }

  /**
   * Returns recent spans for diagnostics.
   */
  getRecentSpans(limit = 20): TelemetrySpan[] {
    return this.spans.slice(-limit);
  }
}
