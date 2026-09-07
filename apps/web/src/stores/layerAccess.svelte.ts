import { type LayerAccessReadModel, LayerAccessReadModelSchema } from '@gev/contracts';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

class LayerAccessStore {
  model = $state<LayerAccessReadModel | null>(null);
  loadState = $state<LoadState>('idle');
  error = $state<string | null>(null);

  async load(signal?: AbortSignal): Promise<void> {
    if (this.loadState === 'loading') return;
    this.loadState = 'loading';
    this.error = null;
    try {
      const response = await fetch('/ops/layer-access', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Task-Ref': 'web-layer-access-read' },
        signal,
      });
      if (!response.ok) {
        throw new Error(`Layer Access returned HTTP ${response.status}`);
      }
      this.model = LayerAccessReadModelSchema.parse(await response.json());
      this.loadState = 'ready';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.model = null;
      this.loadState = 'error';
      this.error =
        error instanceof Error ? error.message : 'Layer Access status could not be loaded';
    }
  }
}

export const layerAccessStore = new LayerAccessStore();
