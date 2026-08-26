import { z } from 'zod';

export const LaunchStatus = z.enum(['success', 'in_flight', 'failed', 'simulated']);
export type LaunchStatus = z.infer<typeof LaunchStatus>;

export const TrajectoryWaypoint = z.object({
  time_offset_sec: z.number().finite(),
  longitude: z.number().finite().min(-180).max(180),
  latitude: z.number().finite().min(-90).max(90),
  altitude_m: z.number().finite().nonnegative(),
  velocity_ms: z.number().finite().nonnegative(),
  stage: z.string().optional(),
});
export type TrajectoryWaypoint = z.infer<typeof TrajectoryWaypoint>;

export const LaunchMission = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().default('Unknown Provider'),
  vehicle: z.string().default('Rocket'),
  launch_site: z.string().default('Cape Canaveral, FL'),
  launch_timestamp: z.number().int().nonnegative(),
  target_orbit: z.string().default('LEO'),
  status: LaunchStatus.default('simulated'),
  apogee_km: z.number().finite().nonnegative().default(200),
  perigee_km: z.number().finite().nonnegative().default(180),
  inclination_deg: z.number().finite().default(51.6),
  trajectory: z.array(TrajectoryWaypoint).default([]),
  is_simulated: z.boolean().default(true),
});
export type LaunchMission = z.infer<typeof LaunchMission>;

export const LaunchCatalog = z.object({
  time: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  missions: z.array(LaunchMission),
});
export type LaunchCatalog = z.infer<typeof LaunchCatalog>;
