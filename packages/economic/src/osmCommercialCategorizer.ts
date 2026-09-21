import {
  type DataProvenance,
  type EconomicEvidenceRecord,
  type EconomicGeography,
  type OsmCommercialCategory,
  type OsmCommercialFootprintSummary,
  type OsmCommercialPoiFeature,
  type OsmCommercialTopAmenity,
  PromptProtectionError,
  type SandboxedDataBlock,
} from '@gev/contracts';
import { createSandboxedDataBlock, sanitizeUntrustedText } from './promptProtection.js';

export const ALL_COMMERCIAL_CATEGORIES: readonly OsmCommercialCategory[] = [
  'food_and_beverage',
  'retail',
  'services',
  'office',
  'craft_industrial',
  'healthcare',
  'hospitality',
  'other_commercial',
] as const;

/**
 * Pure domain categorization mapping raw OpenStreetMap tag key-values into
 * normalized commercial categories and primary tag identifiers.
 */
export function categorizeOsmTags(tags: Record<string, unknown>): {
  category: OsmCommercialCategory;
  primaryTag: string;
} {
  const amenity = typeof tags.amenity === 'string' ? tags.amenity.toLowerCase() : undefined;
  const shop = typeof tags.shop === 'string' ? tags.shop.toLowerCase() : undefined;
  const craft = typeof tags.craft === 'string' ? tags.craft.toLowerCase() : undefined;
  const office = typeof tags.office === 'string' ? tags.office.toLowerCase() : undefined;
  const commercial =
    typeof tags.commercial === 'string' ? tags.commercial.toLowerCase() : undefined;
  const tourism = typeof tags.tourism === 'string' ? tags.tourism.toLowerCase() : undefined;
  const healthcare =
    typeof tags.healthcare === 'string' ? tags.healthcare.toLowerCase() : undefined;

  // 1. Food & Beverage
  if (
    amenity &&
    /^(restaurant|cafe|bar|pub|fast_food|food_court|bistro|ice_cream|biergarten)$/.test(amenity)
  ) {
    return { category: 'food_and_beverage', primaryTag: `amenity=${amenity}` };
  }
  if (shop && /^(bakery|coffee|confectionery|deli|pastry)$/.test(shop)) {
    return { category: 'food_and_beverage', primaryTag: `shop=${shop}` };
  }

  // 2. Retail
  if (shop) {
    return { category: 'retail', primaryTag: `shop=${shop}` };
  }

  // 3. Services (Financial, Personal, Post, Automotive)
  if (
    amenity &&
    /^(bank|atm|post_office|dry_cleaning|hairdresser|car_wash|laundry|travel_agency)$/.test(amenity)
  ) {
    return { category: 'services', primaryTag: `amenity=${amenity}` };
  }

  // 4. Healthcare
  if (amenity && /^(pharmacy|clinic|dentist|hospital|doctors|optician)$/.test(amenity)) {
    return { category: 'healthcare', primaryTag: `amenity=${amenity}` };
  }
  if (healthcare) {
    return { category: 'healthcare', primaryTag: `healthcare=${healthcare}` };
  }

  // 5. Office
  if (office) {
    return { category: 'office', primaryTag: `office=${office}` };
  }
  if (commercial === 'office') {
    return { category: 'office', primaryTag: 'commercial=office' };
  }

  // 6. Craft & Light Industrial
  if (craft) {
    return { category: 'craft_industrial', primaryTag: `craft=${craft}` };
  }
  if (commercial === 'light_industrial') {
    return {
      category: 'craft_industrial',
      primaryTag: 'commercial=light_industrial',
    };
  }

  // 7. Hospitality
  if (tourism && /^(hotel|motel|hostel|guest_house|bed_and_breakfast)$/.test(tourism)) {
    return { category: 'hospitality', primaryTag: `tourism=${tourism}` };
  }

  // 8. Other Commercial fallback
  if (commercial) {
    return { category: 'other_commercial', primaryTag: `commercial=${commercial}` };
  }
  if (amenity) {
    return { category: 'other_commercial', primaryTag: `amenity=${amenity}` };
  }

  return { category: 'other_commercial', primaryTag: 'commercial=generic' };
}

