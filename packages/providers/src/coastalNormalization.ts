import type {
  CoastalCurrentObservation,
  CoastalCurrentPrediction,
  CoastalStation,
  CoastalTidePrediction,
  CoastalValue,
  CoastalWaterLevelObservation,
} from '@gev/contracts';
import type { RawProductResponse } from './coastalPayloads.js';
import {
  type CoopsInstant,
  coopsInstant,
  nullableNumber,
  numericValue,
  strings,
} from './coastalValues.js';

export const COOPS_MAX_STALE_MS = 1_800_000;
export const STATION_COLLECTION_TYPES = [
  'waterlevels',
  'tidepredictions',
  'currents',
  'currentpredictions',
] as const;

export type StationCollectionType = (typeof STATION_COLLECTION_TYPES)[number];
export type StationType = CoastalStation['station_types'][number];
export type CoastalProduct = 'water_level' | 'predictions' | 'currents' | 'currents_predictions';

export function stationType(collectionType: StationCollectionType): StationType {
  return {
    waterlevels: 'water_level',
    tidepredictions: 'tide_prediction',
    currents: 'current',
    currentpredictions: 'current_prediction',
  }[collectionType] as StationType;
}

export function productFor(type: StationType): CoastalProduct {
  return {
    water_level: 'water_level',
    tide_prediction: 'predictions',
    current: 'currents',
    current_prediction: 'currents_predictions',
  }[type] as CoastalProduct;
}

export function normalizeWaterObservations(
  response: RawProductResponse | undefined,
  now: number,
  timeCache: Map<string, CoopsInstant>,
  valueCache: Map<string, CoastalValue>,
  stringCache: Map<string, string[]>
): CoastalWaterLevelObservation[] {
  const normalized: CoastalWaterLevelObservation[] = [];
  for (const record of response?.data ?? []) {
    const observedAt = coopsInstant(record.t, 'CO-OPS water-level observation time', timeCache);
    const age = now - observedAt.milliseconds;
    if (age < -300_000 || age > COOPS_MAX_STALE_MS) continue;
    const quality = String(record.q ?? '').toLowerCase();
    normalized.push({
      observed_at: observedAt.iso,
      value: numericValue(record.v, 'Water level', valueCache),
      sigma: nullableNumber(record.s),
      quality: quality === 'p' ? 'preliminary' : quality === 'v' ? 'verified' : 'unknown',
      flags: strings(record.f, stringCache),
    });
  }
  return normalized;
}

export function normalizeTidePredictions(
  response: RawProductResponse | undefined,
  now: number,
  timeCache: Map<string, CoopsInstant>,
  valueCache: Map<string, CoastalValue>
): CoastalTidePrediction[] {
  return (response?.predictions ?? []).flatMap((record) => {
    const validAt = coopsInstant(record.t, 'CO-OPS tide prediction time', timeCache);
    if (validAt.milliseconds < now) return [];
    const tideType = ['HH', 'H', 'L', 'LL'].includes(String(record.type ?? record.ty))
      ? (String(record.type ?? record.ty) as CoastalTidePrediction['tide_type'])
      : null;
    return [
      {
        valid_at: validAt.iso,
        value: numericValue(record.v, 'Predicted water level', valueCache),
        tide_type: tideType,
      },
    ];
  });
}

export function normalizeCurrentObservations(
  response: RawProductResponse | undefined,
  now: number,
  timeCache: Map<string, CoopsInstant>,
  valueCache: Map<string, CoastalValue>,
  stringCache: Map<string, string[]>
): CoastalCurrentObservation[] {
  return (response?.data ?? []).flatMap((record) => {
    const observedAt = coopsInstant(record.t, 'CO-OPS current observation time', timeCache);
    const age = now - observedAt.milliseconds;
    if (age < -300_000 || age > COOPS_MAX_STALE_MS) return [];
    const bin = Number(record.b);
    return [
      {
        observed_at: observedAt.iso,
        speed: numericValue(record.s, 'Current speed', valueCache),
        direction_deg: numericValue(record.d, 'Current direction', valueCache),
        bin: Number.isInteger(bin) && bin >= 0 ? bin : null,
        quality_flags: strings(record.f ?? record.q, stringCache),
      },
    ];
  });
}

function currentPredictionRecords(response: RawProductResponse | undefined) {
  const value = response?.current_predictions;
  return Array.isArray(value) ? value : (value?.cp ?? response?.predictions ?? []);
}

export function normalizeCurrentPredictions(
  response: RawProductResponse | undefined,
  now: number,
  timeCache: Map<string, CoopsInstant>,
  valueCache: Map<string, CoastalValue>
): CoastalCurrentPrediction[] {
  return currentPredictionRecords(response).flatMap((record) => {
    const validAt = coopsInstant(
      record.Time ?? record.t,
      'CO-OPS current prediction time',
      timeCache
    );
    if (validAt.milliseconds < now) return [];
    const bin = Number(record.Bin ?? record.b);
    return [
      {
        valid_at: validAt.iso,
        speed: numericValue(record.Speed ?? record.s, 'Predicted current speed', valueCache),
        direction_deg: numericValue(
          record.Direction ?? record.d,
          'Predicted current direction',
          valueCache
        ),
        velocity_major: numericValue(
          record.Velocity_Major,
          'Predicted major-axis velocity',
          valueCache
        ),
        mean_ebb_direction_deg: numericValue(record.meanEbbDir, 'Mean ebb direction', valueCache),
        mean_flood_direction_deg: numericValue(
          record.meanFloodDir,
          'Mean flood direction',
          valueCache
        ),
        bin: Number.isInteger(bin) && bin >= 0 ? bin : null,
        depth: numericValue(record.Depth, 'Current-bin depth', valueCache),
      },
    ];
  });
}
