import {
  BLS_LAU_DEFAULT_VINTAGE,
  BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER,
  BLS_LAU_SCHEMA_VERSION,
  type BlsLauMeasureCode,
  type BlsLauSeasonalCode,
  BlsLauSeriesIdSchema,
  type BlsLauUnit,
  type BlsLauVariableDefinition,
  BlsLauVariableDefinitionSchema,
  type BlsLauVariableDictionary,
  BlsLauVariableDictionarySchema,
  type EconomicEstimate,
  type EconomicGeography,
} from '@gev/contracts';

export { BLS_LAU_DEFAULT_VINTAGE, BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER, BLS_LAU_SCHEMA_VERSION };

/**
 * Versioned BLS LAU Variable Dictionary (V1.0.0).
 * Implements PLAN.md §10 Task 10.1 and ADR 0052.
 * Pure domain metadata with zero I/O.
 */
export const BLS_LAU_VARIABLES_V1: Record<string, BlsLauVariableDefinition> = {
  LAU_LABOR_FORCE: BlsLauVariableDefinitionSchema.parse({
    variable_id: 'LAU_LABOR_FORCE',
    measure_code: '06',
    metric_id: 'civilian-labor-force',
    label: 'Civilian Labor Force Headcount',
    statistical_definition:
      'Total civilian non-institutional population aged 16 and older who are either employed or actively seeking work during the reference week.',
    universe: 'Civilian non-institutional population aged 16 and older',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'cbsa'],
    tags: ['lau', 'labor-force', 'workforce', 'monthly'],
  }),

  LAU_EMPLOYED: BlsLauVariableDefinitionSchema.parse({
    variable_id: 'LAU_EMPLOYED',
    measure_code: '05',
    metric_id: 'employed-count',
    label: 'Total Employed Residents',
    statistical_definition:
      'Total number of resident civilians who, during the reference week, performed any paid work or were temporarily absent from work.',
    universe: 'Civilian non-institutional population aged 16 and older',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'cbsa'],
    tags: ['lau', 'employed', 'jobs', 'residents'],
  }),

  LAU_UNEMPLOYED: BlsLauVariableDefinitionSchema.parse({
    variable_id: 'LAU_UNEMPLOYED',
    measure_code: '04',
    metric_id: 'unemployed-count',
    label: 'Total Unemployed Residents',
    statistical_definition:
      'Total number of resident civilians who had no employment during the reference week, were available for work, and actively sought employment.',
    universe: 'Civilian non-institutional population aged 16 and older',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'cbsa'],
    tags: ['lau', 'unemployed', 'job-seekers', 'monthly'],
  }),

  LAU_RATE: BlsLauVariableDefinitionSchema.parse({
    variable_id: 'LAU_RATE',
    measure_code: '03',
    metric_id: 'unemployment-rate',
    label: 'Unemployment Rate (Percent)',
    statistical_definition:
      'Unemployment rate computed as total unemployed residents divided by total civilian labor force, multiplied by 100.',
    universe: 'Civilian non-institutional population aged 16 and older',
    unit: 'percent',
    supported_geographies: ['nation', 'state', 'county', 'cbsa'],
    tags: ['lau', 'rate', 'unemployment-rate', 'economic-indicator'],
  }),
};

export const BLS_LAU_VARIABLE_DICTIONARY_V1: BlsLauVariableDictionary =
  BlsLauVariableDictionarySchema.parse({
    schema_version: BLS_LAU_SCHEMA_VERSION,
    version: '1.0.0',
    program: 'lau',
    monthly_disclaimer: BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER,
    vintages_supported: [BLS_LAU_DEFAULT_VINTAGE, '2026-06', '2026-05', '2025-12'],
    variables: BLS_LAU_VARIABLES_V1,
  });

/**
 * Looks up a BLS LAU variable definition by variable ID (e.g. LAU_RATE), measure code (e.g. 03), or metric ID (e.g. unemployment-rate).
 */
export function lookupLauVariable(
  idOrMeasureOrMetric: string,
  dictionary: BlsLauVariableDictionary = BLS_LAU_VARIABLE_DICTIONARY_V1
): BlsLauVariableDefinition | undefined {
  if (dictionary.variables[idOrMeasureOrMetric]) {
    return dictionary.variables[idOrMeasureOrMetric];
  }
  return Object.values(dictionary.variables).find(
    (v) =>
      v.metric_id === idOrMeasureOrMetric ||
      v.measure_code === idOrMeasureOrMetric ||
      v.variable_id === idOrMeasureOrMetric
  );
}

/**
 * Gets a BLS LAU variable definition or throws a descriptive error.
 */
export function getLauVariableOrThrow(
  idOrMeasureOrMetric: string,
  dictionary: BlsLauVariableDictionary = BLS_LAU_VARIABLE_DICTIONARY_V1
): BlsLauVariableDefinition {
  const found = lookupLauVariable(idOrMeasureOrMetric, dictionary);
  if (!found) {
    throw new Error(
      `Unknown BLS LAU variable, measure, or metric identifier '${idOrMeasureOrMetric}' in dictionary v${dictionary.version}`
    );
  }
  return found;
}

/**
 * Validates that an EconomicGeography meets BLS LAU geographic rules.
 * Supported levels: county, cbsa, state, nation. Fails closed immediately on malformed FIPS/CBSA.
 */
