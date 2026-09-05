import type {
  BikeStation,
  CctvCamera,
  EarthquakeFeature,
  FlightState,
  LaunchMission,
  RadioStation,
  SatellitePropagatedState,
  ShipState,
  ThermalHotspot,
  WeatherStation,
} from '@gev/contracts';

export interface UnifiedTelemetryItem {
  id: string;
  kind:
    | 'flight'
    | 'marine'
    | 'quake'
    | 'firms'
    | 'gbfs'
    | 'cctv'
    | 'radio'
    | 'launch'
    | 'weather'
    | 'satellite';
  name: string;
  metric1: string;
  metric2: string;
  coordinates: string;
  lat: number;
  lon: number;
  alt: number;
  timeText: string;
  rawData: Record<string, unknown>;
}

export interface UnifiedEntityCollections {
  flights: FlightState[];
  marine: ShipState[];
  quakes: EarthquakeFeature[];
  firms: ThermalHotspot[];
  gbfs: BikeStation[];
  cctv: CctvCamera[];
  radio: RadioStation[];
  launches: LaunchMission[];
  weather: WeatherStation[];
  satellites: SatellitePropagatedState[];
}

type UnifiedVisibility = Record<keyof UnifiedEntityCollections, boolean>;

/** Builds the presentation-only, source-typed telemetry projection for the virtual table. */
export function buildUnifiedTelemetryItems(
  visibility: UnifiedVisibility,
  entities: UnifiedEntityCollections
): UnifiedTelemetryItem[] {
  const items: UnifiedTelemetryItem[] = [];

  if (visibility.flights) {
    for (const flight of entities.flights) {
      if (flight.longitude === null || flight.latitude === null) continue;
      const altitude = flight.geo_altitude ?? flight.baro_altitude ?? 0;
      items.push({
        id: flight.icao24,
        kind: 'flight',
        name: flight.callsign || flight.icao24,
        metric1: `Alt: ${altitude.toLocaleString()}m`,
        metric2: `Vel: ${flight.velocity ? `${flight.velocity.toFixed(0)} m/s` : 'N/A'}`,
        coordinates: `${flight.latitude.toFixed(2)}°, ${flight.longitude.toFixed(2)}°`,
        lat: flight.latitude,
        lon: flight.longitude,
        alt: Math.max(1_000, altitude),
        timeText: flight.last_contact
          ? new Date(flight.last_contact * 1_000).toLocaleTimeString()
          : 'Live',
        rawData: flight as unknown as Record<string, unknown>,
      });
    }
  }

  if (visibility.marine) {
    for (const ship of entities.marine) {
      items.push({
        id: ship.mmsi,
        kind: 'marine',
        name: ship.name || `Vessel ${ship.mmsi}`,
        metric1: `SOG: ${(ship.sog_knots ?? 0).toFixed(1)} kts`,
        metric2: `Type: ${ship.ship_type ?? 'Cargo'}`,
        coordinates: `${ship.latitude.toFixed(2)}°, ${ship.longitude.toFixed(2)}°`,
        lat: ship.latitude,
        lon: ship.longitude,
        alt: 500,
        timeText: 'Live AIS',
        rawData: ship as unknown as Record<string, unknown>,
      });
    }
  }

  if (visibility.quakes) {
    for (const quake of entities.quakes) {
      items.push({
        id: quake.id,
        kind: 'quake',
        name: `M${quake.mag.toFixed(1)} Earthquake`,
        metric1: `Mag: M${quake.mag.toFixed(1)}`,
        metric2: `Depth: ${quake.depth_km} km`,
        coordinates: `${quake.latitude.toFixed(2)}°, ${quake.longitude.toFixed(2)}°`,
        lat: quake.latitude,
        lon: quake.longitude,
        alt: 5_000,
        timeText: quake.time ? new Date(quake.time).toLocaleTimeString() : 'Recent',
        rawData: quake as unknown as Record<string, unknown>,
      });
    }
  }

  if (visibility.firms) {
    for (const hotspot of entities.firms) {
      items.push({
        id: hotspot.id,
        kind: 'firms',
        name: `Thermal Hotspot ${hotspot.id}`,
        metric1: `FRP: ${hotspot.frp_mw.toFixed(1)} MW`,
        metric2: `Temp: ${hotspot.brightness_kelvin.toFixed(0)} K`,
        coordinates: `${hotspot.latitude.toFixed(2)}°, ${hotspot.longitude.toFixed(2)}°`,
        lat: hotspot.latitude,
        lon: hotspot.longitude,
        alt: 2_000,
        timeText: `${hotspot.acq_date} ${hotspot.acq_time}`,
        rawData: hotspot as unknown as Record<string, unknown>,
      });
    }
  }

  if (visibility.gbfs) {
    for (const station of entities.gbfs) {
      items.push({
        id: station.station_id,
        kind: 'gbfs',
        name: station.name,
        metric1: `Bikes: ${station.num_bikes_available}`,
        metric2: `Docks: ${station.num_docks_available}`,
        coordinates: `${station.latitude.toFixed(2)}°, ${station.longitude.toFixed(2)}°`,
        lat: station.latitude,
        lon: station.longitude,
        alt: 500,
        timeText: 'Realtime',
        rawData: station as unknown as Record<string, unknown>,
      });
    }
  }

  if (visibility.cctv) {
    for (const camera of entities.cctv) {
      items.push({
        id: camera.id,
        kind: 'cctv',
        name: camera.name,
        metric1: `Agency: ${camera.agency}`,
        metric2: `Rate: ${camera.refresh_interval_sec}s`,
        coordinates: `${camera.latitude.toFixed(2)}°, ${camera.longitude.toFixed(2)}°`,
        lat: camera.latitude,
        lon: camera.longitude,
        alt: 400,
        timeText: camera.status,
        rawData: camera as unknown as Record<string, unknown>,
      });
    }
  }

  if (visibility.radio) {
    for (const station of entities.radio) {
      items.push({
        id: station.id,
        kind: 'radio',
        name: station.name,
        metric1: `Freq: ${station.frequency_mhz ? `${station.frequency_mhz} MHz` : 'Web'}`,
        metric2: `Cat: ${station.category.toUpperCase()}`,
        coordinates: `${station.latitude.toFixed(2)}°, ${station.longitude.toFixed(2)}°`,
        lat: station.latitude,
        lon: station.longitude,
        alt: 400,
        timeText: `${station.bitrate_kbps} kbps`,
        rawData: station as unknown as Record<string, unknown>,
      });
    }
  }

  if (visibility.launches) {
    for (const launch of entities.launches) {
      const firstPoint = launch.trajectory[0];
      const latitude = firstPoint?.latitude ?? 34.6;
      const longitude = firstPoint?.longitude ?? -120.6;
      items.push({
        id: launch.id,
        kind: 'launch',
        name: launch.name,
        metric1: `Orbit: ${launch.target_orbit}`,
        metric2: `Vehicle: ${launch.vehicle}`,
        coordinates: `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`,
        lat: latitude,
        lon: longitude,
        alt: 50_000,
        timeText: launch.status.toUpperCase(),
        rawData: launch as unknown as Record<string, unknown>,
      });
    }
  }

  if (visibility.weather) {
    for (const station of entities.weather) {
      items.push({
        id: station.id,
        kind: 'weather',
        name: station.name,
        metric1: `Temp: ${station.temp_c}°C`,
        metric2: `Wind: ${station.wind_speed_kmh} km/h`,
        coordinates: `${station.latitude.toFixed(2)}°, ${station.longitude.toFixed(2)}°`,
        lat: station.latitude,
        lon: station.longitude,
        alt: 600,
        timeText: station.condition,
        rawData: station as unknown as Record<string, unknown>,
      });
    }
  }

  if (visibility.satellites) {
    for (const satellite of entities.satellites) {
      items.push({
        id: satellite.catalog_id,
        kind: 'satellite',
        name: satellite.object_name,
        metric1: `Alt: ${(satellite.altitude_m / 1_000).toFixed(0)} km`,
        metric2: `Speed: ${(satellite.speed_mps / 1_000).toFixed(2)} km/s`,
        coordinates: `${satellite.latitude_deg.toFixed(2)}°, ${satellite.longitude_deg.toFixed(2)}°`,
        lat: satellite.latitude_deg,
        lon: satellite.longitude_deg,
        alt: Math.max(500_000, satellite.altitude_m),
        timeText: 'SGP4 estimate',
        rawData: satellite as unknown as Record<string, unknown>,
      });
    }
  }

  return items;
}
