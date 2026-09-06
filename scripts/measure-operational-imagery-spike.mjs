import { promises as dns } from 'node:dns';
import { performance } from 'node:perf_hooks';
import { pinnedFetch } from '../packages/security/dist/index.js';

const NOWCOAST_HOST = 'mapservices.weather.noaa.gov';
const NOWCOAST_ROOT = '/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';
const GOES_SOURCES = [
  { satellite: 'G18', host: 'noaa-goes18.s3.amazonaws.com' },
  { satellite: 'G19', host: 'noaa-goes19.s3.amazonaws.com' },
];
const USER_AGENT =
  'GEV-v2-task-5.3.4-spike/1.0 (+https://github.com/DDS-Solutions/AI-TadPole-Eye-View)';
const TIMEOUT_MS = 15_000;
const NOWCOAST_MAX_BYTES = 4 * 1024 * 1024;
const GLM_MAX_GRANULE_BYTES = 2 * 1024 * 1024;
const GLM_MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const GLM_MAX_GRANULES = 30;
const GLM_GRANULES_PER_SATELLITE = 15;
const NOWCOAST_AOI = Object.freeze({
  minLongitude: -100,
  minLatitude: 30,
  maxLongitude: -90,
  maxLatitude: 40,
});
const NOWCOAST_SIZE = Object.freeze({ width: 1024, height: 1024 });
const resolveFamily = async (hostname, family) =>
  (await dns.lookup(hostname, { all: true, family, verbatim: true })).map(
    (record) => record.address
  );
