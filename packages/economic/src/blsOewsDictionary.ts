import {
  BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER,
  BLS_OEWS_DEFAULT_VINTAGE,
  BLS_OEWS_SCHEMA_VERSION,
  type BlsOewsUnit,
  type BlsOewsVariableDefinition,
  BlsOewsVariableDefinitionSchema,
  type BlsOewsVariableDictionary,
  BlsOewsVariableDictionarySchema,
  BlsSocCodeSchema,
  type EconomicEstimate,
  type EconomicGeography,
} from '@gev/contracts';

export {
  BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER,
  BLS_OEWS_DEFAULT_VINTAGE,
  BLS_OEWS_SCHEMA_VERSION,
};

/**
 * Versioned BLS OEWS Variable Dictionary (V1.0.0).
 * Implements PLAN.md §10 Task 10.1 and ADR 0052.
 * Pure domain metadata with zero I/O.
 */
export const BLS_OEWS_VARIABLES_V1: Record<string, BlsOewsVariableDefinition> = {
  TOT_EMP: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'TOT_EMP',
    metric_id: 'total-employment',
    label: 'Total Employment Headcount',
    statistical_definition:
      'Estimated total occupational employment headcount for non-farm wage and salary workers in the designated area.',
    universe: 'Wage and salary workers in non-farm establishments',
    unit: 'count',
    wage_type: 'employment',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'employment', 'headcount', 'workforce'],
  }),

  EMP_PRSE: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'EMP_PRSE',
    metric_id: 'employment-prse',
    label: 'Employment Percent Relative Standard Error',
    statistical_definition:
      'Percent relative standard error (PRSE) of the employment estimate, reflecting sampling error reliability.',
    universe: 'Employment estimates',
    unit: 'percent',
    wage_type: 'employment',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'employment', 'prse', 'reliability'],
  }),

  H_MEAN: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'H_MEAN',
    metric_id: 'mean-hourly-wage',
    label: 'Mean Hourly Wage ($/hour)',
    statistical_definition:
      'Mean hourly wage rate computed as total estimated hourly wages divided by total employment.',
    universe: 'Hourly wage rate',
    unit: 'USD_per_hour',
    wage_type: 'hourly',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'hourly', 'mean'],
  }),

  A_MEAN: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'A_MEAN',
    metric_id: 'mean-annual-wage',
    label: 'Mean Annual Wage ($ USD)',
    statistical_definition:
      'Mean annual wage computed by multiplying the mean hourly wage by 2,080 hours or directly from annual survey data.',
    universe: 'Annual wage earnings',
    unit: 'USD',
    wage_type: 'annual',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'annual', 'mean'],
  }),

  MEAN_PRSE: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'MEAN_PRSE',
    metric_id: 'mean-wage-prse',
    label: 'Mean Wage Percent Relative Standard Error',
    statistical_definition:
      'Percent relative standard error (PRSE) of the mean wage estimate, reflecting sampling variation.',
    universe: 'Mean wage estimates',
    unit: 'percent',
    wage_type: 'general',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'prse', 'reliability'],
  }),

  H_PCT10: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'H_PCT10',
    metric_id: 'hourly-10th-percentile-wage',
    label: '10th Percentile Hourly Wage ($/hour)',
    statistical_definition:
      'Hourly wage rate below which 10 percent of workers in the occupation earn.',
    universe: 'Hourly wage distribution',
    unit: 'USD_per_hour',
    wage_type: 'hourly',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'hourly', 'percentile-10'],
  }),

  H_PCT25: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'H_PCT25',
    metric_id: 'hourly-25th-percentile-wage',
    label: '25th Percentile Hourly Wage ($/hour)',
    statistical_definition:
      'Hourly wage rate below which 25 percent of workers in the occupation earn.',
    universe: 'Hourly wage distribution',
    unit: 'USD_per_hour',
    wage_type: 'hourly',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'hourly', 'percentile-25'],
  }),

  H_MEDIAN: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'H_MEDIAN',
    metric_id: 'hourly-median-wage',
    label: 'Median Hourly Wage ($/hour)',
    statistical_definition:
      '50th percentile (median) hourly wage rate at which 50 percent of workers earn less and 50 percent earn more.',
    universe: 'Hourly wage distribution',
    unit: 'USD_per_hour',
    wage_type: 'hourly',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'hourly', 'median'],
  }),

  H_PCT75: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'H_PCT75',
    metric_id: 'hourly-75th-percentile-wage',
    label: '75th Percentile Hourly Wage ($/hour)',
    statistical_definition:
      'Hourly wage rate below which 75 percent of workers in the occupation earn.',
    universe: 'Hourly wage distribution',
    unit: 'USD_per_hour',
    wage_type: 'hourly',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'hourly', 'percentile-75'],
  }),

  H_PCT90: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'H_PCT90',
    metric_id: 'hourly-90th-percentile-wage',
    label: '90th Percentile Hourly Wage ($/hour)',
    statistical_definition:
      'Hourly wage rate below which 90 percent of workers in the occupation earn.',
    universe: 'Hourly wage distribution',
    unit: 'USD_per_hour',
    wage_type: 'hourly',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'hourly', 'percentile-90'],
  }),

  A_PCT10: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'A_PCT10',
    metric_id: 'annual-10th-percentile-wage',
    label: '10th Percentile Annual Wage ($ USD)',
    statistical_definition:
      'Annual wage earnings below which 10 percent of workers in the occupation earn.',
    universe: 'Annual wage distribution',
    unit: 'USD',
    wage_type: 'annual',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'annual', 'percentile-10'],
  }),

  A_PCT25: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'A_PCT25',
    metric_id: 'annual-25th-percentile-wage',
    label: '25th Percentile Annual Wage ($ USD)',
    statistical_definition:
      'Annual wage earnings below which 25 percent of workers in the occupation earn.',
    universe: 'Annual wage distribution',
    unit: 'USD',
    wage_type: 'annual',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'annual', 'percentile-25'],
  }),

  A_MEDIAN: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'A_MEDIAN',
    metric_id: 'annual-median-wage',
    label: 'Median Annual Wage ($ USD)',
    statistical_definition:
      '50th percentile (median) annual wage earnings at which 50 percent of workers earn less and 50 percent earn more.',
    universe: 'Annual wage distribution',
    unit: 'USD',
    wage_type: 'annual',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'annual', 'median'],
  }),

  A_PCT75: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'A_PCT75',
    metric_id: 'annual-75th-percentile-wage',
    label: '75th Percentile Annual Wage ($ USD)',
    statistical_definition:
      'Annual wage earnings below which 75 percent of workers in the occupation earn.',
    universe: 'Annual wage distribution',
    unit: 'USD',
    wage_type: 'annual',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'annual', 'percentile-75'],
  }),

  A_PCT90: BlsOewsVariableDefinitionSchema.parse({
    variable_id: 'A_PCT90',
    metric_id: 'annual-90th-percentile-wage',
    label: '90th Percentile Annual Wage ($ USD)',
    statistical_definition:
      'Annual wage earnings below which 90 percent of workers in the occupation earn.',
    universe: 'Annual wage distribution',
    unit: 'USD',
    wage_type: 'annual',
    supported_geographies: ['nation', 'state', 'cbsa', 'county'],
    tags: ['oews', 'wages', 'annual', 'percentile-90'],
  }),
};

