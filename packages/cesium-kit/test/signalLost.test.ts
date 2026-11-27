import { describe, expect, it, vi } from 'vitest';
import { FlightLayerController } from '../src/flightLayer.js';
import { MarineLayerController } from '../src/marineLayer.js';

type LayerViewer = ConstructorParameters<typeof FlightLayerController>[0]['viewer'];

function createMockViewer(): { viewer: LayerViewer; requestRender: ReturnType<typeof vi.fn> } {
  const requestRender = vi.fn();
  const viewer = {
    dataSources: {
      add: vi.fn((ds) => Promise.resolve(ds)),
      remove: vi.fn(() => true),
    },
    scene: { requestRender },
    isDestroyed: () => false,
  } as unknown as LayerViewer;
  return { viewer, requestRender };
}

describe('Signal Lost / Stale Entity Dimming (FlightLayer & MarineLayer)', () => {
  it('dims existing aircraft points on setSignalLost(true) and restores full opacity on recovery', () => {
    const { viewer, requestRender } = createMockViewer();
    const layer = new FlightLayerController({ viewer });
    layer.enqueueBatch({
      provenance: {} as never,
      states: [
        {
          icao24: 'a1b2c3',
          callsign: 'UAL101',
          origin_country: 'United States',
          longitude: -122.37,
          latitude: 37.62,
          baro_altitude: 9000,
          geo_altitude: 9050,
          velocity: 230,
          true_track: 90,
          vertical_rate: 0,
          on_ground: false,
          last_contact: 1_700_000_000,
          time_position: 1_700_000_000,
        },
      ],
    });
    layer.drainQueue();

    layer.setSignalLost(true);
    expect(layer.getSignalLost()).toBe(true);
    expect(requestRender).toHaveBeenCalled();

    const dimmedEntity = layer.dataSource.entities.getById('flight-a1b2c3');
    const dimmedColor = dimmedEntity?.point?.color?.getValue(undefined as never);
    expect(dimmedColor.alpha).toBeLessThan(0.5);

    layer.setSignalLost(false);
    expect(layer.getSignalLost()).toBe(false);
    const restoredColor = dimmedEntity?.point?.color?.getValue(undefined as never);
    expect(restoredColor.alpha).toBe(1);
    layer.destroy();
  });

  it('dims newly created marine vessels while signal lost is active', () => {
    const { viewer } = createMockViewer();
    const layer = new MarineLayerController({ viewer });
    layer.setSignalLost(true);
    layer.enqueueBatch({
      provenance: {} as never,
      ships: [
        {
          mmsi: '366000111',
          name: 'PACIFIC PRIDE',
          ship_type: 'Cargo',
          longitude: -122.4,
          latitude: 37.8,
          sog: 12,
          cog: 180,
          true_heading: 180,
          timestamp: '2026-11-12T20:00:00.000Z',
        },
      ],
    });
    layer.drainQueue();

    const shipEntity = layer.dataSource.entities.getById('ship-366000111');
    const shipColor = shipEntity?.point?.color?.getValue(undefined as never);
    expect(shipColor.alpha).toBeLessThan(0.5);
    layer.destroy();
  });
});
