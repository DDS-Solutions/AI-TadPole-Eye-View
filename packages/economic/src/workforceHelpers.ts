import {
  type EconomicEstimate,
  type EconomicEvidenceRecord,
  type WorkforceWagePercentiles,
  getNumericEstimateValue,
} from '@gev/contracts';

export const KNOWN_SOC_TITLES: Record<string, string> = {
  '00-0000': 'All Occupations',
  '11-0000': 'Management Occupations',
  '13-0000': 'Business & Financial Operations',
  '15-0000': 'Computer & Mathematical Occupations',
  '15-1252': 'Software Developers',
  '15-1211': 'Computer Systems Analysts',
  '17-0000': 'Architecture & Engineering Occupations',
  '19-0000': 'Life, Physical, & Social Science',
  '21-0000': 'Community & Social Service',
  '23-0000': 'Legal Occupations',
  '25-0000': 'Educational Instruction & Library',
  '27-0000': 'Arts, Design, Entertainment, Sports, & Media',
  '29-0000': 'Healthcare Practitioners & Technical',
  '29-1141': 'Registered Nurses',
  '31-0000': 'Healthcare Support Occupations',
  '33-0000': 'Protective Service Occupations',
  '35-0000': 'Food Preparation & Serving',
  '35-2014': 'Cooks, Restaurant',
  '37-0000': 'Building & Grounds Cleaning',
  '39-0000': 'Personal Care & Service',
  '41-0000': 'Sales & Related Occupations',
  '43-0000': 'Office & Administrative Support',
  '45-0000': 'Farming, Fishing, & Forestry',
  '47-0000': 'Construction & Extraction',
  '49-0000': 'Installation, Maintenance, & Repair',
  '51-0000': 'Production Occupations',
  '53-0000': 'Transportation & Material Moving',
};

export const unavail = (reason: string): EconomicEstimate => ({ status: 'unavailable', reason });

export function findOewsRecord(
  records: readonly EconomicEvidenceRecord[],
  socCode: string,
  varNameOrMetric: string
): EconomicEvidenceRecord | undefined {
  const normSoc = socCode.replace('-', '');
  return records.find((r) => {
    const otherSocMatch = r.evidence_id.match(/\b\d{6}\b/);
    if (otherSocMatch && otherSocMatch[0] !== normSoc && socCode !== '00-0000') {
      return false;
    }
    return (
      r.variable_name === varNameOrMetric ||
      r.metric_id === varNameOrMetric ||
      r.metric_id.includes(varNameOrMetric.toLowerCase().replace('_', '-'))
    );
  });
}

export function calculateEstimateRatio(
  numEst: EconomicEstimate,
  denEst: EconomicEstimate,
  unit: string = 'ratio'
): EconomicEstimate {
  const numVal = getNumericEstimateValue(numEst);
  const denVal = getNumericEstimateValue(denEst);

  if (numVal !== undefined && denVal !== undefined && denVal > 0) {
    return {
      status: 'available',
      value: Math.round((numVal / denVal) * 100) / 100,
      unit,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
    };
  }

  if (numEst.status === 'suppressed') {
    return {
      status: 'suppressed',
      reason: numEst.reason,
      detail: `Ratio suppressed: numerator suppressed (${numEst.detail})`,
      ...(numEst.bounds ? { bounds: numEst.bounds } : {}),
      unit,
    };
  }
  if (denEst.status === 'suppressed') {
    return {
      status: 'suppressed',
      reason: denEst.reason,
      detail: `Ratio suppressed: denominator suppressed (${denEst.detail})`,
      ...(denEst.bounds ? { bounds: denEst.bounds } : {}),
      unit,
    };
  }

  return unavail('Component estimate unavailable to calculate ratio');
}

export function extractWagePercentiles(
  records: readonly EconomicEvidenceRecord[],
  socCode: string,
  prefix: 'H' | 'A'
): WorkforceWagePercentiles {
  const isH = prefix === 'H';
  const otherPrefix = isH ? 'A' : 'H';
  const lookup = (key: string): EconomicEstimate => {
    const direct = findOewsRecord(records, socCode, `${prefix}_${key}`)?.estimate;
    if (direct) return direct;
    const alt = findOewsRecord(records, socCode, `${otherPrefix}_${key}`)?.estimate;
    if (alt?.status === 'available' && typeof alt.value === 'number') {
      return {
        ...alt,
        value: isH ? Number((alt.value / 2080).toFixed(2)) : Math.round(alt.value * 2080),
        unit: isH ? 'USD_per_hour' : 'USD',
      };
    }
    if (alt && alt.status !== 'available') return alt;
    return unavail(`OEWS ${prefix}_${key} estimate not provided in evidence records`);
  };

  return {
    pct10: lookup('PCT10'),
    pct25: lookup('PCT25'),
    median: lookup('MEDIAN'),
    pct75: lookup('PCT75'),
    pct90: lookup('PCT90'),
    mean: lookup('MEAN'),
  };
}

export function makeVarLink(rec: EconomicEvidenceRecord, fallbackVintage: string) {
  return {
    source_id: rec.source_id,
    variable_id: rec.variable_name,
    metric_id: rec.metric_id,
    vintage:
      rec.provenance.vintage.status === 'available'
        ? rec.provenance.vintage.value
        : fallbackVintage,
    attribution: rec.provenance.attribution,
  };
}

export function resolveLauPeriodAndYear(
  lauRateRec: EconomicEvidenceRecord | undefined,
  clockTimestamp: string
): { period: `M${string}`; year: string } {
  const idPeriod = lauRateRec?.evidence_id.match(/M(?:0[1-9]|1[0-2])/)?.[0];
  const idYear = lauRateRec?.evidence_id.match(/\b20\d{2}\b/)?.[0];
  const obsEnd =
    lauRateRec?.provenance.observation_period.status === 'available'
      ? lauRateRec.provenance.observation_period.end
      : undefined;
  const sourceIso = obsEnd ?? clockTimestamp;
  const parsed = new Date(sourceIso);
  const derivedMonth = Number.isNaN(parsed.getTime())
    ? 'M06'
    : `M${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
  const derivedYear = Number.isNaN(parsed.getTime()) ? '2024' : String(parsed.getUTCFullYear());
  return {
    period: (idPeriod ?? derivedMonth) as `M${string}`,
    year: idYear ?? derivedYear,
  };
}
