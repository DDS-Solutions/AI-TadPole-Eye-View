import fs from 'node:fs';
import {
  NHC_INDEX_MAX_ITEMS,
  NHC_USAGE_NOTICE,
  type OperationalAoi,
  OperationalAoiSchema,
  type TropicalCycloneAdvisory,
  type TropicalCycloneBasin,
  type TropicalCycloneProduct,
  type TropicalCycloneResponse,
  TropicalCycloneResponseSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { z } from 'zod';
import { extractBoundedKmlFromKmz } from './boundedKmz.js';
import { resolveFixturePath } from './opensky.js';
import {
  type OperationalFetcher,
  assertIdentifiedUserAgent,
  defaultOperationalFetcher,
  geometryIntersectsAoi,
  normalizeIsoTime,
  normalizedAoiKey,
  readBoundedBytes,
  readBoundedText,
} from './operationalHttp.js';
import { createDataProvenance, unavailableObservationPeriod } from './provenance.js';
import { OperationalSourceError } from './solarContext.js';

const NHC_INDEX_MAX_BYTES = 5_242_880;
const NHC_ASSET_MAX_BYTES = 5_242_880;
const NHC_MAX_STALE_MS = 21_600_000;
const NHC_HOST = 'www.nhc.noaa.gov';
const BASIN_ENDPOINTS: Readonly<Record<TropicalCycloneBasin, string>> = {
  atlantic: 'https://www.nhc.noaa.gov/gis-at.xml',
  eastern_pacific: 'https://www.nhc.noaa.gov/gis-ep.xml',
  central_pacific: 'https://www.nhc.noaa.gov/gis-cp.xml',
};
const BASINS = Object.keys(BASIN_ENDPOINTS) as TropicalCycloneBasin[];

const SeedFixtureSchema = z.object({
  schema_version: z.literal(1),
  indexes: z
    .array(
      z.object({
        basin: z.enum(BASINS as [TropicalCycloneBasin, ...TropicalCycloneBasin[]]),
        xml: z.string(),
      })
    )
    .length(3),
  assets: z.record(z.string(), z.string()),
});

interface StormSummary {
  stormId: string;
  name: string;
  stormType: string;
  observedAt: string;
}

interface AdvisoryAsset {
  id: string;
  basin: TropicalCycloneBasin;
  storm: StormSummary;
  advisoryNumber: string;
  product: TropicalCycloneProduct;
  issuedAt: string;
  url: string;
}

export interface TropicalCycloneAdapterOptions {
  clock?: SimClock;
  seedMode?: boolean;
  enabled?: boolean;
  liveAccessEnabled?: boolean;
  termsApproved?: boolean;
  userAgent?: string;
  seedFixturePath?: string;
  fetcher?: OperationalFetcher;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x?[0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code.replace(/^x/i, ''), code.startsWith('x') ? 16 : 10))
    )
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .trim();
}

function readTag(xml: string, name: string): string | null {
  const tag = escapeRegExp(name);
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1] ? decodeXml(match[1]) : null;
}

function assertPassiveXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) {
    throw new Error('Active or entity-bearing XML is not accepted');
  }
}

function parseSummary(item: string): StormSummary | null {
  const stormId = readTag(item, 'nhc:atcf')?.toUpperCase();
  const name = readTag(item, 'nhc:name');
  const stormType = readTag(item, 'nhc:type');
  const observedAt = readTag(item, 'nhc:datetime');
  if (!stormId || !/^[A-Z]{2}\d{6}$/.test(stormId) || !name || !stormType || !observedAt) {
    return null;
  }
  return {
    stormId,
    name,
    stormType,
    observedAt: normalizeIsoTime(observedAt, 'NHC observation time'),
  };
}

function parseProductTitle(title: string): {
  advisoryNumber: string;
  product: TropicalCycloneProduct;
  stormId: string;
} | null {
  const match = title.match(
    /^Advisory #(\d{1,3}[A-Z]?) (Forecast Track|Cone of Uncertainty|Watches\/Warnings) \[(?:kmz|kml)\] - .+ \([^/]+\/([A-Za-z]{2}\d{6})\)$/i
  );
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const product: TropicalCycloneProduct =
    match[2] === 'Forecast Track'
      ? 'track'
      : match[2] === 'Cone of Uncertainty'
        ? 'cone'
        : 'watch_warning';
  return { advisoryNumber: match[1].toUpperCase(), product, stormId: match[3].toUpperCase() };
}

