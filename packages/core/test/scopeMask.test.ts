import { describe, expect, it } from 'vitest';
import {
  isPointInPolygon,
  isWithinAzimuthCone,
  isWithinElevationMask,
  isWithinRadius,
} from '../src/scopeMask.js';

describe('Scope Mask & Spatial Filtering', () => {
  describe('isWithinRadius', () => {
    it('detects targets within radial threshold', () => {
      // Points ~111km apart (1 degree latitude)
      expect(isWithinRadius(0, 0, 1, 0, 120000)).toBe(true);
      expect(isWithinRadius(0, 0, 1, 0, 100000)).toBe(false);
    });
  });

  describe('isWithinAzimuthCone', () => {
    it('includes targets centered along heading', () => {
      // Center at equator, target is due north (bearing 0)
      expect(isWithinAzimuthCone(0, 0, 0, 60, 10, 0)).toBe(true);
      // Target is due south (bearing 180), heading is north (0) with 60 deg cone
      expect(isWithinAzimuthCone(0, 0, 0, 60, -10, 0)).toBe(false);
    });

    it('respects inclusive vs exclusive boundary semantics', () => {
      // Heading 0, FOV 60 => boundary is at exactly 30 degrees azimuth
      // Center (0,0), target at bearing 90 (due east) with 180° cone => boundary is exactly 90
      const centerLat = 0;
      const centerLon = 0;
      const targetLat = 0;
      const targetLon = 10; // due east, bearing 90

      // 180 deg FOV with heading 0 means bounds are [-90, +90]
      expect(isWithinAzimuthCone(centerLat, centerLon, 0, 180, targetLat, targetLon, true)).toBe(
        true
      );
      expect(isWithinAzimuthCone(centerLat, centerLon, 0, 180, targetLat, targetLon, false)).toBe(
        false
      );
    });
  });

  describe('isWithinElevationMask', () => {
    it('filters based on minimum and maximum elevation angles', () => {
      // 10km slant range, 5km altitude delta -> asin(0.5) = 30 deg
      expect(isWithinElevationMask(10000, 5000, 10, 45)).toBe(true);
      expect(isWithinElevationMask(10000, 5000, 35, 60)).toBe(false);
    });
  });

  describe('isPointInPolygon', () => {
    const square = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 10, longitude: 10 },
      { latitude: 10, longitude: 0 },
    ];

    it('identifies points strictly inside and outside polygon boundaries', () => {
      expect(isPointInPolygon(5, 5, square)).toBe(true);
      expect(isPointInPolygon(15, 15, square)).toBe(false);
      expect(isPointInPolygon(-5, 5, square)).toBe(false);
    });
  });
});
