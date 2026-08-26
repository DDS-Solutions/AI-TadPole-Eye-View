import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  destinationPoint,
  finalBearing,
  haversineDistance,
  initialBearing,
  midpoint,
  normalizeLatitude,
  normalizeLongitude,
} from '../src/geoMath.js';

describe('GeoMath Property & Invariant Tests', () => {
  const arbitraryLat = fc.double({ min: -89.9, max: 89.9, noNaN: true });
  const arbitraryLon = fc.double({ min: -179.9, max: 179.9, noNaN: true });
  const arbitraryDistance = fc.double({ min: 100, max: 5000000, noNaN: true });
  const arbitraryBearing = fc.double({ min: 0, max: 359.99, noNaN: true });

  it('preserves distance symmetry: dist(A, B) === dist(B, A)', () => {
    fc.assert(
      fc.property(
        arbitraryLat,
        arbitraryLon,
        arbitraryLat,
        arbitraryLon,
        (lat1, lon1, lat2, lon2) => {
          const d1 = haversineDistance(lat1, lon1, lat2, lon2);
          const d2 = haversineDistance(lat2, lon2, lat1, lon1);
          expect(Math.abs(d1 - d2)).toBeLessThanOrEqual(1e-4);
        }
      )
    );
  });

  it('satisfies the triangle inequality: dist(A, C) <= dist(A, B) + dist(B, C) + epsilon', () => {
    fc.assert(
      fc.property(
        arbitraryLat,
        arbitraryLon,
        arbitraryLat,
        arbitraryLon,
        arbitraryLat,
        arbitraryLon,
        (latA, lonA, latB, lonB, latC, lonC) => {
          const dAC = haversineDistance(latA, lonA, latC, lonC);
          const dAB = haversineDistance(latA, lonA, latB, lonB);
          const dBC = haversineDistance(latB, lonB, latC, lonC);
          expect(dAC).toBeLessThanOrEqual(dAB + dBC + 1.0);
        }
      )
    );
  });

  it('keeps bearings strictly within [0, 360) degrees', () => {
    fc.assert(
      fc.property(
        arbitraryLat,
        arbitraryLon,
        arbitraryLat,
        arbitraryLon,
        (lat1, lon1, lat2, lon2) => {
          const initB = initialBearing(lat1, lon1, lat2, lon2);
          const finB = finalBearing(lat1, lon1, lat2, lon2);
          expect(initB).toBeGreaterThanOrEqual(0);
          expect(initB).toBeLessThan(360);
          expect(finB).toBeGreaterThanOrEqual(0);
          expect(finB).toBeLessThan(360);
        }
      )
    );
  });

  it('performs destination point round-trips: go(d, θ) then return on initialBearing(dest→origin) returns origin within < 1m', () => {
    fc.assert(
      fc.property(
        arbitraryLat,
        arbitraryLon,
        arbitraryDistance,
        arbitraryBearing,
        (lat, lon, dist, bearing) => {
          const dest = destinationPoint(lat, lon, dist, bearing);
          const returnBearing = initialBearing(dest.latitude, dest.longitude, lat, lon);
          const origin = destinationPoint(dest.latitude, dest.longitude, dist, returnBearing);

          const errorMeters = haversineDistance(lat, lon, origin.latitude, origin.longitude);
          expect(errorMeters).toBeLessThan(1.0); // Within 1 meter tolerance across full distance domain
        }
      ),
      { numRuns: 300 }
    );
  });

  it('demonstrates that the return bearing on a sphere is NOT simply (bearing + 180) at high latitude (P2 worked example)', () => {
    // 100 km due east from (60°N, 0°E)
    const lat = 60.0;
    const lon = 0.0;
    const dist = 100000;
    const bearing = 90.0;

    const dest = destinationPoint(lat, lon, dist, bearing);

    // Initial bearing from dest back to origin differs from naive (90 + 180) = 270°
    const trueReturnBearing = initialBearing(dest.latitude, dest.longitude, lat, lon);
    const naiveReturnBearing = 270.0;

    expect(Math.abs(trueReturnBearing - naiveReturnBearing)).toBeGreaterThan(0.5);

    // Naive return lands ~2-3 km away from origin due to convergence of meridians
    const naiveOrigin = destinationPoint(dest.latitude, dest.longitude, dist, naiveReturnBearing);
    const naiveErrorMeters = haversineDistance(
      lat,
      lon,
      naiveOrigin.latitude,
      naiveOrigin.longitude
    );
    expect(naiveErrorMeters).toBeGreaterThan(500); // 500m+ error

    // True spherical return bearing lands within < 1m of origin
    const trueOrigin = destinationPoint(dest.latitude, dest.longitude, dist, trueReturnBearing);
    const trueErrorMeters = haversineDistance(lat, lon, trueOrigin.latitude, trueOrigin.longitude);
    expect(trueErrorMeters).toBeLessThan(1.0);
  });

  it('correctly calculates short distances across the anti-meridian / dateline', () => {
    // 179°E to 179°W at equator is 2° longitude (~222 km), NOT 358° (~39,800 km)
    const datelineDistance = haversineDistance(0, 179, 0, -179);
    expect(datelineDistance).toBeLessThan(250000);
    expect(datelineDistance).toBeGreaterThan(200000);
  });

  it('demonstrates coordinate normalization idempotency', () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (lon) => {
        const n1 = normalizeLongitude(lon);
        const n2 = normalizeLongitude(n1);
        expect(n1).toBeCloseTo(n2, 8);
        expect(n1).toBeGreaterThanOrEqual(-180);
        expect(n1).toBeLessThan(180);
      })
    );
  });
});