/** Parses the documented bounded RSS item shape without resolving XML entities or links. */
export function parseNhcGisIndex(xml: string, basin: TropicalCycloneBasin): AdvisoryAsset[] {
  assertPassiveXml(xml);
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  if (items.length > NHC_INDEX_MAX_ITEMS) throw new Error('NHC index exceeds the item ceiling');
  const summaries = new Map<string, StormSummary>();
  for (const item of items) {
    const summary = parseSummary(item);
    if (summary) summaries.set(summary.stormId, summary);
  }

  const assets: AdvisoryAsset[] = [];
  for (const item of items) {
    const title = readTag(item, 'title');
    const parsedTitle = title ? parseProductTitle(title) : null;
    if (!parsedTitle) continue;
    const storm = summaries.get(parsedTitle.stormId);
    const link = readTag(item, 'link');
    const guid = readTag(item, 'guid');
    const pubDate = readTag(item, 'pubDate');
    if (!storm || !link || !guid || !pubDate) throw new Error('NHC advisory item is incomplete');
    const assetUrl = new URL(link);
    if (
      assetUrl.protocol !== 'https:' ||
      assetUrl.hostname !== NHC_HOST ||
      !assetUrl.pathname.startsWith('/gis/') ||
      !/\.(?:kmz|kml)$/i.test(assetUrl.pathname) ||
      assetUrl.username ||
      assetUrl.password ||
      assetUrl.port
    ) {
      throw new Error('NHC advisory asset is outside the fixed same-origin GIS boundary');
    }
    assets.push({
      id: guid,
      basin,
      storm,
      advisoryNumber: parsedTitle.advisoryNumber,
      product: parsedTitle.product,
      issuedAt: normalizeIsoTime(pubDate, 'NHC advisory issue time'),
      url: assetUrl.href,
    });
  }
  return assets;
}

function kmlData(kml: string, name: string): string | null {
  const escapedName = escapeRegExp(name);
  const match = kml.match(
    new RegExp(
      `<Data\\s+name=["']${escapedName}["'][^>]*>[\\s\\S]*?<value>([\\s\\S]*?)<\\/value>[\\s\\S]*?<\\/Data>`,
      'i'
    )
  );
  return match?.[1] ? decodeXml(match[1]) : null;
}

function coordinateList(value: string): Array<[number, number]> {
  return value
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(',').map(Number))
    .map(
      ([longitude, latitude]) =>
        [longitude ?? Number.NaN, latitude ?? Number.NaN] as [number, number]
    )
    .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));
}

function readKmlCoordinates(kml: string, geometryTag: 'LineString' | 'Polygon') {
  const block = kml.match(new RegExp(`<${geometryTag}\\b[\\s\\S]*?<\\/${geometryTag}>`, 'i'))?.[0];
  const coordinates = block ? readTag(block, 'coordinates') : null;
  return coordinates ? coordinateList(coordinates) : [];
}

function closeRing(coordinates: Array<[number, number]>): Array<[number, number]> {
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coordinates.push([...first]);
  return coordinates;
}