export function validateLauGeography(geography: EconomicGeography): void {
  switch (geography.level) {
    case 'county': {
      if (!/^[0-9]{5}$/.test(geography.county_fips)) {
        throw new Error(
          `BLS LAU invalid county FIPS: '${geography.county_fips}'. Must be exactly 5 digits.`
        );
      }
      if (geography.state_fips && geography.county_fips.slice(0, 2) !== geography.state_fips) {
        throw new Error(
          `BLS LAU county FIPS '${geography.county_fips}' does not match state FIPS '${geography.state_fips}'`
        );
      }
      break;
    }
    case 'cbsa': {
      if (!/^[0-9]{5}$/.test(geography.cbsa_code)) {
        throw new Error(
          `BLS LAU invalid CBSA code: '${geography.cbsa_code}'. Must be exactly 5 digits.`
        );
      }
      break;
    }
    case 'state': {
      if (!/^[0-9]{2}$/.test(geography.state_fips)) {
        throw new Error(
          `BLS LAU invalid state FIPS: '${geography.state_fips}'. Must be exactly 2 digits.`
        );
      }
      break;
    }
    case 'nation': {
      if (geography.country_code !== 'US') {
        throw new Error(
          `BLS LAU nation geography must have country_code 'US'. Received '${geography.country_code}'.`
        );
      }
      break;
    }
    default: {
      throw new Error(
        `Unsupported geography level '${(geography as { level: string }).level}' for BLS LAU queries. Expected county, cbsa, state, or nation.`
      );
    }
  }
}

export interface BuildLauSeriesIdOptions {
  geography: EconomicGeography;
  measure: BlsLauMeasureCode;
  seasonal?: BlsLauSeasonalCode;
}

/**
 * Deterministically constructs a canonical 17-character BLS LAU series identifier.
 * Structure:
 * - 'LA' (prefix)
 * - Seasonal indicator: 'U' (not seasonally adjusted) or 'S' (seasonally adjusted)
 * - Area type: 'CN' (county), 'MT' (metropolitan CBSA), 'ST' (state), 'US' (nation)
 * - Area code (10 characters padded):
 *   - County: 2-digit state + 3-digit county + '00000'
 *   - CBSA: 5-digit CBSA + '00000'
 *   - State: 2-digit state + '00000000'
 *   - Nation: '0000000000'
 * - Measure code: '03' (rate), '04' (unemployed), '05' (employed), '06' (labor force)
 */
export function buildLauSeriesId(options: BuildLauSeriesIdOptions): string {
  const { geography, measure, seasonal = 'U' } = options;
  validateLauGeography(geography);

  let areaType: string;
  let areaCode: string;

  switch (geography.level) {
    case 'county':
      areaType = 'CN';
      areaCode = `${geography.county_fips}00000`;
      break;
    case 'cbsa':
      areaType = 'MT';
      areaCode = `${geography.cbsa_code}00000`;
      break;
    case 'state':
      areaType = 'ST';
      areaCode = `${geography.state_fips}00000000`;
      break;
    case 'nation':
      areaType = 'US';
      areaCode = '0000000000';
      break;
    default:
      throw new Error(
        `Unsupported geography level '${(geography as { level: string }).level}' for BLS LAU series ID.`
      );
  }

  const seriesId = `LA${seasonal}${areaType}${areaCode}${measure}`;
  return BlsLauSeriesIdSchema.parse(seriesId);
}

export interface ParsedLauSeriesId {
  seasonal: BlsLauSeasonalCode;
  area_type: string;
  area_code: string;
  measure_code: BlsLauMeasureCode;
}

/**
 * Parses a canonical BLS LAU series ID into its constituent components.
 */
export function parseLauSeriesId(seriesId: string): ParsedLauSeriesId {
  BlsLauSeriesIdSchema.parse(seriesId);
  const seasonal = seriesId[2] as BlsLauSeasonalCode;
  const area_type = seriesId.slice(3, 5);
  const area_code = seriesId.slice(5, 15);
  const measure_code = seriesId.slice(15, 17) as BlsLauMeasureCode;

  return {
    seasonal,
    area_type,
    area_code,
    measure_code,
  };
}

export interface ParseLauRawEstimateOptions {
  unit?: BlsLauUnit;
  notes?: string;
}

/**
 * Pure parser transforming raw BLS LAU cells into an EconomicEstimate.
 * Strictly enforces zero numeric zero-coercion.
 */
export function parseLauRawEstimate(
  rawVal: string | number | null | undefined,
  options: ParseLauRawEstimateOptions = {}
): EconomicEstimate {
  const unit = options.unit ?? 'count';

  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return {
      status: 'unavailable',
      reason: 'BLS LAU estimate value is missing from the response.',
    };
  }

  const valStr = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal);

  if (valStr === '-' || valStr === '***' || valStr.toUpperCase() === 'N') {
    return {
      status: 'unavailable',
      reason: 'BLS LAU estimate not available or not released for this area and period.',
    };
  }

  if (valStr.toUpperCase() === 'D' || valStr === '(8)') {
    return {
      status: 'suppressed',
      reason: 'disclosure_avoidance',
      detail:
        'BLS LAU confidentiality suppression: estimate withheld to avoid disclosing operations of individual entities.',
      unit,
    };
  }

  const numericVal = Number(valStr);
  if (!Number.isFinite(numericVal)) {
    return {
      status: 'unavailable',
      reason: `BLS LAU estimate could not be parsed as a finite number: '${valStr}'.`,
    };
  }

  return {
    status: 'available',
    value: numericVal,
    margin_of_error: null,
    confidence_level: null,
    sample_size: null,
    unit,
    notes: options.notes,
  };
}
