import { describe, expect, it } from 'vitest';
import {
  OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG,
  OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS,
  OSM_ODBL_ATTRIBUTION,
  OSM_ODBL_LEGAL_DISCLAIMER,
  OSM_ODBL_LICENSE_ID,
  OsmCommercialBoundingBoxSchema,
  OsmCommercialCategorySchema,
  OsmCommercialEnrichmentResponseSchema,
  OsmCommercialFootprintSummarySchema,
  OsmCommercialPoiFeatureSchema,
  OsmCommercialQuerySchema,
} from '../src/index.js';

describe('OpenStreetMap Commercial Contracts (PLAN.md §10 Task 9.3 & OQ-5)', () => {
  it('validates commercial category enum values', () => {
    const validCategories = [
      'food_and_beverage',
      'retail',
      'services',
      'office',
      'craft_industrial',
      'healthcare',
      'hospitality',
      'other_commercial',
    ];
    for (const cat of validCategories) {
      expect(OsmCommercialCategorySchema.parse(cat)).toBe(cat);
    }
    expect(() => OsmCommercialCategorySchema.parse('residential')).toThrow();
    expect(() => OsmCommercialCategorySchema.parse('military')).toThrow();
  });

  it('validates bounding box constraints and enforces maximum span limits', () => {
    const validBbox = {
      min_lat: 30.25,
      min_lon: -97.76,
      max_lat: 30.28,
      max_lon: -97.73,
      name: 'Austin Downtown',
    };
    expect(OsmCommercialBoundingBoxSchema.parse(validBbox)).toEqual(validBbox);

    // Inverted latitude (min_lat > max_lat) fails
    expect(() =>
      OsmCommercialBoundingBoxSchema.parse({
        min_lat: 35.0,
        min_lon: -97.0,
        max_lat: 30.0,
        max_lon: -96.0,
      })
    ).toThrow(/min_lat must not exceed max_lat/);

    // Inverted longitude (min_lon > max_lon) fails
    expect(() =>
      OsmCommercialBoundingBoxSchema.parse({
        min_lat: 30.0,
        min_lon: -90.0,
        max_lat: 30.1,
        max_lon: -95.0,
      })
    ).toThrow(/min_lon must not exceed max_lon/);

    // Exceeding maximum span limit (0.5°) fails
    expect(() =>
      OsmCommercialBoundingBoxSchema.parse({
        min_lat: 30.0,
        min_lon: -97.0,
        max_lat: 30.0 + OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG + 0.1,
        max_lon: -96.8,
      })
    ).toThrow(/Latitude span/);

    expect(() =>
      OsmCommercialBoundingBoxSchema.parse({
        min_lat: 30.0,
        min_lon: -97.0,
        max_lat: 30.1,
        max_lon: -97.0 + OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG + 0.1,
      })
    ).toThrow(/Longitude span/);
  });

  it('validates commercial query schema', () => {
    const query = {
      bbox: {
        min_lat: 30.25,
        min_lon: -97.76,
        max_lat: 30.28,
        max_lon: -97.73,
      },
      categories: ['food_and_beverage', 'retail'],
      search_term: 'coffee',
    };
    expect(OsmCommercialQuerySchema.parse(query)).toEqual(query);
  });

  it('validates commercial POI feature schema', () => {
    const poi = {
      id: 20001,
      type: 'node',
      lat: 30.2672,
      lon: -97.7431,
      name: 'Whole Harvest Market',
      category: 'retail',
      primary_tag: 'shop=supermarket',
      tags: {
        shop: 'supermarket',
        brand: 'Whole Harvest',
        name: 'Whole Harvest Market',
      },
      brand: 'Whole Harvest',
    };
    expect(OsmCommercialPoiFeatureSchema.parse(poi)).toEqual(poi);

    // Missing name fails
    expect(() =>
      OsmCommercialPoiFeatureSchema.parse({
        ...poi,
        name: '',
      })
    ).toThrow();
  });

  it('validates footprint summary metrics', () => {
    const summary = {
      total_features: 42,
      category_counts: {
        food_and_beverage: 20,
        retail: 12,
        services: 5,
        office: 3,
        craft_industrial: 1,
        healthcare: 1,
        hospitality: 0,
        other_commercial: 0,
      },
      density_per_km2: 14.5,
      area_km2: 2.89,
      top_amenities: [
        { tag: 'amenity=cafe', count: 12 },
        { tag: 'shop=supermarket', count: 5 },
      ],
    };
    expect(OsmCommercialFootprintSummarySchema.parse(summary)).toEqual(summary);
  });

  it('validates full enrichment response envelope with mandatory ODbL attribution notice', () => {
    const validResponse = {
      query: {
        bbox: {
          min_lat: 30.25,
          min_lon: -97.76,
          max_lat: 30.28,
          max_lon: -97.73,
        },
      },
      features: [
        {
          id: 20002,
          type: 'node',
          lat: 30.2685,
          lon: -97.7418,
          name: 'Congress Avenue Coffee',
          category: 'food_and_beverage',
          primary_tag: 'amenity=cafe',
          tags: {
            amenity: 'cafe',
            name: 'Congress Avenue Coffee',
            cuisine: 'coffee_shop',
          },
          cuisine: 'coffee_shop',
        },
      ],
      summary: {
        total_features: 1,
        category_counts: {
          food_and_beverage: 1,
          retail: 0,
          services: 0,
          office: 0,
          craft_industrial: 0,
          healthcare: 0,
          hospitality: 0,
          other_commercial: 0,
        },
        density_per_km2: 0.35,
        area_km2: 2.89,
        top_amenities: [{ tag: 'amenity=cafe', count: 1 }],
      },
      evidence_records: [],
      provenance: {
        schema_version: 1,
        source: {
          provider_id: 'osm-commercial',
          feed_id: 'overpass-commercial-poi',
          name: 'OpenStreetMap Commercial & Amenity Infrastructure',
          canonical_url: 'https://www.openstreetmap.org/',
        },
        retrieved_at: '2026-09-21T12:00:00.000Z',
        observation_period: {
          status: 'available',
          start: '2026-09-21T00:00:00.000Z',
          end: '2026-09-21T12:00:00.000Z',
        },
        vintage: {
          status: 'available',
          value: 'OSM Planet 2026-09-21 via Overpass QL',
        },
        mode: 'seed',
        source_mode: 'seed',
        license: {
          id: OSM_ODBL_LICENSE_ID,
          name: 'Open Database License (ODbL) 1.0',
        },
        attribution: OSM_ODBL_ATTRIBUTION,
        fixture_id: 'osm-commercial-synthetic-v1',
        cache: null,
        freshness: {
          status: 'fresh',
          age_seconds: 0,
          fresh_for_seconds: 86400,
        },
      },
      disclaimer: OSM_ODBL_LEGAL_DISCLAIMER,
    };

    expect(OsmCommercialEnrichmentResponseSchema.parse(validResponse)).toBeDefined();

    // Missing OpenStreetMap in attribution fails closed
    const invalidAttribution = {
      ...validResponse,
      provenance: {
        ...validResponse.provenance,
        attribution: 'Proprietary Company All Rights Reserved',
      },
    };
    expect(() => OsmCommercialEnrichmentResponseSchema.parse(invalidAttribution)).toThrow(
      /explicit OpenStreetMap attribution/
    );

    // Invalid license fails closed
    const invalidLicense = {
      ...validResponse,
      provenance: {
        ...validResponse.provenance,
        license: { id: 'mit', name: 'MIT License' },
      },
    };
    expect(() => OsmCommercialEnrichmentResponseSchema.parse(invalidLicense)).toThrow(
      /must cite ODbL license/
    );
  });

  it('proves whitelisted primary tags and constants match expectations', () => {
    expect(OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS).toContain('amenity');
    expect(OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS).toContain('shop');
    expect(OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS).toContain('craft');
    expect(OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS).toContain('office');
    expect(OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS).toContain('commercial');
    expect(OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS).toContain('tourism');
    expect(OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS).toContain('healthcare');
  });
});