function parseKmlAsset(asset: AdvisoryAsset, kml: string): TropicalCycloneAdvisory {
  assertPassiveXml(kml);
  const issuedAt = normalizeIsoTime(
    kmlData(kml, 'issued_at') ?? asset.issuedAt,
    'NHC KML issue time'
  );
  const observationTime = normalizeIsoTime(
    kmlData(kml, 'observation_time') ?? asset.storm.observedAt,
    'NHC KML observation time'
  );
  const validFrom = normalizeIsoTime(kmlData(kml, 'valid_from') ?? issuedAt, 'NHC validity start');
  const defaultValidTo = new Date(Date.parse(issuedAt) + NHC_MAX_STALE_MS).toISOString();
  const validTo = normalizeIsoTime(kmlData(kml, 'valid_to') ?? defaultValidTo, 'NHC validity end');
  const lineCoordinates = readKmlCoordinates(kml, 'LineString');
  const geometry =
    asset.product === 'cone'
      ? { type: 'Polygon' as const, coordinates: [closeRing(readKmlCoordinates(kml, 'Polygon'))] }
      : { type: 'LineString' as const, coordinates: lineCoordinates };
  const forecastTimes = (kmlData(kml, 'forecast_times') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const forecastPoints =
    asset.product === 'track'
      ? lineCoordinates.map(([longitude, latitude], index) => ({
          position: { longitude, latitude },
          valid_at: forecastTimes[index]
            ? normalizeIsoTime(forecastTimes[index], 'NHC forecast point time')
            : null,
        }))
      : [];
  return {
    id: asset.id,
    storm_id: asset.storm.stormId,
    storm_name: asset.storm.name,
    storm_type: asset.storm.stormType,
    basin: asset.basin,
    advisory_number: asset.advisoryNumber,
    product: asset.product,
    issued_at: issuedAt,
    observation_time: observationTime,
    valid_from: validFrom,
    valid_to: validTo,
    geometry,
    forecast_points: forecastPoints,
    warning_type:
      asset.product === 'watch_warning' ? (kmlData(kml, 'warning_type') ?? 'WATCH/WARNING') : null,
  };
}

function advisoryIntersectsAoi(advisory: TropicalCycloneAdvisory, aoi: OperationalAoi): boolean {
  if (advisory.geometry.type !== 'LineString') return geometryIntersectsAoi(advisory.geometry, aoi);
  return advisory.geometry.coordinates.some(
    ([longitude, latitude]) =>
      longitude >= aoi.min_lon &&
      longitude <= aoi.max_lon &&
      latitude >= aoi.min_lat &&
      latitude <= aoi.max_lat
  );
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        const item = items[index];
        if (item !== undefined) results[index] = await task(item);
      }
    })
  );
  return results;
}

export class TropicalCycloneAdapter {
  private readonly clock: SimClock;
  private readonly seedMode: boolean;
  private readonly enabled: boolean;
  private readonly liveAccessEnabled: boolean;
  private readonly termsApproved: boolean;
  private readonly userAgent?: string;
  private readonly seedFixturePath: string;
  private readonly fetcher: OperationalFetcher;
  private readonly inFlight = new Map<string, Promise<TropicalCycloneResponse>>();

  constructor(options: TropicalCycloneAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    const envLive = process.env.GEV_LIVE_MODE === '1' && process.env.GEV_SEED_MODE !== '1';
    this.seedMode = options.seedMode ?? !envLive;
    this.enabled = options.enabled ?? process.env.GEV_NHC_TROPICAL_CYCLONES_ENABLED !== '0';
    this.liveAccessEnabled = options.liveAccessEnabled ?? process.env.GEV_NHC_LIVE_ACCESS === '1';
    this.termsApproved = options.termsApproved ?? process.env.GEV_NHC_TERMS_APPROVED === '1';
    this.userAgent = options.userAgent ?? process.env.GEV_NHC_USER_AGENT;
    this.seedFixturePath =
      options.seedFixturePath ?? resolveFixturePath('nhc-advisories-synthetic-v1.json');
    this.fetcher = options.fetcher ?? defaultOperationalFetcher;
  }

