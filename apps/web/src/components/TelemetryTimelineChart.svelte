<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { WEB_CHART_THEME } from '../designTokens';

  interface SeriesConfig {
    label: string;
    stroke: string;
    fill?: string;
    width?: number;
    valueFormat?: (val: number) => string;
  }

  interface Props {
    title?: string;
    xAxisLabel?: string;
    data: [number[], ...number[][]]; // [xTimestamps, ySeries1, ySeries2, ...]
    seriesConfigs: SeriesConfig[];
    height?: number;
  }

  const {
    title = 'Telemetry Profile',
    xAxisLabel = 'Time (s)',
    data,
    seriesConfigs,
    height = 140,
  }: Props = $props();

  let chartContainer: HTMLDivElement;
  let chartInstance: uPlot | null = null;
  let resizeObserver: ResizeObserver | null = null;

  function renderChart() {
    if (!chartContainer || !data || data.length === 0) return;

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    const width = chartContainer.clientWidth || 320;

    const seriesOptions: uPlot.Series[] = [
      {
        label: xAxisLabel,
        value: (u, val) => (val !== null ? `${val.toFixed(0)}s` : '--'),
      },
    ];

    for (const conf of seriesConfigs) {
      seriesOptions.push({
        label: conf.label,
        stroke: conf.stroke,
        fill: conf.fill,
        width: conf.width ?? 1.5,
        value: (u, val) => (val !== null ? (conf.valueFormat ? conf.valueFormat(val) : val.toFixed(1)) : '--'),
      });
    }

    const opts: uPlot.Options = {
      width,
      height,
      cursor: {
        points: {
          size: 6,
          fill: WEB_CHART_THEME.cursor,
        },
      },
      legend: {
        show: true,
      },
      axes: [
        {
          stroke: WEB_CHART_THEME.axis,
          grid: { stroke: WEB_CHART_THEME.grid, width: 1 },
          ticks: { stroke: WEB_CHART_THEME.ticks, width: 1 },
          font: '10px ui-monospace, monospace',
        },
        {
          stroke: WEB_CHART_THEME.axis,
          grid: { stroke: WEB_CHART_THEME.grid, width: 1 },
          ticks: { stroke: WEB_CHART_THEME.ticks, width: 1 },
          font: '10px ui-monospace, monospace',
        },
      ],
      series: seriesOptions,
    };

    try {
      chartInstance = new uPlot(opts, data as uPlot.AlignedData, chartContainer);
    } catch {
      // Fallback if data format needs alignment
    }
  }

  $effect(() => {
    // Re-render when data or series configs change
    if (data && chartContainer) {
      renderChart();
    }
  });

  onMount(() => {
    renderChart();

    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && chartInstance) {
          chartInstance.setSize({
            width: entry.contentRect.width,
            height,
          });
        }
      }
    });

    if (chartContainer) {
      resizeObserver.observe(chartContainer);
    }
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  });
</script>

<div class="telemetry-chart-wrapper">
  {#if title}
    <div class="chart-header">
      <span class="chart-title">{title}</span>
      <span class="chart-tag">uPlot 60 FPS Canvas</span>
    </div>
  {/if}
  <div bind:this={chartContainer} class="uplot-container"></div>
</div>

<style>
  .telemetry-chart-wrapper {
    margin-top: 10px;
    background: var(--hud-surface-dark-soft);
    border: 1px solid var(--hud-chip-border);
    border-radius: 6px;
    padding: 8px;
    box-sizing: border-box;
    width: 100%;
  }

  .chart-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    font-size: 0.72rem;
  }

  .chart-title {
    color: var(--hud-text-primary);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .chart-tag {
    color: var(--hud-accent);
    font-family: ui-monospace, monospace;
    font-size: 0.65rem;
    background: var(--hud-accent-subtle);
    padding: 2px 5px;
    border-radius: 3px;
    border: 1px solid var(--hud-accent-selected);
  }

  .uplot-container {
    width: 100%;
    min-height: 120px;
  }

  :global(.uplot .u-legend) {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    color: var(--hud-text-secondary);
    padding: 2px 0 6px 0;
  }

  :global(.uplot .u-legend .u-series th) {
    color: var(--hud-text-primary);
  }
</style>
