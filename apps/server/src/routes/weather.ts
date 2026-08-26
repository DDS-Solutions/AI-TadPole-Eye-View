import { WeatherAdapter } from '@gev/providers';
import { Hono } from 'hono';

export interface WeatherRouteOptions {
  adapter?: WeatherAdapter;
}

export function createWeatherRouter(options: WeatherRouteOptions = {}) {
  const router = new Hono();
  const adapter = options.adapter ?? new WeatherAdapter();

  router.get('/radar', async (c) => {
    try {
      const weather = await adapter.getWeather();
      return c.json(weather);
    } catch (err: unknown) {
      return c.json(
        {
          error: 'Failed to fetch weather radar catalog',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
        500
      );
    }
  });

  return router;
}