  async getAdvisories(input: OperationalAoi): Promise<TropicalCycloneResponse> {
    if (!this.enabled)
      throw new OperationalSourceError(
        'PROVIDER_DISABLED',
        'NHC tropical cyclones are disabled by policy'
      );
    const aoi = OperationalAoiSchema.parse(input);
    const key = normalizedAoiKey(aoi);
    const active = this.inFlight.get(key);
    if (active) return active;
    const pending = this.load(aoi).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  private async load(aoi: OperationalAoi): Promise<TropicalCycloneResponse> {
    try {
      const source = this.seedMode ? await this.readSeed() : await this.readLive();
      const now = this.clock.now();
      const advisories = source.advisories.filter(
        (advisory) =>
          Date.parse(advisory.valid_from) <= now &&
          Date.parse(advisory.valid_to) > now &&
          advisoryIntersectsAoi(advisory, aoi)
      );
      const observationTimes = advisories.map((item) => item.observation_time).sort();
      return TropicalCycloneResponseSchema.parse({
        retrieved_at: this.clock.iso(),
        count: advisories.length,
        advisories,
        usage_notice: NHC_USAGE_NOTICE,
        provenance: createDataProvenance({
          providerId: 'noaa-national-hurricane-center',
          feedId: 'tropical-cyclone-advisories',
          clock: this.clock,
          sourceMode: this.seedMode ? 'seed' : 'live',
          observationPeriod: observationTimes.length
            ? {
                status: 'available',
                start: observationTimes[0] as string,
                end: observationTimes.at(-1) as string,
              }
            : unavailableObservationPeriod('No current NHC/CPHC advisories intersect the AOI'),
          ...(this.seedMode ? { fixtureId: 'nhc-advisories-synthetic-v1' } : {}),
        }),
      });
    } catch (error) {
      if (error instanceof OperationalSourceError) throw error;
      throw new OperationalSourceError(
        'UPSTREAM_CONTRACT_ERROR',
        'NHC advisory response failed bounded validation',
        502
      );
    }
  }

  private async readSeed(): Promise<{ advisories: TropicalCycloneAdvisory[] }> {
    const fixture = SeedFixtureSchema.parse(
      JSON.parse(await fs.promises.readFile(this.seedFixturePath, 'utf8'))
    );
    const assets = fixture.indexes.flatMap(({ basin, xml }) => parseNhcGisIndex(xml, basin));
    return {
      advisories: assets.map((asset) => {
        const kml = fixture.assets[new URL(asset.url).pathname];
        if (!kml) throw new Error(`Missing synthetic NHC asset ${new URL(asset.url).pathname}`);
        return parseKmlAsset(asset, kml);
      }),
    };
  }

  private async readLive(): Promise<{ advisories: TropicalCycloneAdvisory[] }> {
    if (!this.liveAccessEnabled || !this.termsApproved) {
      throw new OperationalSourceError(
        'TERMS_APPROVAL_REQUIRED',
        'Live NHC advisories require recorded terms approval and explicit live access',
        423
      );
    }
    const userAgent = assertIdentifiedUserAgent(this.userAgent, false);
    const indexes = await mapConcurrent(BASINS, 2, async (basin) => {
      const response = await this.fetcher(BASIN_ENDPOINTS[basin], {
        timeoutMs: 10_000,
        maxBytes: NHC_INDEX_MAX_BYTES,
        allowedHosts: [NHC_HOST],
        allowedPaths: [
          {
            host: NHC_HOST,
            pathPrefix: `/gis-${basin === 'atlantic' ? 'at' : basin === 'eastern_pacific' ? 'ep' : 'cp'}.xml`,
          },
        ],
        headers: { Accept: 'application/rss+xml, application/xml', 'User-Agent': userAgent },
      });
      return parseNhcGisIndex(await readBoundedText(response, NHC_INDEX_MAX_BYTES), basin);
    });
    const assets = indexes.flat().slice(0, NHC_INDEX_MAX_ITEMS);
    const advisories = await mapConcurrent(assets, 2, async (asset) => {
      const response = await this.fetcher(asset.url, {
        timeoutMs: 10_000,
        maxBytes: NHC_ASSET_MAX_BYTES,
        allowedHosts: [NHC_HOST],
        allowedPaths: [{ host: NHC_HOST, pathPrefix: '/gis/' }],
        headers: {
          Accept: 'application/vnd.google-earth.kmz, application/vnd.google-earth.kml+xml',
          'User-Agent': userAgent,
        },
      });
      const bytes = await readBoundedBytes(response, NHC_ASSET_MAX_BYTES);
      const kml = new URL(asset.url).pathname.toLowerCase().endsWith('.kmz')
        ? extractBoundedKmlFromKmz(bytes)
        : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return parseKmlAsset(asset, kml);
    });
    return { advisories };
  }
}
