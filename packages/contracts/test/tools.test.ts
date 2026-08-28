import { describe, expect, it } from 'vitest';
import {
  FlyToLocationInputSchema,
  InspectTelemetryInputSchema,
  OPERATOR_TOOLS,
  QueryAoiInputSchema,
  RoomIntentStateSchema,
  RoomJoinRequestSchema,
  RoomTokenPayloadSchema,
  SelectEntityInputSchema,
  SetSimTimeInputSchema,
  ToggleLayerInputSchema,
  UserPresenceSchema,
  getMcpToolDefinitions,
  getOpenAIToolDefinitions,
} from '../src/index.js';

describe('Phase 3 Tool & Collab Contracts (@gev/contracts)', () => {
  describe('OSINT Actuator & Query Schemas', () => {
    it('validates fly_to_location input bounds', () => {
      const valid = FlyToLocationInputSchema.parse({
        lat: 35.6762,
        lon: 139.6503,
        altitude_m: 25000,
        duration_s: 3,
      });
      expect(valid.lat).toBe(35.6762);
      expect(valid.altitude_m).toBe(25000);

      // Lat out of range
      expect(() => FlyToLocationInputSchema.parse({ lat: 105, lon: 0 })).toThrow();
    });

    it('validates toggle_layer input', () => {
      const valid = ToggleLayerInputSchema.parse({
        layer: 'flights',
        enabled: false,
      });
      expect(valid.layer).toBe('flights');
      expect(valid.enabled).toBe(false);

      expect(() => ToggleLayerInputSchema.parse({ layer: '', enabled: true })).toThrow();
    });

    it('validates select_entity and inspect_telemetry', () => {
      const sel = SelectEntityInputSchema.parse({
        layer: 'marine',
        id: 'vessel-987654',
        track_camera: true,
      });
      expect(sel.id).toBe('vessel-987654');

      const insp = InspectTelemetryInputSchema.parse({
        layer: 'quakes',
        id: 'us7000abcd',
      });
      expect(insp.layer).toBe('quakes');
    });

    it('validates query_aoi spatial bounds', () => {
      const aoi = QueryAoiInputSchema.parse({
        south: -10,
        west: 100,
        north: 10,
        east: 120,
        layers: ['flights', 'marine'],
      });
      expect(aoi.layers).toEqual(['flights', 'marine']);

      // Invalid latitude
      expect(() =>
        QueryAoiInputSchema.parse({
          south: -95,
          west: 0,
          north: 10,
          east: 20,
        })
      ).toThrow();
    });

    it('validates set_sim_time', () => {
      const sim = SetSimTimeInputSchema.parse({
        offset_s: -3600,
        playback_rate: 2,
      });
      expect(sim.offset_s).toBe(-3600);
      expect(sim.playback_rate).toBe(2);
    });
  });

  describe('OpenAI & MCP Tool Definition Generators', () => {
    it('generates compliant OpenAI Realtime / Chat function schemas', () => {
      const openAiTools = getOpenAIToolDefinitions();
      expect(openAiTools.length).toBe(Object.keys(OPERATOR_TOOLS).length);

      const flyTool = openAiTools.find((t) => t.function.name === 'fly_to_location');
      expect(flyTool).toBeDefined();
      expect(flyTool?.type).toBe('function');
      expect(flyTool?.function.description).toContain('[MUTATING]');

      const params = flyTool?.function.parameters as {
        type: string;
        properties: Record<
          string,
          { type: string; minimum?: number; maximum?: number; default?: unknown }
        >;
      };
      expect(params.type).toBe('object');
      expect(params.properties.lat).toBeDefined();
      expect(params.properties.lat.minimum).toBe(-90);
      expect(params.properties.lat.maximum).toBe(90);
      expect(params.properties.altitude_m.default).toBe(500000);
      expect(params.properties.duration_s.default).toBe(2);
    });

    it('projects filtered MCP input/output schemas and governance metadata from the registry', () => {
      const definitions = getMcpToolDefinitions(['get_budget', 'set_flag']);

      expect(definitions.map((definition) => definition.name)).toEqual(['get_budget', 'set_flag']);
      expect(definitions[1]).toMatchObject({
        inputSchema: {
          type: 'object',
          required: ['flag', 'enabled'],
          properties: {
            flag: { type: 'string' },
            enabled: { type: 'boolean' },
          },
        },
        outputSchema: {
          type: 'object',
          required: ['flag', 'enabled', 'updated'],
        },
        _metadata: {
          is_mutating: true,
          is_dangerous: true,
          is_cacheable: false,
        },
      });
    });
  });

  describe('Collab & T2 Multiplayer Contracts', () => {
    it('validates RoomTokenPayload and UserPresence', () => {
      const token = RoomTokenPayloadSchema.parse({
        sub: 'user-007',
        callsign: 'Spectre-1',
        roomId: 'room-alpha',
        role: 'operator',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      });
      expect(token.role).toBe('operator');

      const presence = UserPresenceSchema.parse({
        clientId: 'client-1234',
        callsign: 'Spectre-1',
        role: 'operator',
        color: '#00f0ff',
        cursor: { lat: 40.7128, lon: -74.006 },
        lastSeenTs: Date.now(),
      });
      expect(presence.cursor?.lat).toBe(40.7128);
    });

    it('validates RoomIntentState with entity selection and layer state', () => {
      const state = RoomIntentStateSchema.parse({
        roomId: 'room-tactical',
        selectedEntity: { layer: 'flights', id: 'a0b1c2' },
        activeLayers: { flights: true, marine: false, quakes: true },
        aois: [
          {
            id: 'aoi-1',
            name: 'Strait of Malacca',
            bounds: [1.0, 100.0, 6.0, 105.0],
            createdBy: 'Operator-1',
            createdAtTs: 1700000000,
          },
        ],
        followLeaderId: 'client-999',
        simTimeOffsetSec: -120,
      });

      expect(state.selectedEntity?.id).toBe('a0b1c2');
      expect(state.aois[0].name).toBe('Strait of Malacca');
    });

    it('validates RoomJoinRequest and Response schemas', () => {
      const req = RoomJoinRequestSchema.parse({
        roomId: 'ops-main',
        callsign: 'WatchOfficer-1',
        role: 'operator',
      });
      expect(req.roomId).toBe('ops-main');
    });
  });
});
