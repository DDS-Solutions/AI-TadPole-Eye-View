import type { EconomicGeography } from '@gev/contracts';

export type MarketInspectorTabId =
  | 'market'
  | 'competition'
  | 'comparison'
  | 'workforce'
  | 'site-risk';

export const GEOGRAPHY_PRESETS: Array<{ id: string; label: string; geo: EconomicGeography }> = [
  {
    id: 'travis-county',
    label: 'Travis County, TX (County)',
    geo: { level: 'county', county_fips: '48453', state_fips: '48', name: 'Travis County, TX' },
  },
  {
    id: 'austin-city',
    label: 'Austin City, TX (Place)',
    geo: { level: 'place', place_fips: '4805000', name: 'Austin city, TX' },
  },
  {
    id: 'downtown-78701',
    label: 'Downtown Austin (ZCTA 78701)',
    geo: { level: 'zcta', zcta: '78701', name: 'ZCTA 78701' },
  },
];

export const NAICS_PRESETS = [
  { code: '722511', title: 'Full-Service Restaurants' },
  { code: '541511', title: 'Custom Computer Programming Services' },
  { code: '44-45', title: 'Retail Trade' },
];

export const SOC_PRESETS = [
  { code: '15-1252', title: 'Software Developers' },
  { code: '29-1141', title: 'Registered Nurses' },
  { code: '35-2014', title: 'Cooks, Restaurant' },
  { code: '00-0000', title: 'All Occupations' },
];
