import {
  FEMA_NRI_DEFAULT_VINTAGE,
  FEMA_NRI_SCHEMA_VERSION,
  FEMA_NRI_SCREENING_DISCLAIMER,
  type FemaNriVariableDefinition,
  FemaNriVariableDefinitionSchema,
  type FemaNriVariableDictionary,
  FemaNriVariableDictionarySchema,
} from '@gev/contracts';

export { FEMA_NRI_SCHEMA_VERSION, FEMA_NRI_DEFAULT_VINTAGE, FEMA_NRI_SCREENING_DISCLAIMER };

/**
 * Versioned FEMA National Risk Index (NRI) Variable Definitions (V1.0.0).
 * Implements PLAN.md §10 Task 11.1 and ADR 0062.
 * Pure domain metadata with zero I/O.
 */
export const FEMA_NRI_VARIABLES_V1: Record<string, FemaNriVariableDefinition> = {
  RISK_SCORE: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'RISK_SCORE',
    metric_id: 'nri-composite-risk-score',
    label: 'FEMA NRI Composite Risk Score',
    description:
      'National Risk Index composite score (0-100 scale) measuring relative natural hazard risk based on Expected Annual Loss, Social Vulnerability, and Community Resilience.',
    unit: 'index_score',
    category: 'composite_risk',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'nri', 'risk', 'composite'],
  }),

  RISK_RATNG: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'RISK_RATNG',
    metric_id: 'nri-composite-risk-rating',
    label: 'FEMA NRI Composite Risk Rating',
    description:
      'Qualitative 5-tier rating (Very Low, Relatively Low, Relatively Moderate, Relatively High, Very High) corresponding to composite risk score.',
    unit: 'categorical_rating',
    category: 'composite_risk',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'nri', 'rating', 'composite'],
  }),

  RISK_NPCTL: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'RISK_NPCTL',
    metric_id: 'nri-risk-national-percentile',
    label: 'Composite Risk National Percentile',
    description:
      'National percentile ranking (0-100) of composite risk relative to all US counties or tracts.',
    unit: 'percentile',
    category: 'composite_risk',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'nri', 'percentile', 'national'],
  }),

  RISK_SPCTL: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'RISK_SPCTL',
    metric_id: 'nri-risk-state-percentile',
    label: 'Composite Risk State Percentile',
    description:
      'State percentile ranking (0-100) of composite risk relative to other areas within the state.',
    unit: 'percentile',
    category: 'composite_risk',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'nri', 'percentile', 'state'],
  }),

  EAL_VALT: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'EAL_VALT',
    metric_id: 'expected-annual-loss-total',
    label: 'Expected Annual Loss Total (USD)',
    description:
      'Total estimated economic consequence in USD per year from 18 natural hazards across buildings, population, and agriculture.',
    unit: 'USD',
    category: 'expected_annual_loss',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'eal', 'economic-loss', 'total'],
  }),

  EAL_VALB: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'EAL_VALB',
    metric_id: 'expected-annual-loss-building',
    label: 'Expected Annual Loss Building (USD)',
    description:
      'Estimated annual physical replacement and structural damage to buildings in USD per year.',
    unit: 'USD',
    category: 'expected_annual_loss',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'eal', 'building', 'damage'],
  }),

  EAL_VALP: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'EAL_VALP',
    metric_id: 'expected-annual-loss-population',
    label: 'Expected Annual Loss Population Fatality/Injury Value (USD)',
    description:
      'Estimated annual economic value of human fatalities and injuries modeled using standard statistical value of life (VSL).',
    unit: 'USD',
    category: 'expected_annual_loss',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'eal', 'population', 'vsl'],
  }),

  EAL_VALA: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'EAL_VALA',
    metric_id: 'expected-annual-loss-agriculture',
    label: 'Expected Annual Loss Agriculture (USD)',
    description: 'Estimated annual damage and loss to crops and livestock in USD per year.',
    unit: 'USD',
    category: 'expected_annual_loss',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'eal', 'agriculture', 'crops'],
  }),

  EAL_SCORE: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'EAL_SCORE',
    metric_id: 'expected-annual-loss-score',
    label: 'Expected Annual Loss Score',
    description:
      'Normalized relative score (0-100) representing total expected annual loss across all hazard types.',
    unit: 'index_score',
    category: 'expected_annual_loss',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'eal', 'score'],
  }),

  EAL_RATNG: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'EAL_RATNG',
    metric_id: 'expected-annual-loss-rating',
    label: 'Expected Annual Loss Rating',
    description: 'Qualitative rating of expected annual loss relative to the nation.',
    unit: 'categorical_rating',
    category: 'expected_annual_loss',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'eal', 'rating'],
  }),

  SOVI_SCORE: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'SOVI_SCORE',
    metric_id: 'social-vulnerability-score',
    label: 'Social Vulnerability Score',
    description:
      'Relative score (0-100) representing socioeconomic and demographic factors that affect a community’s capacity to prevent, respond to, and recover from disaster.',
    unit: 'index_score',
    category: 'social_vulnerability',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'sovi', 'vulnerability', 'cdc'],
  }),

  SOVI_RATNG: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'SOVI_RATNG',
    metric_id: 'social-vulnerability-rating',
    label: 'Social Vulnerability Rating',
    description: 'Qualitative rating of social vulnerability.',
    unit: 'categorical_rating',
    category: 'social_vulnerability',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'sovi', 'rating'],
  }),

  SOVI_NPCTL: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'SOVI_NPCTL',
    metric_id: 'social-vulnerability-national-percentile',
    label: 'Social Vulnerability National Percentile',
    description: 'National percentile ranking of social vulnerability.',
    unit: 'percentile',
    category: 'social_vulnerability',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'sovi', 'percentile'],
  }),

  RESL_SCORE: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'RESL_SCORE',
    metric_id: 'community-resilience-score',
    label: 'Community Resilience Score',
    description:
      'HVRI Baseline Resilience Indicators for Communities (BRIC) score (0-100) measuring capacity to absorb, recover from, and adapt to hazard impacts.',
    unit: 'index_score',
    category: 'community_resilience',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'resilience', 'bric', 'capacity'],
  }),

  RESL_RATNG: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'RESL_RATNG',
    metric_id: 'community-resilience-rating',
    label: 'Community Resilience Rating',
    description: 'Qualitative rating of community resilience capacity.',
    unit: 'categorical_rating',
    category: 'community_resilience',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'resilience', 'rating'],
  }),

  RESL_NPCTL: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'RESL_NPCTL',
    metric_id: 'community-resilience-national-percentile',
    label: 'Community Resilience National Percentile',
    description: 'National percentile ranking of community resilience.',
    unit: 'percentile',
    category: 'community_resilience',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'resilience', 'percentile'],
  }),

  POPULATION: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'POPULATION',
    metric_id: 'resident-population-exposure',
    label: 'Resident Population Exposure',
    description: 'Total resident civilian population exposed to hazard modeling.',
    unit: 'count',
    category: 'exposure',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'exposure', 'population'],
  }),

  BUILDVALUE: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'BUILDVALUE',
    metric_id: 'building-exposure-value-total',
    label: 'Total Building Asset Value (USD)',
    description:
      'Total replacement value of residential, commercial, and industrial building stock in USD.',
    unit: 'USD',
    category: 'exposure',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'exposure', 'buildings', 'assets'],
  }),

  AGRIVALUE: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'AGRIVALUE',
    metric_id: 'agriculture-exposure-value-total',
    label: 'Total Agricultural Asset Value (USD)',
    description: 'Total market value of agricultural crops and livestock in USD.',
    unit: 'USD',
    category: 'exposure',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'exposure', 'agriculture'],
  }),

  // Key Individual Hazard Scores
  RFLD_RISKS: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'RFLD_RISKS',
    metric_id: 'riverine-flooding-risk-score',
    label: 'Riverine Flooding Risk Score',
    description: 'Relative risk score (0-100) for riverine / inland overflow flooding.',
    unit: 'index_score',
    category: 'hazard_risk',
    hazard_type: 'riverine_flooding',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'flooding', 'riverine', 'hazard-risk'],
  }),

  RFLD_EALT: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'RFLD_EALT',
    metric_id: 'riverine-flooding-expected-annual-loss',
    label: 'Riverine Flooding Expected Annual Loss (USD)',
    description: 'Expected economic loss in USD per year from riverine flooding.',
    unit: 'USD',
    category: 'expected_annual_loss',
    hazard_type: 'riverine_flooding',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'flooding', 'riverine', 'eal'],
  }),

  CFLD_RISKS: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'CFLD_RISKS',
    metric_id: 'coastal-flooding-risk-score',
    label: 'Coastal Flooding Risk Score',
    description: 'Relative risk score (0-100) for coastal surge and tidal inundation.',
    unit: 'index_score',
    category: 'hazard_risk',
    hazard_type: 'coastal_flooding',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'coastal', 'storm-surge', 'hazard-risk'],
  }),

  HRCN_RISKS: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'HRCN_RISKS',
    metric_id: 'hurricane-risk-score',
    label: 'Hurricane Risk Score',
    description: 'Relative risk score (0-100) for tropical cyclone and hurricane impacts.',
    unit: 'index_score',
    category: 'hazard_risk',
    hazard_type: 'hurricane',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'hurricane', 'cyclone', 'hazard-risk'],
  }),

  TRND_RISKS: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'TRND_RISKS',
    metric_id: 'tornado-risk-score',
    label: 'Tornado Risk Score',
    description: 'Relative risk score (0-100) for tornadic wind vortices.',
    unit: 'index_score',
    category: 'hazard_risk',
    hazard_type: 'tornado',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'tornado', 'wind', 'hazard-risk'],
  }),

  WDFR_RISKS: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'WDFR_RISKS',
    metric_id: 'wildfire-risk-score',
    label: 'Wildfire Risk Score',
    description:
      'Relative risk score (0-100) for wildland and wildland-urban interface (WUI) fires.',
    unit: 'index_score',
    category: 'hazard_risk',
    hazard_type: 'wildfire',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'wildfire', 'wui', 'hazard-risk'],
  }),

  ERQK_RISKS: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'ERQK_RISKS',
    metric_id: 'earthquake-risk-score',
    label: 'Earthquake Risk Score',
    description: 'Relative risk score (0-100) for seismic shaking hazards.',
    unit: 'index_score',
    category: 'hazard_risk',
    hazard_type: 'earthquake',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'earthquake', 'seismic', 'hazard-risk'],
  }),

  SWND_RISKS: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'SWND_RISKS',
    metric_id: 'strong-wind-risk-score',
    label: 'Strong Wind Risk Score',
    description: 'Relative risk score (0-100) for non-tornadic straight-line damaging winds.',
    unit: 'index_score',
    category: 'hazard_risk',
    hazard_type: 'strong_wind',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'wind', 'straight-line', 'hazard-risk'],
  }),

  HWAV_RISKS: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'HWAV_RISKS',
    metric_id: 'heat-wave-risk-score',
    label: 'Heat Wave Risk Score',
    description: 'Relative risk score (0-100) for prolonged extreme temperature events.',
    unit: 'index_score',
    category: 'hazard_risk',
    hazard_type: 'heat_wave',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'heat', 'temperature', 'hazard-risk'],
  }),

  DRGT_RISKS: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'DRGT_RISKS',
    metric_id: 'drought-risk-score',
    label: 'Drought Risk Score',
    description: 'Relative risk score (0-100) for agricultural and hydrological drought.',
    unit: 'index_score',
    category: 'hazard_risk',
    hazard_type: 'drought',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'drought', 'water-stress', 'hazard-risk'],
  }),

  WNTW_RISKS: FemaNriVariableDefinitionSchema.parse({
    variable_id: 'WNTW_RISKS',
    metric_id: 'winter-weather-risk-score',
    label: 'Winter Weather Risk Score',
    description: 'Relative risk score (0-100) for blizzards, heavy snow, and sub-freezing hazards.',
    unit: 'index_score',
    category: 'hazard_risk',
    hazard_type: 'winter_weather',
    supported_geographies: ['county', 'tract'],
    tags: ['fema', 'winter', 'snow', 'hazard-risk'],
  }),
};

/**
 * Authoritative FEMA NRI Variable Dictionary V1 instance.
 */
export const FEMA_NRI_VARIABLE_DICTIONARY_V1: FemaNriVariableDictionary =
  FemaNriVariableDictionarySchema.parse({
    schema_version: FEMA_NRI_SCHEMA_VERSION,
    version: '1.0.0',
    program: 'fema_nri',
    screening_disclaimer: FEMA_NRI_SCREENING_DISCLAIMER,
    vintages_supported: [FEMA_NRI_DEFAULT_VINTAGE, 'August 2023'],
    variables: FEMA_NRI_VARIABLES_V1,
  });

export const FEMA_NRI_VARIABLE_DICTIONARY = FEMA_NRI_VARIABLE_DICTIONARY_V1;

/**
 * Resolves a variable definition by exact variable_id or metric_id.
 */
export function lookupFemaNriVariable(
  variableIdOrMetricId: string
): FemaNriVariableDefinition | undefined {
  if (FEMA_NRI_VARIABLES_V1[variableIdOrMetricId]) {
    return FEMA_NRI_VARIABLES_V1[variableIdOrMetricId];
  }
  return Object.values(FEMA_NRI_VARIABLES_V1).find((def) => def.metric_id === variableIdOrMetricId);
}
