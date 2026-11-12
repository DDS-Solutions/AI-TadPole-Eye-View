export interface Metric {
  label: string;
  value: string;
}

export interface EconomicModule {
  id: string;
  phase: string;
  title: string;
  badge: string;
  status: string;
  statusReason: string;
  sources: string[];
  metrics: Metric[];
}

export const economicModules: readonly EconomicModule[] = [
  {
    id: 'phase-8',
    phase: 'Phase 8',
    title: 'Economic R0: Foundation & Core Contracts',
    badge: 'CORE CONTRACTS',
    status: 'PLANNED',
    statusReason:
      'Phase 8 implementation planned. Contracts, schemas, and deterministic fixtures pending.',
    sources: [
      'Discriminated Geography',
      'Economic Estimates',
      'DataProvenance',
      'BusinessContext Preview',
    ],
    metrics: [
      { label: 'SCHEMA VALIDATION', value: 'STRICT ZOD' },
      { label: 'FIXTURES MODE', value: 'SEED ONLY' },
      { label: 'NETWORK ACCESS', value: 'DENIED' },
    ],
  },
  {
    id: 'phase-9',
    phase: 'Phase 9',
    title: 'Economic R1: Market & Business Footprint',
    badge: 'CENSUS ACS / CBP / ZBP',
    status: 'INSPECTION READY',
    statusReason:
      'Phase 9 active. Census 5-Year ACS, CBP/ZBP, and OSM Commercial Footprint inspection ready.',
    sources: ['US Census ACS 5-Year', 'Census CBP', 'Census ZBP', 'OSM Commercial Footprint'],
    metrics: [
      { label: 'ESTIMATES TYPE', value: 'DISCLOSED / SUPPRESSED' },
      { label: 'PROVENANCE', value: 'MANDATORY' },
      { label: 'VINTAGE', value: 'MULTI-YEAR' },
    ],
  },
  {
    id: 'phase-10',
    phase: 'Phase 10',
    title: 'Economic R2: Workforce & Labor Dynamics',
    badge: 'BLS OEWS / LAU',
    status: 'INSPECTION READY',
    statusReason:
      'Phase 10 active. Bureau of Labor Statistics OEWS wage percentiles and LAU unemployment dynamics ready.',
    sources: ['BLS OEWS', 'BLS LAU', 'Area Occupation Matrix'],
    metrics: [
      { label: 'WAGE BENCHMARK', value: 'PERCENTILE HOURLY/ANNUAL' },
      { label: 'EMPLOYMENT SIGNAL', value: 'AREA STATISTICAL' },
      { label: 'PII EXPOSURE', value: 'ZERO' },
    ],
  },
  {
    id: 'phase-11',
    phase: 'Phase 11',
    title: 'Economic R3: Risk, Resilience & Accessibility',
    badge: 'FEMA / USGS / EPA / DOT',
    status: 'INSPECTION READY',
    statusReason:
      'Phase 11 active. FEMA NRI/NFHL, USGS 3DEP, historical EPA AQS, DOT/BTS accessibility, and site-risk screening ready.',
    sources: ['FEMA NRI / NFHL', 'USGS 3DEP EPQS', 'EPA AQS (Historical)', 'DOT/BTS Accessibility'],
    metrics: [
      { label: 'HAZARD HORIZON', value: 'LONG-TERM VS LIVE ALERTS' },
      { label: 'SCREENING ADVICE', value: 'NON-DEFINITIVE ONLY' },
      { label: 'UNMONITORED DATA', value: 'NON-COERCED' },
    ],
  },
];
