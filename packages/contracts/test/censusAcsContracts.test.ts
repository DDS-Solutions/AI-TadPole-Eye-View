import { describe, expect, it } from 'vitest';
import {
  CENSUS_ACS_DEFAULT_RELEASE,
  CENSUS_ACS_DEFAULT_VINTAGE,
  CENSUS_ACS_FOREIGN_BORN_STATUTORY_DEFINITION,
  CENSUS_ACS_SCHEMA_VERSION,
  CensusAcsQuerySchema,
  CensusAcsSpecialAnnotationCodeSchema,
  CensusAcsTableIdSchema,
  CensusAcsVariableDefinitionSchema,
  CensusAcsVariableDictionarySchema,
  CensusAcsVariableIdSchema,
  CensusAcsVintageSchema,
} from '../src/index.js';

describe('Census ACS Contracts (PLAN.md §10 Task 9.1 & ADR 0052)', () => {
  it('validates variable ID, table ID, and vintage formats', () => {
    expect(CensusAcsVariableIdSchema.parse('B01003_001E')).toBe('B01003_001E');
    expect(CensusAcsVariableIdSchema.parse('B19013_001M')).toBe('B19013_001M');
    expect(CensusAcsVariableIdSchema.parse('B05002_003E')).toBe('B05002_003E');
    expect(() => CensusAcsVariableIdSchema.parse('b01003-001e')).toThrow();
    expect(() => CensusAcsVariableIdSchema.parse('')).toThrow();

    expect(CensusAcsTableIdSchema.parse('B01003')).toBe('B01003');
    expect(CensusAcsTableIdSchema.parse('B05002')).toBe('B05002');
    expect(CensusAcsTableIdSchema.parse('C17002')).toBe('C17002');
    expect(() => CensusAcsTableIdSchema.parse('b01003')).toThrow();

    expect(CensusAcsVintageSchema.parse('2024')).toBe('2024');
    expect(CensusAcsVintageSchema.parse('2020-2024')).toBe('2020-2024');
    expect(CensusAcsVintageSchema.parse('2020-2024 ACS 5-Year')).toBe('2020-2024 ACS 5-Year');
    expect(() => CensusAcsVintageSchema.parse('1999')).toThrow();
    expect(() => CensusAcsVintageSchema.parse('invalid')).toThrow();
  });

  it('validates a correct Census ACS variable definition', () => {
    const def = CensusAcsVariableDefinitionSchema.parse({
      variable_id: 'B19013_001E',
      moe_variable_id: 'B19013_001M',
      table_id: 'B19013',
      metric_id: 'median-household-income',
      label: 'Median Household Income in Past 12 Months',
      concept: 'MEDIAN HOUSEHOLD INCOME IN THE PAST 12 MONTHS (IN 2024 INFLATION-ADJUSTED DOLLARS)',
      statistical_definition:
        'Median household income computed from 5-year sample surveys in 2024 inflation-adjusted dollars.',
      universe: 'Households',
      unit: 'USD',
      supported_geographies: ['county', 'tract', 'zcta', 'place'],
      tags: ['income', 'household', 'acs'],
    });

    expect(def.variable_id).toBe('B19013_001E');
    expect(def.unit).toBe('USD');
    expect(def.supported_geographies).toContain('county');
    expect(def.supported_geographies).toContain('place');
  });

  it('enforces statutory foreign-born definition (Table B05002) in variable schema', () => {
    // Valid foreign-born definition with statutory requirement: naturalized + non-citizen
    const validForeignBorn = CensusAcsVariableDefinitionSchema.parse({
      variable_id: 'B05002_003E',
      moe_variable_id: 'B05002_003M',
      table_id: 'B05002',
      metric_id: 'foreign-born-population',
      label: 'Foreign-Born Population (Naturalized Citizen and Non-Citizen)',
      concept: 'PLACE OF BIRTH BY CITIZENSHIP STATUS',
      statistical_definition: CENSUS_ACS_FOREIGN_BORN_STATUTORY_DEFINITION,
      universe: 'Total population',
      unit: 'count',
      supported_geographies: ['county', 'tract', 'zcta', 'place'],
      tags: ['demographics', 'foreign-born', 'citizenship'],
    });
    expect(validForeignBorn.metric_id).toBe('foreign-born-population');

    // Invalid: omitting non-citizen or naturalized citizen per statutory law
    expect(() =>
      CensusAcsVariableDefinitionSchema.parse({
        variable_id: 'B05002_003E',
        table_id: 'B05002',
        metric_id: 'foreign-born-population',
        label: 'Foreign-Born Population',
        concept: 'PLACE OF BIRTH BY CITIZENSHIP STATUS',
        statistical_definition: 'Non-citizens residing in the area only.', // VIOLATION
        universe: 'Total population',
        unit: 'count',
        supported_geographies: ['county'],
        tags: ['demographics'],
      })
    ).toThrow(
      /Foreign-born definition under B05002 must explicitly include both naturalized citizens and non-citizens/
    );
  });

  it('validates a versioned variable dictionary schema', () => {
    const dictionary = CensusAcsVariableDictionarySchema.parse({
      schema_version: CENSUS_ACS_SCHEMA_VERSION,
      version: '1.0.0',
      acs_release: CENSUS_ACS_DEFAULT_RELEASE,
      vintages_supported: ['2020-2024', '2019-2023'],
      variables: {
        B01003_001E: {
          variable_id: 'B01003_001E',
          moe_variable_id: 'B01003_001M',
          table_id: 'B01003',
          metric_id: 'total-population',
          label: 'Total Population',
          concept: 'TOTAL POPULATION',
          statistical_definition: 'Total resident population count from ACS 5-year sample.',
          universe: 'Total population',
          unit: 'count',
          supported_geographies: ['county', 'tract', 'zcta', 'place'],
          tags: ['demographics', 'population'],
        },
      },
    });

    expect(dictionary.schema_version).toBe(1);
    expect(dictionary.version).toBe('1.0.0');
    expect(dictionary.variables.B01003_001E.metric_id).toBe('total-population');
  });

  it('validates Census ACS queries across county, tract, zcta, and place', () => {
    // County query
    const countyQuery = CensusAcsQuerySchema.parse({
      geography: {
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      },
      variables: ['B19013_001E', 'B01003_001E'],
      vintage: CENSUS_ACS_DEFAULT_VINTAGE,
    });
    expect(countyQuery.geography.level).toBe('county');

    // Tract query
    const tractQuery = CensusAcsQuerySchema.parse({
      geography: {
        level: 'tract',
        tract_fips: '48453001100',
        name: 'Census Tract 11, Travis County, TX',
      },
      variables: ['B19013_001E'],
    });
    expect(tractQuery.geography.level).toBe('tract');

    // ZCTA query
    const zctaQuery = CensusAcsQuerySchema.parse({
      geography: {
        level: 'zcta',
        zcta: '78701',
        name: 'ZCTA 78701',
      },
      variables: ['B25077_001E'],
    });
    expect(zctaQuery.geography.level).toBe('zcta');

    // Place query
    const placeQuery = CensusAcsQuerySchema.parse({
      geography: {
        level: 'place',
        place_fips: '4805000',
        name: 'Austin city, TX',
      },
      variables: ['foreign-born-population'],
    });
    expect(placeQuery.geography.level).toBe('place');
  });

  it('fails closed on malformed FIPS codes and unsupported geographies', () => {
    // Malformed county FIPS (not 5 digits)
    expect(() =>
      CensusAcsQuerySchema.parse({
        geography: {
          level: 'county',
          county_fips: '4845', // 4 digits!
        },
        variables: ['B19013_001E'],
      })
    ).toThrow();

    // Malformed tract FIPS (not 11 digits)
    expect(() =>
      CensusAcsQuerySchema.parse({
        geography: {
          level: 'tract',
          tract_fips: '48453001', // 8 digits!
        },
        variables: ['B19013_001E'],
      })
    ).toThrow();

    // Malformed ZCTA (not 5 digits)
    expect(() =>
      CensusAcsQuerySchema.parse({
        geography: {
          level: 'zcta',
          zcta: '7870', // 4 digits!
        },
        variables: ['B19013_001E'],
      })
    ).toThrow();

    // Unsupported geography for ACS (e.g. bounding_box)
    expect(() =>
      CensusAcsQuerySchema.parse({
        geography: {
          level: 'bounding_box',
          min_lat: 30.0,
          max_lat: 30.5,
          min_lon: -97.8,
          max_lon: -97.7,
        },
        variables: ['B19013_001E'],
      })
    ).toThrow(/Census ACS queries support geographies: county, tract, zcta, place, state, nation/);

    // Empty variables array
    expect(() =>
      CensusAcsQuerySchema.parse({
        geography: {
          level: 'county',
          county_fips: '48453',
        },
        variables: [],
      })
    ).toThrow(/At least one variable or metric identifier must be requested/);
  });

  it('validates Census ACS suppression and annotation codes', () => {
    expect(CensusAcsSpecialAnnotationCodeSchema.parse('-666666666')).toBe('-666666666');
    expect(CensusAcsSpecialAnnotationCodeSchema.parse('-888888888')).toBe('-888888888');
    expect(CensusAcsSpecialAnnotationCodeSchema.parse('-999999999')).toBe('-999999999');
    expect(CensusAcsSpecialAnnotationCodeSchema.parse('-555555555')).toBe('-555555555');
    expect(() => CensusAcsSpecialAnnotationCodeSchema.parse('-111111111')).toThrow();
  });
});
