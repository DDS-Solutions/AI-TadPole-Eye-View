import {
  CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER,
  CENSUS_CBP_DEFAULT_VINTAGE,
  CENSUS_CBP_EMPLOYMENT_NOISE_BOUNDS,
  CENSUS_CBP_SCHEMA_VERSION,
  type CensusCbpEmploymentNoiseBounds,
  type CensusCbpEmploymentNoiseFlag,
  CensusCbpEmploymentNoiseFlagSchema,
  type CensusCbpVariableDefinition,
  CensusCbpVariableDefinitionSchema,
  type CensusCbpVariableDictionary,
  CensusCbpVariableDictionarySchema,
  type EconomicEstimate,
  type EconomicGeography,
} from '@gev/contracts';

export {
  CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER,
  CENSUS_CBP_DEFAULT_VINTAGE,
  CENSUS_CBP_EMPLOYMENT_NOISE_BOUNDS,
  CENSUS_CBP_SCHEMA_VERSION,
};

/**
 * Versioned Census CBP & ZBP Variable Dictionary (V1.0.0).
 * Implements PLAN.md §10 Task 9.2 and ADR 0052.
 * Pure domain metadata with zero I/O.
 */
export const CENSUS_CBP_VARIABLES_V1: Record<string, CensusCbpVariableDefinition> = {
  ESTAB: CensusCbpVariableDefinitionSchema.parse({
    variable_id: 'ESTAB',
    metric_id: 'establishment-count',
    label: 'Total Establishments',
    statistical_definition:
      'Total number of physical business locations where business is conducted or where services or industrial operations are performed, with active payroll during the reference year.',
    universe: 'Establishments with paid employees',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'zcta', 'cbsa'],
    tags: ['cbp', 'zbp', 'establishments', 'enterprises'],
  }),

  EMP: CensusCbpVariableDefinitionSchema.parse({
    variable_id: 'EMP',
    metric_id: 'paid-employment',
    label: 'Paid Employment for Pay Period Including March 12',
    statistical_definition:
      'Number of paid employees for the pay period that includes March 12 of the reference year, including full-time and part-time employees. Subject to statutory disclosure avoidance suppression under 13 U.S.C. Section 9.',
    universe: 'Paid employees for pay period including March 12',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'zcta', 'cbsa'],
    tags: ['cbp', 'zbp', 'employment', 'jobs'],
  }),

  PAYANN: CensusCbpVariableDefinitionSchema.parse({
    variable_id: 'PAYANN',
    metric_id: 'annual-payroll',
    label: 'Annual Payroll ($1,000 USD)',
    statistical_definition:
      'Total annual payroll in thousands of dollars for all employees on the payroll of operating establishments. Subject to statutory disclosure avoidance suppression under 13 U.S.C. Section 9.',
    universe: 'Total annual payroll',
    unit: 'USD_thousands',
    supported_geographies: ['nation', 'state', 'county', 'zcta', 'cbsa'],
    tags: ['cbp', 'zbp', 'payroll', 'wages'],
  }),

  PAYQTR1: CensusCbpVariableDefinitionSchema.parse({
    variable_id: 'PAYQTR1',
    metric_id: 'first-quarter-payroll',
    label: 'First-Quarter Payroll ($1,000 USD)',
    statistical_definition:
      'Total first-quarter (January through March) payroll in thousands of dollars. Subject to statutory disclosure avoidance suppression under 13 U.S.C. Section 9.',
    universe: 'First quarter payroll (January-March)',
    unit: 'USD_thousands',
    supported_geographies: ['nation', 'state', 'county', 'zcta', 'cbsa'],
    tags: ['cbp', 'zbp', 'payroll', 'first-quarter'],
  }),
};

export const CENSUS_CBP_VARIABLE_DICTIONARY_V1: CensusCbpVariableDictionary =
  CensusCbpVariableDictionarySchema.parse({
    schema_version: CENSUS_CBP_SCHEMA_VERSION,
    version: '1.0.0',
    program: 'cbp_zbp',
    annual_disclaimer: CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER,
    vintages_supported: [CENSUS_CBP_DEFAULT_VINTAGE, '2023', '2022', '2021', '2020'],
    variables: CENSUS_CBP_VARIABLES_V1,
  });

