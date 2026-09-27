import {
  type EconomicEstimate,
  type EconomicGeography,
  FEMA_NFHL_ADVISORY_DISCLAIMER,
  FEMA_NFHL_DEFAULT_VINTAGE,
  FEMA_NFHL_SCHEMA_VERSION,
  type FemaNfhlRiskCategory,
  type FemaNriRiskRating,
  type FemaNriUnit,
} from '@gev/contracts';

export * from './femaNriVariables.js';

export { FEMA_NFHL_SCHEMA_VERSION, FEMA_NFHL_DEFAULT_VINTAGE, FEMA_NFHL_ADVISORY_DISCLAIMER };

/**
 * Validates that an EconomicGeography meets FEMA NRI spatial constraints.
 */
export function validateFemaNriGeography(geography: EconomicGeography): void {
  const allowed = ['county', 'tract', 'state'];
  if (!allowed.includes(geography.level)) {
    throw new Error(
      `FEMA NRI supports geographies: ${allowed.join(', ')}. Received unsupported level '${geography.level}'`
    );
  }
}

/**
 * Classifies a FEMA NFHL flood zone and optional subtype into standardized risk tiers.
 * Strictly avoids coercing undetermined zones (Zone D) into minimal risk.
 */
export function classifyNfhlFloodRisk(zone: string, subtype?: string | null): FemaNfhlRiskCategory {
  const normalizedZone = zone.trim().toUpperCase();
  const normalizedSubtype = subtype ? subtype.trim().toUpperCase() : '';

  // Special Flood Hazard Areas (SFHA / 100-year / 1% annual chance)
  if (
    normalizedZone === 'A' ||
    normalizedZone === 'AE' ||
    normalizedZone.startsWith('A1-') ||
    normalizedZone === 'AH' ||
    normalizedZone === 'AO' ||
    normalizedZone === 'AR' ||
    normalizedZone === 'A99' ||
    normalizedZone === 'V' ||
    normalizedZone === 'VE' ||
    normalizedZone.startsWith('V1-') ||
    normalizedZone === 'VO'
  ) {
    return 'high_risk_sfha';
  }

  // 500-year moderate risk (0.2% annual chance)
  if (
    normalizedZone === 'B' ||
    (normalizedZone === 'X' && normalizedSubtype.includes('0.2 PCT ANNUAL CHANCE'))
  ) {
    return 'moderate_risk_500yr';
  }

  // Minimal risk outside 500-year
  if (
    normalizedZone === 'C' ||
    (normalizedZone === 'X' && !normalizedSubtype.includes('0.2 PCT ANNUAL CHANCE'))
  ) {
    return 'minimal_risk_outside_sfha';
  }

  // Undetermined risk (Crucial non-coercion rule: Zone D is NOT minimal risk)
  if (normalizedZone === 'D') {
    return 'undetermined_risk_zone_d';
  }

  return 'unknown';
}

/**
 * Parses a qualitative risk rating string into a standard FemaNriRiskRating.
 */
export function parseNriRiskRating(rating: string | null | undefined): FemaNriRiskRating {
  if (!rating || typeof rating !== 'string') {
    return 'Not Applicable';
  }
  const clean = rating.trim();
  switch (clean.toLowerCase()) {
    case 'very low':
      return 'Very Low';
    case 'relatively low':
      return 'Relatively Low';
    case 'relatively moderate':
      return 'Relatively Moderate';
    case 'relatively high':
      return 'Relatively High';
    case 'very high':
      return 'Very High';
    case 'insufficient data':
      return 'Insufficient Data';
    default:
      return 'Not Applicable';
  }
}

/**
 * Pure parser for raw FEMA NRI estimate values.
 * Strictly preserves non-applicable/suppressed values without numeric zero-coercion.
 */
export function parseNriRawEstimate(
  rawVal: unknown,
  unit: FemaNriUnit,
  notes?: string
): EconomicEstimate {
  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return {
      status: 'unavailable',
      reason: 'FEMA NRI estimate is missing or not reported for this area.',
    };
  }

  const str = String(rawVal).trim();

  if (str === 'N/A' || str === 'Not Applicable' || str === '-9999' || str === 'NA' || str === '-') {
    return {
      status: 'not_applicable',
      reason: 'Hazard or exposure metric is not applicable for this geography.',
    };
  }

  if (str === 'Insufficient Data' || str === 'Withheld' || str === 'Suppressed') {
    return {
      status: 'suppressed',
      reason: 'data_quality',
      detail: 'FEMA NRI metric withheld due to insufficient data or statistical variance.',
      unit,
    };
  }

  const num = Number(str);
  if (!Number.isFinite(num)) {
    return {
      status: 'unavailable',
      reason: `FEMA NRI estimate could not be parsed as a finite number: '${str}'.`,
    };
  }

  return {
    status: 'available',
    value: num,
    margin_of_error: null,
    confidence_level: null,
    sample_size: null,
    unit,
    notes,
  };
}

/**
 * Pure parser for FEMA NFHL Base Flood Elevation (BFE).
 * Non-coercion law: unstudied or not-applicable BFE values are NEVER coerced to 0.0 elevation.
 */
export function parseNfhlStaticBfe(rawBfe: unknown, datum?: string | null): EconomicEstimate {
  if (
    rawBfe === null ||
    rawBfe === undefined ||
    rawBfe === '' ||
    rawBfe === -9999 ||
    rawBfe === '-9999'
  ) {
    return {
      status: 'not_applicable',
      reason: 'Base Flood Elevation is not defined or not applicable for this flood hazard area.',
    };
  }

  const num = Number(rawBfe);
  if (!Number.isFinite(num)) {
    return {
      status: 'unavailable',
      reason: `NFHL static BFE could not be parsed: '${String(rawBfe)}'.`,
    };
  }

  return {
    status: 'available',
    value: num,
    margin_of_error: null,
    confidence_level: null,
    sample_size: null,
    unit: 'feet',
    notes: datum ? `Vertical Datum: ${datum}` : undefined,
  };
}

/**
 * Pure parser for FEMA NFHL flood depth.
 * Non-coercion law: depth is not applicable outside shallow flooding zones (AO/AH).
 */
export function parseNfhlDepth(rawDepth: unknown): EconomicEstimate {
  if (
    rawDepth === null ||
    rawDepth === undefined ||
    rawDepth === '' ||
    rawDepth === -9999 ||
    rawDepth === '-9999'
  ) {
    return {
      status: 'not_applicable',
      reason: 'Flood depth is only defined in shallow flooding zones (AO/AH).',
    };
  }

  const num = Number(rawDepth);
  if (!Number.isFinite(num)) {
    return {
      status: 'unavailable',
      reason: `NFHL flood depth could not be parsed: '${String(rawDepth)}'.`,
    };
  }

  return {
    status: 'available',
    value: num,
    margin_of_error: null,
    confidence_level: null,
    sample_size: null,
    unit: 'feet',
  };
}