export const BLS_OEWS_VARIABLE_DICTIONARY_V1: BlsOewsVariableDictionary =
  BlsOewsVariableDictionarySchema.parse({
    schema_version: BLS_OEWS_SCHEMA_VERSION,
    version: '1.0.0',
    program: 'oews',
    annual_disclaimer: BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER,
    vintages_supported: [BLS_OEWS_DEFAULT_VINTAGE, 'May 2024', 'May 2023', 'May 2022'],
    variables: BLS_OEWS_VARIABLES_V1,
  });

/**
 * Looks up a BLS OEWS variable definition by variable ID (e.g. A_MEDIAN) or metric ID (e.g. annual-median-wage).
 */
export function lookupOewsVariable(
  idOrMetric: string,
  dictionary: BlsOewsVariableDictionary = BLS_OEWS_VARIABLE_DICTIONARY_V1
): BlsOewsVariableDefinition | undefined {
  if (dictionary.variables[idOrMetric]) {
    return dictionary.variables[idOrMetric];
  }
  return Object.values(dictionary.variables).find(
    (v) => v.metric_id === idOrMetric || v.variable_id === idOrMetric
  );
}

/**
 * Gets a BLS OEWS variable definition or throws a descriptive error.
 */
export function getOewsVariableOrThrow(
  idOrMetric: string,
  dictionary: BlsOewsVariableDictionary = BLS_OEWS_VARIABLE_DICTIONARY_V1
): BlsOewsVariableDefinition {
  const found = lookupOewsVariable(idOrMetric, dictionary);
  if (!found) {
    throw new Error(
      `Unknown BLS OEWS variable or metric identifier '${idOrMetric}' in dictionary v${dictionary.version}`
    );
  }
  return found;
}

/**
 * Validates that an EconomicGeography meets BLS OEWS geographic rules.
 * Supported levels: cbsa, state, nation, county. Fails closed immediately on malformed FIPS/CBSA.
 */