export interface RawOsmElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, unknown>;
}

/**
 * Extracts and normalizes commercial POI features from raw Overpass elements.
 */
export function extractCommercialFeatures(
  elements: readonly RawOsmElement[]
): OsmCommercialPoiFeature[] {
  const features: OsmCommercialPoiFeature[] = [];

  for (const el of elements) {
    if (!el.tags || typeof el.tags !== 'object') {
      continue;
    }

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;

    if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    const { category, primaryTag } = categorizeOsmTags(el.tags);
    const rawName = typeof el.tags.name === 'string' ? el.tags.name.trim() : undefined;
    const name = rawName && rawName.length > 0 ? rawName : `Unnamed ${primaryTag}`;

    const normalizedTags: Record<string, string> = {};
    for (const [k, v] of Object.entries(el.tags)) {
      if (typeof v === 'string') {
        normalizedTags[k] = v;
      } else if (v !== null && v !== undefined) {
        normalizedTags[k] = String(v);
      }
    }

    const brand = typeof el.tags.brand === 'string' ? el.tags.brand.trim() : undefined;
    const operator = typeof el.tags.operator === 'string' ? el.tags.operator.trim() : undefined;
    const opening_hours =
      typeof el.tags.opening_hours === 'string' ? el.tags.opening_hours.trim() : undefined;
    const cuisine = typeof el.tags.cuisine === 'string' ? el.tags.cuisine.trim() : undefined;

    const feature: OsmCommercialPoiFeature = {
      id: el.id,
      type: el.type === 'way' ? 'way' : 'node',
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      name,
      category,
      primary_tag: primaryTag,
      tags: normalizedTags,
      brand: brand && brand.length > 0 ? brand : undefined,
      operator: operator && operator.length > 0 ? operator : undefined,
      opening_hours: opening_hours && opening_hours.length > 0 ? opening_hours : undefined,
      cuisine: cuisine && cuisine.length > 0 ? cuisine : undefined,
    };

    features.push(feature);
  }

  return features;
}

/**
 * Pure spherical surface area calculation for a bounding box in square kilometers.
 */
export function calculateBoundingBoxAreaKm2(bbox: {
  min_lat: number;
  min_lon: number;
  max_lat: number;
  max_lon: number;
}): number {
  const latMidRad = ((bbox.min_lat + bbox.max_lat) / 2) * (Math.PI / 180);
  const dLatKm = Math.abs(bbox.max_lat - bbox.min_lat) * 111.32;
  const dLonKm = Math.abs(bbox.max_lon - bbox.min_lon) * 111.32 * Math.cos(latMidRad);
  const area = dLatKm * dLonKm;
  return Math.max(0.0001, Number(area.toFixed(4)));
}

/**
 * Calculates commercial footprint summary metrics (total counts, category breakdown,
 * density per km2, top amenities) across extracted features.
 */
export function calculateOsmCommercialSummary(
  features: readonly OsmCommercialPoiFeature[],
  bbox: {
    min_lat: number;
    min_lon: number;
    max_lat: number;
    max_lon: number;
  }
): OsmCommercialFootprintSummary {
  const categoryCounts: Record<OsmCommercialCategory, number> = {
    food_and_beverage: 0,
    retail: 0,
    services: 0,
    office: 0,
    craft_industrial: 0,
    healthcare: 0,
    hospitality: 0,
    other_commercial: 0,
  };

  const tagCounts: Map<string, number> = new Map();

  for (const f of features) {
    categoryCounts[f.category] = (categoryCounts[f.category] ?? 0) + 1;
    tagCounts.set(f.primary_tag, (tagCounts.get(f.primary_tag) ?? 0) + 1);
  }

  const areaKm2 = calculateBoundingBoxAreaKm2(bbox);
  const density = Number((features.length / areaKm2).toFixed(2));

  const sortedAmenities: OsmCommercialTopAmenity[] = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    total_features: features.length,
    category_counts: categoryCounts,
    density_per_km2: density,
    area_km2: areaKm2,
    top_amenities: sortedAmenities,
  };
}

/**
 * Generates structured EconomicEvidenceRecord objects from commercial footprint metrics.
 */
