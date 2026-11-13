import { describe, expect, it } from 'vitest';
import {
  OPERATOR_TOOLS,
  catalogForSurface,
  isToolEnabledOnSurface,
  toolsForSurface,
} from '../src/tools.js';

describe('Declarative Tool Surface Filtering', () => {
  it('derives distinct canonical MCP and Voice surface tool subsets from OPERATOR_TOOLS', () => {
    const mcpTools = toolsForSurface('mcp');
    const voiceTools = toolsForSurface('voice');

    expect(mcpTools).toEqual([
      'get_feed_health',
      'get_budget',
      'run_diagnostics',
      'load_scene',
      'save_scene',
      'tail_logs',
      'set_flag',
      'preview_business_context',
      'analyze_market_context',
      'analyze_competition',
      'compare_locations',
      'analyze_workforce_context',
      'assess_site_risk',
    ]);
    expect(voiceTools).toEqual([
      'fly_to_location',
      'toggle_layer',
      'select_entity',
      'inspect_telemetry',
      'query_aoi',
    ]);
    expect(isToolEnabledOnSurface('set_sim_time', 'mcp')).toBe(false);
    expect(isToolEnabledOnSurface('set_sim_time', 'voice')).toBe(false);
  });

  it('supports explicit surface overrides and fails fast on unknown surfaces or tool names', () => {
    const withOverrides = toolsForSurface('voice', {
      preview_business_context: { voice: true },
      fly_to_location: { voice: false },
    });
    expect(withOverrides).toContain('preview_business_context');
    expect(withOverrides).not.toContain('fly_to_location');

    expect(() => toolsForSurface('invalid' as 'mcp')).toThrow('Unknown tool surface');
    expect(() => toolsForSurface('mcp', { nonexistent_tool: { mcp: true } })).toThrow(
      'Unknown tool in surface overrides'
    );
    expect(() =>
      toolsForSurface('mcp', { get_budget: { invalid: true } as unknown as { mcp: boolean } })
    ).toThrow('Unknown tool surface');
  });

  it('wraps a full catalog to block non-offered calls while allowing underlying calls internally', async () => {
    const allEntries = Object.keys(OPERATOR_TOOLS).map((name) => ({ name }));
    const rawCatalog = {
      list: () => allEntries,
      get: (name: string) => allEntries.find((entry) => entry.name === name),
      async call(name: string) {
        return { called: name };
      },
    };

    const voiceCatalog = catalogForSurface(rawCatalog, 'voice');
    expect(voiceCatalog.list().map((entry) => entry.name)).toEqual(toolsForSurface('voice'));
    expect(voiceCatalog.get('fly_to_location')).toBeDefined();
    expect(voiceCatalog.get('set_flag')).toBeUndefined();

    await expect(voiceCatalog.call('fly_to_location', {})).resolves.toEqual({
      called: 'fly_to_location',
    });
    await expect(voiceCatalog.call('set_flag', {})).rejects.toThrow(
      'No tool named set_flag is available on surface "voice"'
    );
  });
});
