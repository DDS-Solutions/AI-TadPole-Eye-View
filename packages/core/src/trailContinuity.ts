const EARTH_MEAN_RADIUS_NM = 3_440.065;
const DEG_TO_RAD = Math.PI / 180;

export const DEFAULT_TRAIL_MAX_GAP_MS = 48 * 60_000;
export const DEFAULT_TRAIL_PARKED_WINDOW_MS = 3 * 3_600_000;
export const DEFAULT_TRAIL_PARKED_DISTANCE_NM = 0.1;
export const DEFAULT_TRAIL_MAX_SPEED_KNOTS = 1_500;

export interface TrailFix {
  readonly lat: number;
  readonly lon: number;
  readonly altitudeM?: number | null;
  readonly timeMs: number;
  readonly nullAltitude?: boolean;
}

export type TrailBreakReason =
  | 'non_advancing_time'
  | 'null_altitude'
  | 'gap_exceeded'
  | 'excessive_speed';

export interface TrailContinuityOptions {
  readonly maxGapMs?: number;
  readonly parkedWindowMs?: number;
  readonly parkedDistanceNm?: number;
  readonly maxSpeedKnots?: number;
  readonly requireAltitude?: boolean;
}

export interface TrailSegment<TFix extends TrailFix = TrailFix> {
  readonly fixes: readonly TFix[];
  readonly breakReasonBefore?: TrailBreakReason;
}

/** Computes spherical great-circle distance in nautical miles between two WGS84 coordinates. */
export function nauticalMilesBetween(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number
): number {
  const phi1 = latA * DEG_TO_RAD;
  const phi2 = latB * DEG_TO_RAD;
  const dPhi = (latB - latA) * DEG_TO_RAD;
  const dLambda = (lonB - lonA) * DEG_TO_RAD;
  const sinDPhi = Math.sin(dPhi * 0.5);
  const sinDLambda = Math.sin(dLambda * 0.5);
  const a = sinDPhi * sinDPhi + Math.cos(phi1) * Math.cos(phi2) * sinDLambda * sinDLambda;
  const clampedA = Math.min(1, Math.max(0, a));
  return 2 * EARTH_MEAN_RADIUS_NM * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
}

function hasValidAltitude(fix: TrailFix): boolean {
  if (fix.nullAltitude) return false;
  return typeof fix.altitudeM === 'number' && Number.isFinite(fix.altitudeM);
}

/**
 * Evaluates whether two consecutive fixes cannot form one continuous track segment.
 * Prevents straight-line teleport artifacts across outage gaps or invalid fixes.
 */
export function trailPairBreakReason(
  prev: TrailFix,
  curr: TrailFix,
  options: TrailContinuityOptions = {}
): TrailBreakReason | null {
  const maxGapMs = options.maxGapMs ?? DEFAULT_TRAIL_MAX_GAP_MS;
  const parkedWindowMs = options.parkedWindowMs ?? DEFAULT_TRAIL_PARKED_WINDOW_MS;
  const parkedDistanceNm = options.parkedDistanceNm ?? DEFAULT_TRAIL_PARKED_DISTANCE_NM;
  const maxSpeedKnots = options.maxSpeedKnots ?? DEFAULT_TRAIL_MAX_SPEED_KNOTS;
  const requireAltitude = options.requireAltitude ?? true;

  if (
    !Number.isFinite(prev.timeMs) ||
    !Number.isFinite(curr.timeMs) ||
    curr.timeMs <= prev.timeMs
  ) {
    return 'non_advancing_time';
  }

  if (requireAltitude && (!hasValidAltitude(prev) || !hasValidAltitude(curr))) {
    return 'null_altitude';
  }

  const dtMs = curr.timeMs - prev.timeMs;
  const distanceNm = nauticalMilesBetween(prev.lat, prev.lon, curr.lat, curr.lon);
  const isParked = dtMs <= parkedWindowMs && distanceNm <= parkedDistanceNm;

  if (!isParked && dtMs > maxGapMs) {
    return 'gap_exceeded';
  }

  const impliedKnots = distanceNm / (dtMs / 3_600_000);
  if (!Number.isFinite(impliedKnots) || impliedKnots > maxSpeedKnots) {
    return 'excessive_speed';
  }

  return null;
}

/** Splits chronological fixes into gap-free continuous segments without drawing across breaks. */
export function segmentTrailFixes<TFix extends TrailFix>(
  fixes: readonly TFix[],
  options: TrailContinuityOptions = {}
): TrailSegment<TFix>[] {
  if (fixes.length === 0) return [];
  const sorted = [...fixes].sort((left, right) => left.timeMs - right.timeMs);
  const segments: Array<{ fixes: TFix[]; breakReasonBefore?: TrailBreakReason }> = [];
  let current: { fixes: TFix[]; breakReasonBefore?: TrailBreakReason } = {
    fixes: [sorted[0] as TFix],
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as TFix;
    const curr = sorted[i] as TFix;
    const reason = trailPairBreakReason(prev, curr, options);
    if (reason !== null) {
      segments.push(current);
      current = { fixes: [curr], breakReasonBefore: reason };
    } else {
      current.fixes.push(curr);
    }
  }
  segments.push(current);
  return segments;
}
