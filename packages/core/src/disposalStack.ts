export type DisposerFn = () => void | Promise<void>;

/**
 * LIFO cleanup stack so resource teardown occurs in strict reverse registration order.
 * Continues running remaining disposers even when an earlier disposer throws.
 */
export class DisposalStack {
  private readonly disposers: DisposerFn[] = [];
  private disposed = false;

  defer(disposer: DisposerFn): void {
    if (this.disposed) {
      throw new Error('Cannot register disposer after DisposalStack has been disposed');
    }
    this.disposers.push(disposer);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const errors: unknown[] = [];

    for (let i = this.disposers.length - 1; i >= 0; i--) {
      const fn = this.disposers[i];
      if (!fn) continue;
      try {
        await fn();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple errors occurred during DisposalStack cleanup');
    }
  }
}