export function generateOsmCommercialEvidenceRecords(
  summary: OsmCommercialFootprintSummary,
  bbox: {
    min_lat: number;
    min_lon: number;
    max_lat: number;
    max_lon: number;
    name?: string;
  },
  provenance: DataProvenance
): EconomicEvidenceRecord[] {
  const geography: EconomicGeography = {
    level: 'bounding_box',
    min_lat: bbox.min_lat,
    min_lon: bbox.min_lon,
    max_lat: bbox.max_lat,
    max_lon: bbox.max_lon,
    name: bbox.name ?? 'Commercial Extraction AOI',
  };

  const latPart = Math.abs(Math.round(bbox.min_lat * 100)).toString();
  const lonPart = Math.abs(Math.round(bbox.min_lon * 100)).toString();
  const safeAreaTag = `${latPart}-${lonPart}`;
  const records: EconomicEvidenceRecord[] = [];

  // 1. Total Commercial POI Density record
  records.push({
    evidence_id: `ev-osm-poi-density-${safeAreaTag}`,
    source_id: 'osm-commercial',
    metric_id: 'commercial-poi-density',
    variable_name: 'commercial_pois_per_km2',
    label: 'Commercial POI Density per km²',
    geography,
    estimate: {
      status: 'available',
      value: summary.density_per_km2,
      margin_of_error: null,
      confidence_level: null,
      sample_size: summary.total_features,
      unit: 'pois_per_km2',
      notes: 'Crowdsourced OpenStreetMap commercial amenity density',
    },
    provenance,
    tags: ['osm', 'commercial', 'density'],
  });

  // 2. Category specific counts
  for (const cat of ALL_COMMERCIAL_CATEGORIES) {
    const count = summary.category_counts[cat];
    if (count > 0) {
      records.push({
        evidence_id: `ev-osm-${cat.replace(/_/g, '-')}-count-${safeAreaTag}`,
        source_id: 'osm-commercial',
        metric_id: `${cat.replace(/_/g, '-')}-count`,
        variable_name: `category:${cat}`,
        label: `${cat.replace(/_/g, ' ').toUpperCase()} POI Count`,
        geography,
        estimate: {
          status: 'available',
          value: count,
          margin_of_error: null,
          confidence_level: null,
          sample_size: count,
          unit: 'establishment',
          notes: `Direct OpenStreetMap commercial ${cat} feature count`,
        },
        provenance,
        tags: ['osm', 'commercial', cat],
      });
    }
  }

  return records;
}

/**
 * Sandboxes an untrusted commercial feature for safe downstream LLM / Tadpole contexts
 * using ADR 0054 delimiter sandboxing and nonces.
 */
export function sanitizeOsmFeatureForPromptContext(
  feature: OsmCommercialPoiFeature,
  provenance: DataProvenance,
  nonce?: string
): SandboxedDataBlock {
  const content = JSON.stringify({
    id: feature.id,
    name: feature.name,
    category: feature.category,
    primary_tag: feature.primary_tag,
    brand: feature.brand,
    operator: feature.operator,
    cuisine: feature.cuisine,
    coordinates: { lat: feature.lat, lon: feature.lon },
  });

  return createSandboxedDataBlock({
    blockId: `osm-poi-${feature.id}`,
    sourceId: 'osm-commercial',
    label: `Commercial Feature: ${feature.name}`,
    content,
    provenance,
    nonce,
  });
}

/**
 * Asserts that untrusted OpenStreetMap text is free from prompt injection patterns
 * before entering an instruction context.
 */
export function assertOsmTextSafeForInstruction(text: string): void {
  const result = sanitizeUntrustedText(text, { mode: 'neutralize' });
  const activeThreats = (result.threats_detected ?? []).filter(
    (t) => t.category !== 'unicode_smuggling'
  );
  if (activeThreats.length > 0) {
    const first = activeThreats[0];
    throw new PromptProtectionError(
      'INJECTION_DETECTED',
      `Prompt injection threat detected in OpenStreetMap text: ${activeThreats.map((t) => t.category).join(', ')}`,
      first?.category
    );
  }
}
