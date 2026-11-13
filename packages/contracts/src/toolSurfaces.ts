import { OPERATOR_TOOLS, type OperatorToolName } from './toolRegistry.js';

export const TOOL_SURFACE_NAMES = ['mcp', 'voice'] as const;
export type ToolSurface = (typeof TOOL_SURFACE_NAMES)[number];

export type SurfacePolicy = Readonly<Partial<Record<ToolSurface, boolean>>>;
export type SurfaceOverrides = Readonly<Record<string, SurfacePolicy>>;

const mcpOff: SurfacePolicy = Object.freeze({ mcp: false });
const voiceOff: SurfacePolicy = Object.freeze({ voice: false });
const globeUiOnly: SurfacePolicy = Object.freeze({ mcp: false, voice: true });

/**
 * Declarative visibility policy across interactive/agent surfaces.
 * Tools remain defined once in OPERATOR_TOOLS; surfaces expose filtered subsets.
 */
export const TOOL_SURFACES: Readonly<Record<OperatorToolName, SurfacePolicy>> = Object.freeze({
  get_feed_health: voiceOff,
  get_budget: voiceOff,
  run_diagnostics: voiceOff,
  load_scene: voiceOff,
  save_scene: voiceOff,
  tail_logs: voiceOff,
  set_flag: voiceOff,
  fly_to_location: globeUiOnly,
  toggle_layer: globeUiOnly,
  select_entity: globeUiOnly,
  inspect_telemetry: globeUiOnly,
  query_aoi: globeUiOnly,
  set_sim_time: Object.freeze({ ...mcpOff, voice: false }),
  preview_business_context: voiceOff,
  analyze_market_context: voiceOff,
  analyze_competition: voiceOff,
  compare_locations: voiceOff,
  analyze_workforce_context: voiceOff,
  assess_site_risk: voiceOff,
});

function validateSurface(surface: string): asserts surface is ToolSurface {
  if (!TOOL_SURFACE_NAMES.includes(surface as ToolSurface)) {
    throw new TypeError(`Unknown tool surface: ${surface}`);
  }
}

function validateOverrides(overrides: SurfaceOverrides, knownTools: ReadonlySet<string>): void {
  for (const [toolName, policy] of Object.entries(overrides)) {
    if (!knownTools.has(toolName)) {
      throw new TypeError(`Unknown tool in surface overrides: ${toolName}`);
    }
    for (const surfaceKey of Object.keys(policy)) {
      if (!TOOL_SURFACE_NAMES.includes(surfaceKey as ToolSurface)) {
        throw new TypeError(`Unknown tool surface "${surfaceKey}" for tool "${toolName}"`);
      }
    }
  }
}

export function isToolEnabledOnSurface(
  name: OperatorToolName,
  surface: ToolSurface,
  overrides: SurfaceOverrides = {}
): boolean {
  validateSurface(surface);
  const knownTools = new Set<string>(Object.keys(OPERATOR_TOOLS));
  validateOverrides(overrides, knownTools);
  const overrideValue = overrides[name]?.[surface];
  if (overrideValue !== undefined) {
    return overrideValue;
  }
  return TOOL_SURFACES[name]?.[surface] !== false;
}

/**
 * Returns canonical registry-ordered tool names enabled on the requested surface.
 */
export function toolsForSurface(
  surface: ToolSurface,
  overrides: SurfaceOverrides = {}
): readonly OperatorToolName[] {
  validateSurface(surface);
  const allNames = Object.keys(OPERATOR_TOOLS) as OperatorToolName[];
  const knownTools = new Set<string>(allNames);
  validateOverrides(overrides, knownTools);
  return allNames.filter(
    (name) => (overrides[name]?.[surface] ?? TOOL_SURFACES[name]?.[surface]) !== false
  );
}

export interface ToolCatalogEntry {
  readonly name: string;
}

export interface SurfaceCatalog<TEntry extends ToolCatalogEntry, TResult = unknown> {
  list(): readonly TEntry[];
  get(name: string): TEntry | undefined;
  call(name: string, args: unknown, context?: unknown): Promise<TResult>;
}

/**
 * Wraps a composed tool catalog to list and dispatch only tools enabled on `surface`.
 */
export function catalogForSurface<TEntry extends ToolCatalogEntry, TResult = unknown>(
  catalog: SurfaceCatalog<TEntry, TResult>,
  surface: ToolSurface,
  overrides: SurfaceOverrides = {}
): SurfaceCatalog<TEntry, TResult> {
  validateSurface(surface);
  const catalogEntries = catalog.list();
  const knownTools = new Set<string>([
    ...Object.keys(OPERATOR_TOOLS),
    ...catalogEntries.map((entry) => entry.name),
  ]);
  validateOverrides(overrides, knownTools);

  const offered = new Set<string>(
    catalogEntries
      .filter((entry) => {
        const policy = TOOL_SURFACES[entry.name as OperatorToolName];
        return (overrides[entry.name]?.[surface] ?? policy?.[surface]) !== false;
      })
      .map((entry) => entry.name)
  );

  return Object.freeze({
    list: () => catalog.list().filter((entry) => offered.has(entry.name)),
    get: (name: string) => (offered.has(name) ? catalog.get(name) : undefined),
    async call(name: string, args: unknown, context?: unknown): Promise<TResult> {
      if (!offered.has(name)) {
        throw new Error(`No tool named ${name} is available on surface "${surface}"`);
      }
      return catalog.call(name, args, context);
    },
  });
}
