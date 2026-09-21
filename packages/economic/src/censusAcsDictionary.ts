import {
  CENSUS_ACS_DEFAULT_RELEASE,
  CENSUS_ACS_DEFAULT_VINTAGE,
  CENSUS_ACS_FOREIGN_BORN_STATUTORY_DEFINITION,
  CENSUS_ACS_SCHEMA_VERSION,
  type CensusAcsVariableDefinition,
  CensusAcsVariableDefinitionSchema,
  type CensusAcsVariableDictionary,
  CensusAcsVariableDictionarySchema,
  type EconomicEstimate,
  type EconomicGeography,
  type EconomicGeographyLevel,
} from '@gev/contracts';

/**
 * Versioned Census ACS 5-Year Variable Dictionary (V1.0.0).
 * Implements PLAN.md §10 Task 9.1 and ADR 0052.
 * Strictly pure domain metadata with zero I/O.
 */
export const CENSUS_ACS_VARIABLES_V1: Record<string, CensusAcsVariableDefinition> = {
  B01003_001E: CensusAcsVariableDefinitionSchema.parse({
    variable_id: 'B01003_001E',
    moe_variable_id: 'B01003_001M',
    table_id: 'B01003',
    metric_id: 'total-population',
    label: 'Total Population',
    concept: 'TOTAL POPULATION',
    statistical_definition:
      'Total resident population count from American Community Survey 5-year sample pooled estimates.',
    universe: 'Total population',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'tract', 'zcta', 'place'],
    tags: ['population', 'demographics', 'acs'],
  }),

  B19013_001E: CensusAcsVariableDefinitionSchema.parse({
    variable_id: 'B19013_001E',
    moe_variable_id: 'B19013_001M',
    table_id: 'B19013',
    metric_id: 'median-household-income',
    label: 'Median Household Income in the Past 12 Months (in 2024 Inflation-Adjusted Dollars)',
    concept: 'MEDIAN HOUSEHOLD INCOME IN THE PAST 12 MONTHS (IN 2024 INFLATION-ADJUSTED DOLLARS)',
    statistical_definition:
      'Median household income computed from 5-year sample surveys in 2024 inflation-adjusted dollars. Excludes group quarters.',
    universe: 'Households',
    unit: 'USD',
    supported_geographies: ['nation', 'state', 'county', 'tract', 'zcta', 'place'],
    tags: ['income', 'household', 'economic', 'acs'],
  }),

  B05002_003E: CensusAcsVariableDefinitionSchema.parse({
    variable_id: 'B05002_003E',
    moe_variable_id: 'B05002_003M',
    table_id: 'B05002',
    metric_id: 'foreign-born-population',
    label: 'Foreign-Born Population (Naturalized Citizen and Non-Citizen)',
    concept: 'PLACE OF BIRTH BY CITIZENSHIP STATUS',
    statistical_definition: CENSUS_ACS_FOREIGN_BORN_STATUTORY_DEFINITION,
    universe: 'Total population',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'tract', 'zcta', 'place'],
    tags: ['foreign-born', 'citizenship', 'demographics', 'acs'],
  }),

  B25077_001E: CensusAcsVariableDefinitionSchema.parse({
    variable_id: 'B25077_001E',
    moe_variable_id: 'B25077_001M',
    table_id: 'B25077',
    metric_id: 'median-housing-value',
    label: 'Median Value of Owner-Occupied Housing Units (Dollars)',
    concept: 'MEDIAN VALUE (DOLLARS)',
    statistical_definition:
      'Median respondent estimate of how much the property (house and lot, mobile home and lot, or condominium unit) would sell for if it were for sale.',
    universe: 'Owner-occupied housing units',
    unit: 'USD',
    supported_geographies: ['nation', 'state', 'county', 'tract', 'zcta', 'place'],
    tags: ['housing', 'real-estate', 'property-value', 'acs'],
  }),

  B25064_001E: CensusAcsVariableDefinitionSchema.parse({
    variable_id: 'B25064_001E',
    moe_variable_id: 'B25064_001M',
    table_id: 'B25064',
    metric_id: 'median-gross-rent',
    label: 'Median Gross Rent (Dollars)',
    concept: 'MEDIAN GROSS RENT (DOLLARS)',
    statistical_definition:
      'Contract rent plus the estimated average monthly cost of utilities and fuels if these are paid by the renter.',
    universe: 'Renter-occupied housing units paying cash rent',
    unit: 'USD',
    supported_geographies: ['nation', 'state', 'county', 'tract', 'zcta', 'place'],
    tags: ['housing', 'rent', 'cost-of-living', 'acs'],
  }),

  B19001_017E: CensusAcsVariableDefinitionSchema.parse({
    variable_id: 'B19001_017E',
    moe_variable_id: 'B19001_017M',
    table_id: 'B19001',
    metric_id: 'specialized-bracket-income',
    label: 'Household Income in Past 12 Months: $200,000 or More',
    concept: 'HOUSEHOLD INCOME IN THE PAST 12 MONTHS (IN 2024 INFLATION-ADJUSTED DOLLARS)',
    statistical_definition:
      'Number of households whose total annual income is $200,000 or more in inflation-adjusted dollars.',
    universe: 'Households',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'tract', 'zcta', 'place'],
    tags: ['income', 'wealth', 'high-income', 'acs'],
  }),

  B15003_022E: CensusAcsVariableDefinitionSchema.parse({
    variable_id: 'B15003_022E',
    moe_variable_id: 'B15003_022M',
    table_id: 'B15003',
    metric_id: 'bachelors-degree-population',
    label: "Educational Attainment: Bachelor's Degree",
    concept: 'EDUCATIONAL ATTAINMENT FOR THE POPULATION 25 YEARS AND OVER',
    statistical_definition:
      "Highest level of education completed: Bachelor's degree among civilian non-institutional population 25 years and over.",
    universe: 'Population 25 years and over',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'tract', 'zcta', 'place'],
    tags: ['education', 'workforce', 'skills', 'acs'],
  }),

  B08301_001E: CensusAcsVariableDefinitionSchema.parse({
    variable_id: 'B08301_001E',
    moe_variable_id: 'B08301_001M',
    table_id: 'B08301',
    metric_id: 'commute-workers-total',
    label: 'Means of Transportation to Work: Total Workers 16 Years and Over',
    concept: 'MEANS OF TRANSPORTATION TO WORK',
    statistical_definition:
      'Total number of workers 16 years and over who were employed and at work during the reference week.',
    universe: 'Workers 16 years and over',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'tract', 'zcta', 'place'],
    tags: ['transportation', 'commute', 'workforce', 'acs'],
  }),

  B23025_005E: CensusAcsVariableDefinitionSchema.parse({
    variable_id: 'B23025_005E',
    moe_variable_id: 'B23025_005M',
    table_id: 'B23025',
    metric_id: 'civilian-unemployed-population',
    label: 'Employment Status: Civilian Labor Force - Unemployed',
    concept: 'EMPLOYMENT STATUS FOR THE POPULATION 16 YEARS AND OVER',
    statistical_definition:
      'Civilians 16 years old and over who were neither at work nor with a job but were actively looking for work during the last 4 weeks.',
    universe: 'Population 16 years and over',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'tract', 'zcta', 'place'],
    tags: ['labor', 'unemployment', 'workforce', 'acs'],
  }),

  B17001_002E: CensusAcsVariableDefinitionSchema.parse({
    variable_id: 'B17001_002E',
    moe_variable_id: 'B17001_002M',
    table_id: 'B17001',
    metric_id: 'poverty-population',
    label: 'Poverty Status in Past 12 Months: Income Below Poverty Level',
    concept: 'POVERTY STATUS IN THE PAST 12 MONTHS BY SEX BY AGE',
    statistical_definition:
      'Number of people whose family income or unrelated individual income was below the poverty threshold in the past 12 months.',
    universe: 'Population for whom poverty status is determined',
    unit: 'count',
    supported_geographies: ['nation', 'state', 'county', 'tract', 'zcta', 'place'],
    tags: ['poverty', 'economic', 'social', 'acs'],
  }),
};

