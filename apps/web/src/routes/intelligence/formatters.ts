export function formatEstimate(
  est?: {
    status: string;
    value?: number;
    margin_of_error?: number;
    noise_band_percent?: number;
  } | null,
  prefix = ''
): string {
  if (!est) return '[UNAVAILABLE]';
  if (est.status === 'suppressed') {
    return est.noise_band_percent ? `[SUPPRESSED] (±${est.noise_band_percent}%)` : '[SUPPRESSED]';
  }
  if (est.status === 'unavailable') return '[UNAVAILABLE]';
  if (est.status === 'not_applicable') return '[N/A]';
  if (est.value === undefined || est.value === null) return '[UNAVAILABLE]';
  const num = prefix ? `${prefix}${est.value.toLocaleString()}` : est.value.toLocaleString();
  return est.margin_of_error ? `${num} ± ${prefix}${est.margin_of_error.toLocaleString()}` : num;
}