/**
 * Looks up a Census CBP/ZBP variable definition by variable ID (e.g. ESTAB) or metric ID (e.g. establishment-count).
 */
export function lookupCbpVariable(
  idOrMetric: string,
  dictionary: CensusCbpVariableDictionary = CENSUS_CBP_VARIABLE_DICTIONARY_V1
): CensusCbpVariableDefinition | undefined {
  if (dictionary.variables[idOrMetric]) {
    return dictionary.variables[idOrMetric];
  }
  return Object.values(dictionary.variables).find(
    (v) => v.metric_id === idOrMetric || v.variable_id === idOrMetric
  );
}

/**
 * Gets a CBP/ZBP variable definition or throws a descriptive error.
 */
export function getCbpVariableOrThrow(
  idOrMetric: string,
  dictionary: CensusCbpVariableDictionary = CENSUS_CBP_VARIABLE_DICTIONARY_V1
): CensusCbpVariableDefinition {
  const found = lookupCbpVariable(idOrMetric, dictionary);
  if (!found) {
    throw new Error(
      `Unknown Census CBP/ZBP variable or metric identifier '${idOrMetric}' in dictionary v${dictionary.version}`
    );
  }
  return found;
}

/**
 * Validates that an EconomicGeography meets Census CBP/ZBP geographic rules.
 * Fails closed immediately on missing or malformed FIPS/ZCTA/CBSA codes or unsupported levels.
 */
export function validateCbpGeography(geography: EconomicGeography): void {
  switch (geography.level) {
    case 'county': {
      if (!/^[0-9]{5}$/.test(geography.county_fips)) {
        throw new Error(
          `Census CBP invalid county FIPS: '${geography.county_fips}'. Must be exactly 5 digits.`
        );
      }
      if (geography.state_fips && geography.county_fips.slice(0, 2) !== geography.state_fips) {
        throw new Error(
          `Census CBP county FIPS '${geography.county_fips}' does not match state FIPS '${geography.state_fips}'`
        );
      }
      break;
    }
    case 'zcta': {
      if (!/^[0-9]{5}$/.test(geography.zcta)) {
        throw new Error(`Census ZBP invalid ZCTA: '${geography.zcta}'. Must be exactly 5 digits.`);
      }
      break;
    }
    case 'cbsa': {
      if (!/^[0-9]{5}$/.test(geography.cbsa_code)) {
        throw new Error(
          `Census CBP invalid CBSA code: '${geography.cbsa_code}'. Must be exactly 5 digits.`
        );
      }
      break;
    }
    case 'state': {
      if (!/^[0-9]{2}$/.test(geography.state_fips)) {
        throw new Error(
          `Census CBP invalid state FIPS: '${geography.state_fips}'. Must be exactly 2 digits.`
        );
      }
      break;
    }
    case 'nation': {
      if (geography.country_code !== 'US') {
        throw new Error(
          `Census CBP nation geography must have country_code 'US'. Received '${geography.country_code}'.`
        );
      }
      break;
    }
    default: {
      throw new Error(
        `Unsupported geography level '${(geography as { level: string }).level}' for Census CBP/ZBP queries. Expected county, zcta, cbsa, state, or nation.`
      );
    }
  }
}

/**
 * Validates a 2- to 6-digit NAICS code. Fails closed on invalid formats.
 */
export function validateCbpNaicsCode(naicsCode: string): void {
  if (!/^[0-9]{2,6}$/.test(naicsCode)) {
    throw new Error(`Invalid NAICS code '${naicsCode}'. Must be between 2 and 6 numeric digits.`);
  }
}

/**
 * Retrieves the statutory employment noise bounds for a Census CBP employment size flag.
 */
export function getEmploymentNoiseBounds(
  flag: CensusCbpEmploymentNoiseFlag
): CensusCbpEmploymentNoiseBounds {
  const parsedFlag = CensusCbpEmploymentNoiseFlagSchema.parse(flag);
  return CENSUS_CBP_EMPLOYMENT_NOISE_BOUNDS[parsedFlag];
}

export interface ParseCbpRawEstimateOptions {
  unit?: string;
  notes?: string;
}