export const CENSUS_ACS_VARIABLE_DICTIONARY_V1: CensusAcsVariableDictionary =
  CensusAcsVariableDictionarySchema.parse({
    schema_version: CENSUS_ACS_SCHEMA_VERSION,
    version: '1.0.0',
    acs_release: CENSUS_ACS_DEFAULT_RELEASE,
    vintages_supported: [
      CENSUS_ACS_DEFAULT_VINTAGE,
      '2019-2023',
      '2018-2022',
      '2024',
      '2023',
      '2022',
    ],
    variables: CENSUS_ACS_VARIABLES_V1,
  });

/**
 * Looks up a Census ACS variable definition by variable ID (e.g. B01003_001E) or metric ID (e.g. total-population).
 */
export function lookupAcsVariable(
  idOrMetric: string,
  dictionary: CensusAcsVariableDictionary = CENSUS_ACS_VARIABLE_DICTIONARY_V1
): CensusAcsVariableDefinition | undefined {
  if (dictionary.variables[idOrMetric]) {
    return dictionary.variables[idOrMetric];
  }
  return Object.values(dictionary.variables).find(
    (v) => v.metric_id === idOrMetric || v.variable_id === idOrMetric
  );
}

/**
 * Gets a variable definition or throws a descriptive error.
 */
export function getAcsVariableOrThrow(
  idOrMetric: string,
  dictionary: CensusAcsVariableDictionary = CENSUS_ACS_VARIABLE_DICTIONARY_V1
): CensusAcsVariableDefinition {
  const found = lookupAcsVariable(idOrMetric, dictionary);
  if (!found) {
    throw new Error(
      `Unknown Census ACS variable or metric identifier '${idOrMetric}' in dictionary v${dictionary.version}`
    );
  }
  return found;
}

/**
 * Checks if a specific geography level is supported by the variable.
 */
export function isAcsGeographySupported(
  variable: CensusAcsVariableDefinition,
  level: EconomicGeographyLevel
): boolean {
  return variable.supported_geographies.includes(level);
}

/**
 * Validates that an EconomicGeography meets Census ACS geographic rules.
 * Fails closed immediately on missing or malformed FIPS codes.
 */
