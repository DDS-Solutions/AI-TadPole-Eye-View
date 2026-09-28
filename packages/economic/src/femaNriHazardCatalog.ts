import {
  type FemaNriHazardType,
  type FemaNriVariableDefinition,
  type FemaNriVariableId,
  FemaNriVariableDefinitionSchema,
} from '@gev/contracts';

interface HazardSpec {
  prefix: string;
  hazard_type: FemaNriHazardType;
  labelPrefix: string;
  descriptionNoun: string;
  tag: string;
}

const HAZARD_SPECS: readonly HazardSpec[] = [
  {
    prefix: 'RFLD',
    hazard_type: 'riverine_flooding',
    labelPrefix: 'Riverine Flooding',
    descriptionNoun: 'riverine flooding and inland inundation',
    tag: 'flooding',
  },
  {
    prefix: 'CFLD',
    hazard_type: 'coastal_flooding',
    labelPrefix: 'Coastal Flooding',
    descriptionNoun: 'coastal storm surge and tidal inundation',
    tag: 'coastal',
  },
  {
    prefix: 'HRCN',
    hazard_type: 'hurricane',
    labelPrefix: 'Hurricane',
    descriptionNoun: 'tropical cyclone and hurricane wind/surge impacts',
    tag: 'hurricane',
  },
  {
    prefix: 'TRND',
    hazard_type: 'tornado',
    labelPrefix: 'Tornado',
    descriptionNoun: 'tornadic wind vortices',
    tag: 'tornado',
  },
  {
    prefix: 'WDFR',
    hazard_type: 'wildfire',
    labelPrefix: 'Wildfire',
    descriptionNoun: 'wildland and wildland-urban interface (WUI) fires',
    tag: 'wildfire',
  },
  {
    prefix: 'ERQK',
    hazard_type: 'earthquake',
    labelPrefix: 'Earthquake',
    descriptionNoun: 'seismic shaking hazards',
    tag: 'earthquake',
  },
  {
    prefix: 'SWND',
    hazard_type: 'strong_wind',
    labelPrefix: 'Strong Wind',
    descriptionNoun: 'non-tornadic straight-line damaging winds',
    tag: 'wind',
  },
  {
    prefix: 'WNTW',
    hazard_type: 'winter_weather',
    labelPrefix: 'Winter Weather',
    descriptionNoun: 'blizzards, heavy snow, and sub-freezing hazards',
    tag: 'snow',
  },
  {
    prefix: 'HWAV',
    hazard_type: 'heat_wave',
    labelPrefix: 'Heat Wave',
    descriptionNoun: 'prolonged extreme temperature events',
    tag: 'heat',
  },
  {
    prefix: 'HAIL',
    hazard_type: 'hail',
    labelPrefix: 'Hail',
    descriptionNoun: 'damaging hail storms and convective precipitation',
    tag: 'hail',
  },
  {
    prefix: 'DRGT',
    hazard_type: 'drought',
    labelPrefix: 'Drought',
    descriptionNoun: 'agricultural and hydrological drought',
    tag: 'drought',
  },
  {
    prefix: 'LNDS',
    hazard_type: 'landslide',
    labelPrefix: 'Landslide',
    descriptionNoun: 'gravitational slope failure and debris flow',
    tag: 'landslide',
  },
  {
    prefix: 'LTNG',
    hazard_type: 'lightning',
    labelPrefix: 'Lightning',
    descriptionNoun: 'cloud-to-ground lightning strikes',
    tag: 'lightning',
  },
  {
    prefix: 'ISTM',
    hazard_type: 'ice_storm',
    labelPrefix: 'Ice Storm',
    descriptionNoun: 'freezing rain and structural ice accretion',
    tag: 'ice-storm',
  },
  {
    prefix: 'TSUN',
    hazard_type: 'tsunami',
    labelPrefix: 'Tsunami',
    descriptionNoun: 'seismically-induced coastal and marine waves',
    tag: 'tsunami',
  },
  {
    prefix: 'AVAL',
    hazard_type: 'avalanche',
    labelPrefix: 'Avalanche',
    descriptionNoun: 'snow and ice mass slide hazards in steep terrain',
    tag: 'avalanche',
  },
  {
    prefix: 'CWAV',
    hazard_type: 'cold_wave',
    labelPrefix: 'Cold Wave',
    descriptionNoun: 'extreme sub-freezing temperatures and hypothermia hazards',
    tag: 'cold-wave',
  },
  {
    prefix: 'VLCN',
    hazard_type: 'volcanic_activity',
    labelPrefix: 'Volcanic Activity',
    descriptionNoun: 'volcanic ashfall, tephra, and pyroclastic events',
    tag: 'volcano',
  },
];

function buildHazardDefinitions(): Record<string, FemaNriVariableDefinition> {
  const result: Record<string, FemaNriVariableDefinition> = {};

  for (const spec of HAZARD_SPECS) {
    const slug = spec.hazard_type.replace(/_/g, '-');

    // Risk Score (_RISKS)
    const scoreId = `${spec.prefix}_RISKS` as FemaNriVariableId;
    result[scoreId] = FemaNriVariableDefinitionSchema.parse({
      variable_id: scoreId,
      metric_id: `${slug}-risk-score`,
      label: `${spec.labelPrefix} Risk Score`,
      description: `Relative risk score (0-100) for ${spec.descriptionNoun}.`,
      unit: 'index_score',
      category: 'hazard_risk',
      hazard_type: spec.hazard_type,
      supported_geographies: ['county', 'tract'],
      tags: ['fema', 'nri', 'hazard-risk', spec.tag],
    });

    // Risk Rating (_RISKR)
    const ratingId = `${spec.prefix}_RISKR` as FemaNriVariableId;
    result[ratingId] = FemaNriVariableDefinitionSchema.parse({
      variable_id: ratingId,
      metric_id: `${slug}-risk-rating`,
      label: `${spec.labelPrefix} Risk Rating`,
      description: `Qualitative 5-tier risk rating for ${spec.descriptionNoun}.`,
      unit: 'categorical_rating',
      category: 'hazard_risk',
      hazard_type: spec.hazard_type,
      supported_geographies: ['county', 'tract'],
      tags: ['fema', 'nri', 'rating', spec.tag],
    });

    // Expected Annual Loss Total (_EALT)
    const ealId = `${spec.prefix}_EALT` as FemaNriVariableId;
    result[ealId] = FemaNriVariableDefinitionSchema.parse({
      variable_id: ealId,
      metric_id: `${slug}-expected-annual-loss`,
      label: `${spec.labelPrefix} Expected Annual Loss Total (USD)`,
      description: `Expected economic loss in USD per year from ${spec.descriptionNoun}.`,
      unit: 'USD',
      category: 'expected_annual_loss',
      hazard_type: spec.hazard_type,
      supported_geographies: ['county', 'tract'],
      tags: ['fema', 'nri', 'eal', spec.tag],
    });
  }

  return result;
}

export const FEMA_NRI_HAZARD_VARIABLES: Record<string, FemaNriVariableDefinition> =
  buildHazardDefinitions();