export function validateOewsGeography(geography: EconomicGeography): void {
  switch (geography.level) {
    case 'cbsa': {
      if (!/^[0-9]{5}$/.test(geography.cbsa_code)) {
        throw new Error(
          `BLS OEWS invalid CBSA code: '${geography.cbsa_code}'. Must be exactly 5 digits.`
        );
      }
      break;
    }
    case 'state': {
      if (!/^[0-9]{2}$/.test(geography.state_fips)) {
        throw new Error(
          `BLS OEWS invalid state FIPS: '${geography.state_fips}'. Must be exactly 2 digits.`
        );
      }
      break;
    }
    case 'county': {
      if (!/^[0-9]{5}$/.test(geography.county_fips)) {
        throw new Error(
          `BLS OEWS invalid county FIPS: '${geography.county_fips}'. Must be exactly 5 digits.`
        );
      }
      if (geography.state_fips && geography.county_fips.slice(0, 2) !== geography.state_fips) {
        throw new Error(
          `BLS OEWS county FIPS '${geography.county_fips}' does not match state FIPS '${geography.state_fips}'`
        );
      }
      break;
    }
    case 'nation': {
      if (geography.country_code !== 'US') {
        throw new Error(
          `BLS OEWS nation geography must have country_code 'US'. Received '${geography.country_code}'.`
        );
      }
      break;
    }
    default: {
      throw new Error(
        `Unsupported geography level '${(geography as { level: string }).level}' for BLS OEWS queries. Expected cbsa, state, county, or nation.`
      );
    }
  }
}

/**
 * Validates a standard 6-digit SOC code (format XX-XXXX). Fails closed on invalid formats.
 */
export function validateOewsSocCode(socCode: string): void {
  BlsSocCodeSchema.parse(socCode);
}

export interface ParseOewsRawEstimateOptions {
  unit?: BlsOewsUnit;
  notes?: string;
}

/**
 * Pure parser transforming raw BLS OEWS cells and publication symbols into an EconomicEstimate.
 * Enforces PLAN.md §2 Principle 1 and ADR 0052:
 * - ZERO NUMERIC ZERO-COERCION: missing, top-coded, or suppressed values are NEVER coerced to 0.
 * - Handles BLS OEWS publication symbols:
 *   - '*' or '(1)': Top-coded wage (e.g. >= $115.00/hr or $239,200/yr) -> suppressed with explicit lower bound.
 *   - '**' or '(2)': Reliability standard not met (RSE > 50%) -> suppressed with data_quality reason.
 *   - '***' or '(3)': Wage not available -> unavailable.
 *   - '(8)': Confidentiality suppression -> suppressed with disclosure_avoidance reason.
 *   - '-' or missing: unavailable.
 */
export function parseOewsRawEstimate(
  rawVal: string | number | null | undefined,
  options: ParseOewsRawEstimateOptions = {}
): EconomicEstimate {
  const unit = options.unit ?? 'USD';

  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return {
      status: 'unavailable',
      reason: 'BLS OEWS estimate value is missing from the response.',
    };
  }

  const valStr = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal);

  // Top-coded wage rates
  if (valStr === '*' || valStr === '(1)' || valStr === '#') {
    const isHourly = unit === 'USD_per_hour';
    const lowerBound = isHourly ? 115 : 239200;
    return {
      status: 'suppressed',
      reason: 'disclosure_avoidance',
      detail: `BLS OEWS top-coded wage estimate: wage rate equals or exceeds $${lowerBound.toLocaleString()} ${isHourly ? 'per hour' : 'per year'}.`,
      bounds: {
        lower_bound: lowerBound,
      },
      unit,
    };
  }

  // Data quality / reliability suppression (RSE > 50%)
  if (valStr === '**' || valStr === '(2)') {
    return {
      status: 'suppressed',
      reason: 'data_quality',
      detail:
        'BLS OEWS data quality suppression: relative standard error (RSE) exceeds reliability threshold of 50%.',
      unit,
    };
  }

  // Estimate unavailable / not computed
  if (valStr === '***' || valStr === '(3)' || valStr === '-' || valStr.toUpperCase() === 'N') {
    return {
      status: 'unavailable',
      reason: 'BLS OEWS estimate not available or not released for this occupation and area.',
    };
  }

  // Statutory confidentiality suppression
  if (valStr === '(8)' || valStr.toUpperCase() === 'D') {
    return {
      status: 'suppressed',
      reason: 'disclosure_avoidance',
      detail:
        'BLS OEWS confidentiality suppression: estimate withheld to avoid disclosing operations of individual employers.',
      unit,
    };
  }

  const numericVal = Number(valStr);
  if (!Number.isFinite(numericVal)) {
    return {
      status: 'unavailable',
      reason: `BLS OEWS estimate could not be parsed as a finite number: '${valStr}'.`,
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
