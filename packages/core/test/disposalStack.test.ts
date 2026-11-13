import { describe, expect, it } from 'vitest';
import { DisposalStack } from '../src/disposalStack.js';

describe('DisposalStack Reverse-Order Cleanup', () => {
  it('executes registered disposers in strict LIFO reverse order and is idempotent', async () => {
    const order: string[] = [];
    const stack = new DisposalStack();

    stack.defer(() => {
      order.push('first');
    });
    stack.defer(async () => {
      order.push('second');
    });
    stack.defer(() => {
      order.push('third');
    });

    await stack.dispose();
    await stack.dispose();

    expect(order).toEqual(['third', 'second', 'first']);
    expect(() => stack.defer(() => {})).toThrow('has been disposed');
  });

  it('continues running earlier disposers even if a later disposer throws', async () => {
    const order: string[] = [];
    const stack = new DisposalStack();

    stack.defer(() => {
      order.push('first');
    });
    stack.defer(() => {
      order.push('failing');
      throw new Error('boom');
    });
    stack.defer(() => {
      order.push('third');
    });

    await expect(stack.dispose()).rejects.toThrow('boom');
    expect(order).toEqual(['third', 'failing', 'first']);
  });
});