const SYSTEM_RESOLVER = {
  resolve4: (hostname) => resolveFamily(hostname, 4),
  resolve6: (hostname) => resolveFamily(hostname, 6),
};
function fail(message) {
  throw new Error(message);
}
function parseArgs(argv) {
  const values = new Map();
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match) fail(`Unsupported argument: ${argument}`);
    values.set(match[1], match[2]);
  }
  const utcHour = values.get('utc-hour');
  if (!utcHour) fail('Required argument is missing: --utc-hour=YYYY-MM-DDTHH:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(utcHour)) {
    fail('--utc-hour must be an exact UTC hour');
  }
  const parsedHour = Date.parse(utcHour);
  if (!Number.isFinite(parsedHour)) fail('--utc-hour is not a valid timestamp');
  return { utcHour, parsedHour };
}
function percentile(sorted, percentileValue) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return Number(sorted[index].toFixed(3));
}
function stats(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    p50_ms: percentile(sorted, 0.5),
    p95_ms: percentile(sorted, 0.95),
    max_ms: sorted.length === 0 ? null : Number(sorted[sorted.length - 1].toFixed(3)),
  };
}
function memorySnapshot() {
  const usage = process.memoryUsage();
  return { heap_bytes: usage.heapUsed, rss_bytes: usage.rss };
}
function memoryDelta(before, after, peak) {
  return {
    heap_delta_bytes: after.heap_bytes - before.heap_bytes,
    rss_delta_bytes: after.rss_bytes - before.rss_bytes,
    peak_heap_delta_bytes: Math.max(0, peak.heap_bytes - before.heap_bytes),
    peak_rss_delta_bytes: Math.max(0, peak.rss_bytes - before.rss_bytes),
  };
}
async function measured(operation) {
  const before = memorySnapshot();
  const peak = { ...before };
  const sampler = setInterval(() => {
    const current = memorySnapshot();
    peak.heap_bytes = Math.max(peak.heap_bytes, current.heap_bytes);
    peak.rss_bytes = Math.max(peak.rss_bytes, current.rss_bytes);
  }, 5);
  const started = performance.now();
  try {
    const value = await operation();
    const ended = performance.now();
    const after = memorySnapshot();
    peak.heap_bytes = Math.max(peak.heap_bytes, after.heap_bytes);
    peak.rss_bytes = Math.max(peak.rss_bytes, after.rss_bytes);
    return {
      value,
      duration_ms: Number((ended - started).toFixed(3)),
      memory: memoryDelta(before, after, peak),
    };
  } finally {
    clearInterval(sampler);
  }
}
function incrementCounter(counters, source) {
  counters[source] = (counters[source] ?? 0) + 1;
  if (source === 'nowcoast' && counters[source] > 12) {
    fail('nowCOAST request ceiling exceeded');
  }
  if (source === 'goes-glm' && counters[source] > 2 + GLM_MAX_GRANULES) {
    fail('GOES GLM request ceiling exceeded');
  }
}
async function fetchBytes({ url, host, pathPrefix, maxBytes, counters, source }) {
  incrementCounter(counters, source);
  const response = await pinnedFetch(url, {
    allowedHosts: [host],
    allowedPaths: [{ host, pathPrefix }],
    timeoutMs: TIMEOUT_MS,
    maxBytes,
    customResolver: SYSTEM_RESOLVER,
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
  });
  if (!response.ok) fail(`${source} returned HTTP ${response.status}`);
  const contentType = response.headers.get('content-type');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) fail(`${source} exceeded ${maxBytes} bytes`);
  return { bytes, contentType, cacheControl: response.headers.get('cache-control') };
}
function parsePngDimensions(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 24 || !signature.every((value, index) => bytes[index] === value)) {
    fail('nowCOAST export is not a PNG image');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function parseNowcoastMetadata(bytes) {
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (!payload || typeof payload !== 'object') fail('nowCOAST metadata is not an object');
  const timeExtent = payload.timeInfo?.timeExtent;
  if (
    !Array.isArray(timeExtent) ||
    timeExtent.length !== 2 ||
    !timeExtent.every((value) => Number.isFinite(value))
  ) {
    fail('nowCOAST metadata has no valid time extent');
  }
  if (timeExtent[0] > timeExtent[1]) fail('nowCOAST time extent is reversed');
  return {
    service_description: String(payload.serviceDescription ?? ''),
    copyright_text: String(payload.copyrightText ?? ''),
    time_extent_ms: [timeExtent[0], timeExtent[1]],
    max_image_width: Number(payload.maxImageWidth),
    max_image_height: Number(payload.maxImageHeight),
  };
}

async function measureNowcoast(counters) {
  const metadataUrl = new URL(`https://${NOWCOAST_HOST}${NOWCOAST_ROOT}`);
  metadataUrl.searchParams.set('f', 'pjson');
  const metadataFetch = await measured(() =>
    fetchBytes({
      url: metadataUrl,
      host: NOWCOAST_HOST,
      pathPrefix: NOWCOAST_ROOT,
      maxBytes: 256 * 1024,
      counters,
      source: 'nowcoast',
    })
  );
  const metadata = parseNowcoastMetadata(metadataFetch.value.bytes);
  const selectedTime = metadata.time_extent_ms[1];
  const exportUrl = new URL(`https://${NOWCOAST_HOST}${NOWCOAST_ROOT}/exportImage`);
  exportUrl.searchParams.set(
    'bbox',
    [
      NOWCOAST_AOI.minLongitude,
      NOWCOAST_AOI.minLatitude,
      NOWCOAST_AOI.maxLongitude,
      NOWCOAST_AOI.maxLatitude,
    ].join(',')
  );
  exportUrl.searchParams.set('bboxSR', '4326');
  exportUrl.searchParams.set('imageSR', '4326');
  exportUrl.searchParams.set('size', `${NOWCOAST_SIZE.width},${NOWCOAST_SIZE.height}`);
  exportUrl.searchParams.set('format', 'png32');
  exportUrl.searchParams.set('transparent', 'true');
  exportUrl.searchParams.set('time', String(selectedTime));
  exportUrl.searchParams.set('f', 'image');
  const exportFetch = await measured(() =>
    fetchBytes({
      url: exportUrl,
      host: NOWCOAST_HOST,
      pathPrefix: `${NOWCOAST_ROOT}/exportImage`,
      maxBytes: NOWCOAST_MAX_BYTES,
      counters,
      source: 'nowcoast',
    })
  );
  const dimensions = parsePngDimensions(exportFetch.value.bytes);
  if (dimensions.width > NOWCOAST_SIZE.width || dimensions.height > NOWCOAST_SIZE.height) {
    fail('nowCOAST returned dimensions above the spike ceiling');
  }

  const upstreamBeforeCacheRead = counters.nowcoast;
  const cacheStarted = performance.now();
  const cachedBytes = exportFetch.value.bytes;
  const cacheDuration = performance.now() - cacheStarted;
  if (counters.nowcoast !== upstreamBeforeCacheRead || cachedBytes !== exportFetch.value.bytes) {
    fail('nowCOAST in-memory cache replay unexpectedly dispatched upstream');
  }

  return {
    candidate: 'nws-mrms-base-reflectivity-time',
    request_count: counters.nowcoast,
    exact_request: exportUrl.toString(),
    aoi: NOWCOAST_AOI,
    selected_source_time: new Date(selectedTime).toISOString(),
    advertised_time_extent: metadata.time_extent_ms.map((value) => new Date(value).toISOString()),
    advertised_time_extent_minutes: Number(
      ((metadata.time_extent_ms[1] - metadata.time_extent_ms[0]) / 60_000).toFixed(3)
    ),
    payload_bytes: exportFetch.value.bytes.byteLength,
    dimensions,
    content_type: exportFetch.value.contentType,
    cache_control: exportFetch.value.cacheControl,
    fetch: stats([metadataFetch.duration_ms, exportFetch.duration_ms]),
    fetch_samples_ms: [metadataFetch.duration_ms, exportFetch.duration_ms],
    cache: {
      second_read_upstream_requests: counters.nowcoast - upstreamBeforeCacheRead,
      replay_ms: Number(cacheDuration.toFixed(3)),
    },
    memory: exportFetch.memory,
    decode: {
      status: 'container_validated_only',
      dimensions_parse_ms: null,
      blocker: 'Full browser image decode was not measured by the bounded transport harness',
    },
    playback: {
      status: 'unmeasurable',
      blocker: 'Only one live UTC slice/export is authorized for the spike',
    },
    cesium: {
      status: 'unmeasurable',
      blocker: 'No accepted Cesium imagery prototype exists before this spike decision',
    },
  };
}

function utcHourPrefix(parsedHour) {
  const date = new Date(parsedHour);
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const dayOfYear = Math.floor((parsedHour - start) / 86_400_000) + 1;
  return `GLM-L2-LCFA/${year}/${String(dayOfYear).padStart(3, '0')}/${String(date.getUTCHours()).padStart(2, '0')}/`;
}

function decodeXmlText(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function parseS3Listing(bytes, expectedPrefix, expectedSatellite) {
  const xml = new TextDecoder().decode(bytes);
  const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)];
  const records = [];
  for (const match of contents) {
    const body = match[1];
    const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(body);
    const sizeMatch = /<Size>(\d+)<\/Size>/.exec(body);
    if (!keyMatch || !sizeMatch) fail('GOES listing contains malformed object metadata');
    const key = decodeXmlText(keyMatch[1]);
    const size = Number(sizeMatch[1]);
    const escapedPrefix = expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyPattern = new RegExp(
      `^${escapedPrefix}OR_GLM-L2-LCFA_${expectedSatellite}_s\\d{13,16}_e\\d{13,16}_c\\d{13,16}\\.nc$`
    );
    if (!keyPattern.test(key)) fail(`GOES listing returned an unexpected key: ${key}`);
    if (!Number.isSafeInteger(size) || size < 1 || size > GLM_MAX_GRANULE_BYTES) {
      fail(`GOES listing object size violates the 2 MiB ceiling: ${key}`);
    }
    records.push({ key, advertised_bytes: size });
  }
  if (records.length === 0) fail(`${expectedSatellite} listing returned no granules`);
  if (records.length > GLM_GRANULES_PER_SATELLITE) {
    fail(`${expectedSatellite} listing exceeded the per-satellite granule ceiling`);
  }
  return records;
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function measureGoesGlm(counters, utcHour, parsedHour) {
  const prefix = utcHourPrefix(parsedHour);
  const listingMeasurements = [];
  const objects = [];
  for (const source of GOES_SOURCES) {
    const listingUrl = new URL(`https://${source.host}/`);
    listingUrl.searchParams.set('list-type', '2');
    listingUrl.searchParams.set('prefix', prefix);
    listingUrl.searchParams.set('max-keys', String(GLM_GRANULES_PER_SATELLITE));
    const listingFetch = await measured(() =>
      fetchBytes({
        url: listingUrl,
        host: source.host,
        pathPrefix: '/',
        maxBytes: 256 * 1024,
        counters,
        source: 'goes-glm',
      })
    );
    listingMeasurements.push(listingFetch);
    for (const record of parseS3Listing(listingFetch.value.bytes, prefix, source.satellite)) {
      objects.push({ ...source, ...record });
    }
  }
  if (objects.length > GLM_MAX_GRANULES) fail('GOES spike selected too many granules');
  const advertisedTotal = objects.reduce((total, object) => total + object.advertised_bytes, 0);
  if (advertisedTotal > GLM_MAX_TOTAL_BYTES) fail('GOES advertised total exceeds 60 MiB');

  let active = 0;
  let observedMaxConcurrency = 0;
  const granuleMeasurements = await mapWithConcurrency(objects, 2, async (object) => {
    active += 1;
    observedMaxConcurrency = Math.max(observedMaxConcurrency, active);
    try {
      const objectUrl = new URL(`https://${object.host}/${object.key}`);
      const result = await measured(() =>
        fetchBytes({
          url: objectUrl,
          host: object.host,
          pathPrefix: `/${prefix}`,
          maxBytes: GLM_MAX_GRANULE_BYTES,
          counters,
          source: 'goes-glm',
        })
      );
      if (result.value.bytes.byteLength !== object.advertised_bytes) {
        fail(`GOES payload size differs from listing for ${object.key}`);
      }
      const signature = new TextDecoder().decode(result.value.bytes.subarray(1, 4));
      if (result.value.bytes[0] !== 0x89 || signature !== 'HDF') {
        fail(`GOES granule is not a NetCDF4/HDF5 payload: ${object.key}`);
      }
      return {
        key: object.key,
        satellite: object.satellite,
        bytes: result.value.bytes.byteLength,
        duration_ms: result.duration_ms,
        memory: result.memory,
        cache_control: result.value.cacheControl,
      };
    } finally {
      active -= 1;
    }
  });

  const actualTotal = granuleMeasurements.reduce((total, granule) => total + granule.bytes, 0);
  const firstGranule = granuleMeasurements[0];
  const upstreamBeforeCacheRead = counters['goes-glm'];
  const cacheStarted = performance.now();
  const cachedIdentity = firstGranule?.key;
  const cacheDuration = performance.now() - cacheStarted;
  if (counters['goes-glm'] !== upstreamBeforeCacheRead || !cachedIdentity) {
    fail('GOES in-memory immutable-granule cache replay failed');
  }

  const peakMemory = granuleMeasurements.reduce(
    (peak, granule) => ({
      peak_heap_delta_bytes: Math.max(
        peak.peak_heap_delta_bytes,
        granule.memory.peak_heap_delta_bytes
      ),
      peak_rss_delta_bytes: Math.max(
        peak.peak_rss_delta_bytes,
        granule.memory.peak_rss_delta_bytes
      ),
    }),
    { peak_heap_delta_bytes: 0, peak_rss_delta_bytes: 0 }
  );
  return {
    candidate: 'glm-l2-lcfa',
    utc_hour: utcHour,
    prefix,
    request_count: counters['goes-glm'],
    listing_count: GOES_SOURCES.length,
    granule_count: granuleMeasurements.length,
    observed_max_concurrency: observedMaxConcurrency,
    payload_bytes: actualTotal,
    bandwidth_mib: Number((actualTotal / 1024 / 1024).toFixed(3)),
    granules: granuleMeasurements.map(({ key, satellite, bytes, duration_ms }) => ({
      key,
      satellite,
      bytes,
      fetch_ms: duration_ms,
    })),
    listing_fetch: stats(listingMeasurements.map((measurement) => measurement.duration_ms)),
    granule_fetch: stats(granuleMeasurements.map((granule) => granule.duration_ms)),
    cache: {
      immutable_granule: cachedIdentity,
      second_read_upstream_requests: counters['goes-glm'] - upstreamBeforeCacheRead,
      replay_ms: Number(cacheDuration.toFixed(3)),
    },
    memory: peakMemory,
    decode: {
      status: 'unmeasurable',
      normalized_record_count: null,
      blocker:
        'Repository has no accepted NetCDF4/HDF5 decoder; the product is explicitly outside the classic NetCDF data model',
    },
    playback: {
      status: 'unmeasurable',
      blocker:
        'Normalized source-valid flash records could not be produced without an accepted decoder',
    },
    cesium: {
      status: 'unmeasurable',
      blocker: 'No bounded normalized record set was available for Cesium ingestion',
    },
  };
}

async function assertConnectedGovernance() {
  const response = await fetch('http://127.0.0.1:3000/api/health', {
    signal: AbortSignal.timeout(1_500),
  });
  if (!response.ok) fail(`Connected GEV health returned HTTP ${response.status}`);
  const health = await response.json();
  if (health.stasis_active !== false) fail('STASIS is active; spike is forbidden');
  if (health.governance_authority?.authoritative !== true) {
    fail('Connected GEV governance authority is not authoritative');
  }
  if (health.seed_mode !== true) fail('GEV server must remain in seed mode during the spike');
  return {
    authority: health.governance_authority,
    stasis_active: health.stasis_active,
    budget_remaining_usd: health.budget_remaining_usd,
    server_mode: 'seed',
  };
}

async function main() {
  const { utcHour, parsedHour } = parseArgs(process.argv.slice(2));
  const governance = await assertConnectedGovernance();
  const counters = { nowcoast: 0, 'goes-glm': 0 };
  const report = {
    schema_version: 1,
    task: '5.3.4',
    trial: 'bounded-official-sample-v1',
    constraints: {
      timeout_ms: TIMEOUT_MS,
      max_concurrency_per_source: 2,
      nowcoast: {
        max_requests_per_hour: 12,
        max_export_bytes: NOWCOAST_MAX_BYTES,
        max_dimensions: NOWCOAST_SIZE,
        max_time_slices: 1,
      },
      goes_glm: {
        satellites: GOES_SOURCES.map((source) => source.satellite),
        max_listings: 2,
        max_granules: GLM_MAX_GRANULES,
        max_granule_bytes: GLM_MAX_GRANULE_BYTES,
        max_total_bytes: GLM_MAX_TOTAL_BYTES,
      },
    },
    governance,
    nowcoast: await measureNowcoast(counters),
    goes_glm: await measureGoesGlm(counters, utcHour, parsedHour),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      schema_version: 1,
      task: '5.3.4',
      status: 'failed_closed',
      error: error instanceof Error ? error.message : String(error),
    })
  );
  process.exitCode = 1;
});
