import fs from 'node:fs';
import { SceneState } from '@gev/contracts';
import { SystemClock } from '@gev/core';
import pc from 'picocolors';

export async function runSceneLoad(filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    console.error(pc.red(`Error: Scene file not found at ${filePath}`));
    process.exitCode = 1;
    return;
  }

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    const scene = SceneState.parse(parsed);

    console.log(pc.bold(pc.green(`\n✔ Successfully loaded and validated scene: ${filePath}`)));
    console.log(` Version:       ${scene.version}`);
    console.log(` Created At:    ${scene.created_at}`);
    console.log(
      ` Camera Pose:   lat: ${scene.camera.latitude.toFixed(2)}°, lon: ${scene.camera.longitude.toFixed(2)}°, alt: ${Math.round(scene.camera.altitude)}m`
    );
    console.log(
      ` Active Layers: ${scene.layers.map((l) => `${l.id}(${l.enabled ? 'on' : 'off'})`).join(', ')}`
    );
    console.log(` AOIs:          ${scene.aois.length} defined\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid scene schema';
    console.error(pc.red(`\n✖ Failed to load scene: ${msg}\n`));
    process.exitCode = 1;
  }
}

export async function runSceneSave(targetPath?: string): Promise<void> {
  const clock = new SystemClock();
  const filePath = targetPath ?? `scene-${Date.now()}.json`;

  const scene = SceneState.parse({
    version: 1,
    created_at: new Date(clock.now()).toISOString(),
    camera: {
      longitude: 0,
      latitude: 20,
      altitude: 20000000,
      heading: 0,
      pitch: -90,
      roll: 0,
    },
    layers: [
      { id: 'flights', enabled: true, opacity: 1 },
      { id: 'osm_raster', enabled: true, opacity: 1 },
    ],
    selected_entity: null,
    aois: [],
    sim_time: {
      iso: new Date(clock.now()).toISOString(),
      rate: 1,
      paused: false,
    },
  });

  await fs.promises.writeFile(filePath, JSON.stringify(scene, null, 2), 'utf-8');
  console.log(pc.bold(pc.green(`\n✔ Saved reproducible scene state to ${filePath}\n`)));
}