/**
 * Pure parser that transforms raw Census CBP/ZBP string/number cells and noise flags into an EconomicEstimate.
 * Strictly enforces PLAN.md §2 Principle 1 (Boundaries are law) and ADR 0052:
 * - ZERO NUMERIC ZERO-COERCION: missing or suppressed values are NEVER coerced to 0.
 * - Preserves statutory disclosure avoidance suppression under 13 U.S.C. Section 9.
 * - Accurately maps employment noise flags ('a' through 'm') to explicit bounds.
 */
export function parseCbpRawEstimate(
  rawVal: string | number | null | undefined,
  noiseFlag?: string | null | undefined,
  options: ParseCbpRawEstimateOptions = {}
): EconomicEstimate {
  const unit = options.unit ?? 'count';

  // Check if noise flag is present and valid
  let validNoiseBounds: CensusCbpEmploymentNoiseBounds | null = null;
  if (noiseFlag !== null && noiseFlag !== undefined && noiseFlag !== '') {
    const cleanFlag = typeof noiseFlag === 'string' ? noiseFlag.trim().toLowerCase() : '';
    const parseResult = CensusCbpEmploymentNoiseFlagSchema.safeParse(cleanFlag);
    if (parseResult.success) {
      validNoiseBounds = CENSUS_CBP_EMPLOYMENT_NOISE_BOUNDS[parseResult.data];
    }
  }

  // Handle null, undefined, or empty string
  if (rawVal === null || rawVal === undefined || rawVal === '') {
    if (validNoiseBounds) {
      return {
        status: 'suppressed',
        reason: 'disclosure_avoidance',
        detail: `Statutory disclosure avoidance suppression under 13 U.S.C. Section 9; employment noise flag ${validNoiseBounds.flag} (${validNoiseBounds.description})`,
        bounds: {
          lower_bound: validNoiseBounds.lower_bound,
          ...(validNoiseBounds.upper_bound !== undefined
            ? { upper_bound: validNoiseBounds.upper_bound }
            : {}),
        },
        unit,
      };
    }

    return {
      status: 'unavailable',
      reason: 'CBP/ZBP estimate value is missing from the response table.',
    };
  }

  const valStr = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal);

  // Census publication suppression codes
  if (valStr === 'D' || valStr === 'd') {
    if (validNoiseBounds) {
      return {
        status: 'suppressed',
        reason: 'disclosure_avoidance',
        detail: `Statutory disclosure avoidance suppression under 13 U.S.C. Section 9; employment noise flag ${validNoiseBounds.flag} (${validNoiseBounds.description})`,
        bounds: {
          lower_bound: validNoiseBounds.lower_bound,
          ...(validNoiseBounds.upper_bound !== undefined
            ? { upper_bound: validNoiseBounds.upper_bound }
            : {}),
        },
        unit,
      };
    }
    return {
      status: 'suppressed',
      reason: 'disclosure_avoidance',
      detail:
        'Statutory disclosure avoidance suppression under 13 U.S.C. Section 9; value withheld to avoid disclosing operations of individual companies.',
      unit,
    };
  }

  if (valStr === 'S' || valStr === 's') {
    return {
      status: 'suppressed',
      reason: 'data_quality',
      detail:
        'Census Bureau quality standard suppression: estimate withheld because it did not meet publication standards.',
      unit,
    };
  }

  if (valStr === 'N' || valStr === 'n') {
    return {
      status: 'unavailable',
      reason:
        'Census Bureau indicator: metric is not available or not published for this geographic level or NAICS code.',
    };
  }

  const numericVal = Number(valStr);
  if (!Number.isFinite(numericVal)) {
    return {
      status: 'unavailable',
      reason: `CBP/ZBP estimate could not be parsed as a finite number: '${valStr}'.`,
    };
  }

  // If numericVal is 0 but validNoiseBounds is present, Census output 0 as placeholder for suppressed employment!
  if (numericVal === 0 && validNoiseBounds) {
    return {
      status: 'suppressed',
      reason: 'disclosure_avoidance',
      detail: `Statutory disclosure avoidance suppression under 13 U.S.C. Section 9; employment noise flag ${validNoiseBounds.flag} (${validNoiseBounds.description})`,
      bounds: {
        lower_bound: validNoiseBounds.lower_bound,
        ...(validNoiseBounds.upper_bound !== undefined
          ? { upper_bound: validNoiseBounds.upper_bound }
          : {}),
      },
      unit,
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
