import { z } from 'zod';

export const CameraPose = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  altitude: z.number().nonnegative(),
  heading: z.number().min(0).max(360),
  pitch: z.number().min(-90).max(90),
  roll: z.number().min(-180).max(180).default(0),
});
export type CameraPose = z.infer<typeof CameraPose>;

export const LayerState = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  opacity: z.number().min(0).max(1).default(1),
});
export type LayerState = z.infer<typeof LayerState>;

export const SelectedEntity = z
  .object({
    kind: z.enum(['aircraft', 'ship', 'satellite', 'quake', 'fire', 'cctv', 'radio']),
    id: z.string().min(1),
  })
  .nullable();
export type SelectedEntity = z.infer<typeof SelectedEntity>;

export const AreaOfInterest = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  coordinates: z
    .array(
      z.object({
        longitude: z.number().min(-180).max(180),
        latitude: z.number().min(-90).max(90),
      })
    )
    .min(3),
});
export type AreaOfInterest = z.infer<typeof AreaOfInterest>;

export const SimTimeState = z.object({
  iso: z.string().datetime(),
  rate: z.number().default(1),
  paused: z.boolean().default(false),
});
export type SimTimeState = z.infer<typeof SimTimeState>;

/**
 * Complete serialized globe scene state.
 * Used for deep links, deterministic test fixtures, bug reports, and multiplayer sync.
 */
export const SceneState = z.object({
  version: z.literal('1.0.0'),
  created_at: z.string().datetime(),
  camera: CameraPose,
  layers: z.array(LayerState),
  selected_entity: SelectedEntity.default(null),
  aois: z.array(AreaOfInterest).default([]),
  sim_time: SimTimeState,
});
export type SceneState = z.infer<typeof SceneState>;
