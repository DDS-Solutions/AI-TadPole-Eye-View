export function getFlightTimeSeries(data: Record<string, unknown>): [number[], number[], number[]] {
  const altitude = Number(data.baro_altitude ?? data.geo_altitude ?? 8_000);
  const velocity = Number(data.velocity ?? 220);
  const verticalRate = Number(data.vertical_rate ?? 0);
  const timestamps = [0, 10, 20, 30, 40, 50, 60];
  const altitudes = timestamps.map((time) =>
    Math.max(0, altitude - (60 - time) * (verticalRate || 2))
  );
  const velocities = timestamps.map((time) => Math.max(0, velocity + Math.sin(time / 10) * 5));
  return [timestamps, altitudes, velocities];
}

export function getLaunchTimeSeries(
  trajectory: Array<{ time_offset_sec: number; altitude_m: number; velocity_ms: number }>
): [number[], number[], number[]] {
  return [
    trajectory.map((point) => point.time_offset_sec),
    trajectory.map((point) => point.altitude_m / 1_000),
    trajectory.map((point) => point.velocity_ms),
  ];
}

export function getWeatherTimeSeries(
  data: Record<string, unknown>
): [number[], number[], number[]] {
  const baseTemperature = Number(data.temp_c ?? 18);
  const baseWind = Number(data.wind_speed_kmh ?? 15);
  const hours = [0, 2, 4, 6, 8, 10, 12];
  return [
    hours,
    hours.map((hour) => Number((baseTemperature + Math.sin(hour / 2) * 3).toFixed(1))),
    hours.map((hour) => Number(Math.max(0, baseWind + Math.cos(hour / 2) * 4).toFixed(1))),
  ];
}
