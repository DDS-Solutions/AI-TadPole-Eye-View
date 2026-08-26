import { z } from 'zod';
import { CameraPose } from './scene.js';

export const RoomRoleSchema = z.enum(['viewer', 'operator', 'ai_copilot']);
export type RoomRole = z.infer<typeof RoomRoleSchema>;

export const RoomTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  callsign: z.string().min(1),
  roomId: z.string().min(1),
  role: RoomRoleSchema,
  exp: z.number().int().positive(),
  iat: z.number().int().positive(),
});
export type RoomTokenPayload = z.infer<typeof RoomTokenPayloadSchema>;

export const GeoCursorSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  altitude_m: z.number().finite().optional(),
});
export type GeoCursor = z.infer<typeof GeoCursorSchema>;

export const EntityReferenceSchema = z.object({
  layer: z.string().min(1),
  id: z.string().min(1),
});
export type EntityReference = z.infer<typeof EntityReferenceSchema>;

export const UserPresenceSchema = z.object({
  clientId: z.string().min(1),
  callsign: z.string().min(1),
  role: RoomRoleSchema,
  color: z.string().default('#00f0ff'),
  cursor: GeoCursorSchema.optional(),
  camera: CameraPose.optional(),
  selectedEntity: EntityReferenceSchema.nullable().optional(),
  lastSeenTs: z.number().finite(),
});
export type UserPresence = z.infer<typeof UserPresenceSchema>;

export const AoiAnnotationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]), // [south, west, north, east]
  createdBy: z.string(),
  createdAtTs: z.number().finite(),
});
export type AoiAnnotation = z.infer<typeof AoiAnnotationSchema>;

export const RoomIntentStateSchema = z.object({
  roomId: z.string().min(1),
  selectedEntity: EntityReferenceSchema.nullable().default(null),
  activeLayers: z.record(z.boolean()).default({}),
  aois: z.array(AoiAnnotationSchema).default([]),
  followLeaderId: z.string().nullable().default(null),
  simTimeOffsetSec: z.number().finite().default(0),
});
export type RoomIntentState = z.infer<typeof RoomIntentStateSchema>;

export const RoomJoinRequestSchema = z.object({
  roomId: z.string().min(1).default('main-ops-room'),
  callsign: z.string().min(1).default('Operator-1'),
  role: RoomRoleSchema.default('operator'),
});
export type RoomJoinRequest = z.infer<typeof RoomJoinRequestSchema>;

export const RoomJoinResponseSchema = z.object({
  roomId: z.string(),
  roomToken: z.string(),
  wsUrl: z.string(),
  expiresAt: z.number().finite(),
  initialState: RoomIntentStateSchema,
});
export type RoomJoinResponse = z.infer<typeof RoomJoinResponseSchema>;