export function validateAcsGeography(geography: EconomicGeography): void {
  switch (geography.level) {
    case 'county': {
      if (!/^[0-9]{5}$/.test(geography.county_fips)) {
        throw new Error(
          `Census ACS invalid county FIPS: '${geography.county_fips}'. Must be exactly 5 digits.`
        );
      }
      if (geography.state_fips && geography.county_fips.slice(0, 2) !== geography.state_fips) {
        throw new Error(
          `Census ACS county FIPS '${geography.county_fips}' does not match state FIPS '${geography.state_fips}'`
        );
      }
      break;
    }
    case 'tract': {
      if (!/^[0-9]{11}$/.test(geography.tract_fips)) {
        throw new Error(
          `Census ACS invalid tract FIPS: '${geography.tract_fips}'. Must be exactly 11 digits.`
        );
      }
      break;
    }
    case 'zcta': {
      if (!/^[0-9]{5}$/.test(geography.zcta)) {
        throw new Error(`Census ACS invalid ZCTA: '${geography.zcta}'. Must be exactly 5 digits.`);
      }
      break;
    }
    case 'place': {
      if (!/^[0-9]{7}$/.test(geography.place_fips)) {
        throw new Error(
          `Census ACS invalid place FIPS: '${geography.place_fips}'. Must be exactly 7 digits.`
        );
      }
      break;
    }
    case 'state': {
      if (!/^[0-9]{2}$/.test(geography.state_fips)) {
        throw new Error(
          `Census ACS invalid state FIPS: '${geography.state_fips}'. Must be exactly 2 digits.`
        );
      }
      break;
    }
    case 'nation': {
      if (geography.country_code !== 'US') {
        throw new Error(
          `Census ACS nation geography must have country_code 'US'. Received '${geography.country_code}'.`
        );
      }
      break;
    }
    default: {
      throw new Error(
        `Unsupported geography level '${geography.level}' for Census ACS queries. Expected county, tract, zcta, place, state, or nation.`
      );
    }
  }
}

export interface ParseAcsRawEstimateOptions {
  unit?: string;
  notes?: string;
  confidenceLevel?: number;
}

/**
 * Pure parser that transforms raw Census string/number cells into an EconomicEstimate.
 * Adheres strictly to PLAN.md §2 Principle 1 (Boundaries are law) and ADR 0052:
 * - NEVER coerces missing, negative suppression codes, or null values to zero.
 * - Accurately maps Census Bureau suppression flags:
 *   - -666666666 -> suppressed (reason: small_sample)
 *   - -888888888 -> unavailable (reason: not applicable)
 *   - -999999999 -> suppressed (reason: data_quality)
 *   - -555555555 -> controlled MOE (sets MOE to null)
 */
export function parseAcsRawEstimate(
  rawVal: string | number | null | undefined,
  rawMoe?: string | number | null | undefined,
  options: ParseAcsRawEstimateOptions = {}
): EconomicEstimate {
  const unit = options.unit ?? 'count';
  const confidenceLevel = options.confidenceLevel ?? 0.9;

  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return {
      status: 'unavailable',
      reason: 'Census estimate value is missing from the response table.',
    };
  }

  const valStr = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal);

  // Census Bureau special suppression codes
  if (valStr === '-666666666' || valStr === '-666666666.0') {
    return {
      status: 'suppressed',
      reason: 'small_sample',
      detail:
        'Census Bureau statistical suppression: estimate could not be computed because sample size was too small or median fell in an open-ended interval.',
      unit,
    };
  }

  if (valStr === '-888888888' || valStr === '-888888888.0') {
    return {
      status: 'unavailable',
      reason:
        'Census Bureau indicator: metric is not applicable or not available for this geographic level or time period.',
    };
  }

  if (valStr === '-999999999' || valStr === '-999999999.0') {
    return {
      status: 'suppressed',
      reason: 'data_quality',
      detail:
        'Census Bureau disclosure avoidance: value suppressed to protect confidentiality or due to extreme measurement variance.',
      unit,
    };
  }

  const numericVal = Number(valStr);
  if (!Number.isFinite(numericVal)) {
    return {
      status: 'unavailable',
      reason: `Census estimate could not be parsed as a finite number: '${valStr}'.`,
    };
  }

  // Parse Margin of Error (MOE)
  let parsedMoe: number | null = null;
  if (rawMoe !== null && rawMoe !== undefined && rawMoe !== '') {
    const moeStr = typeof rawMoe === 'string' ? rawMoe.trim() : String(rawMoe);
    // Negative Census flags for MOE (e.g. -555555555 indicates controlled estimate where MOE is not applicable)
    if (moeStr.startsWith('-')) {
      parsedMoe = null;
    } else {
      const moeNum = Number(moeStr);
      if (Number.isFinite(moeNum) && moeNum >= 0) {
        parsedMoe = moeNum;
      }
    }
  }

  return {
    status: 'available',
    value: numericVal,
    margin_of_error: parsedMoe,
    confidence_level: confidenceLevel,
    sample_size: null,
    unit,
    notes: options.notes,
  };
}
