import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { WeatherAdapter } from '../src/weather.js';

describe('WeatherAdapter (PLAN.md §8 Layer 9)', () => {
  const clock = new FrozenClock(1724580000000);

  it('parses weather radar frames and meteorological observations', async () => {
    const adapter = new WeatherAdapter({ clock });
    const weather = await adapter.getWeather();

    expect(weather.count).toBe(4);
    expect(weather.radar_frames.length).toBe(3);
    expect(weather.radar_tile_template).toContain('rainviewer.com');

    const ksfo = weather.stations.find((s) => s.id === 'wx-ksfo');
    expect(ksfo).toBeDefined();
    expect(ksfo?.temp_c).toBe(17.5);
    expect(ksfo?.condition).toBe('Partly Cloudy');
  });
});
