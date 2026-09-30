import { describe, it, expect, vi, beforeEach } from 'vitest';

const { afterSpy } = vi.hoisted(() => ({ afterSpy: vi.fn() }));
vi.mock('next/server', () => ({ after: (task: () => unknown) => afterSpy(task) }));

import { runAfterResponse } from '../after-response';

describe('runAfterResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterSpy.mockImplementation((task: () => unknown) => { void task(); });
  });

  it('schedules the task through after() rather than fire-and-forget', () => {
    const task = vi.fn().mockResolvedValue(undefined);

    runAfterResponse(task, { label: 'webhook' });

    expect(afterSpy).toHaveBeenCalledTimes(1);
    expect(afterSpy.mock.calls[0]![0]).toBeTypeOf('function');
  });

  it('never returns an unawaited promise to the caller', () => {
    const task = vi.fn().mockResolvedValue(undefined);

    expect(runAfterResponse(task, { label: 'webhook' })).toBeUndefined();
  });

  it('does not throw when the task fails', async () => {
    const task = vi.fn().mockRejectedValue(new Error('vendor timeout'));
    const onError = vi.fn();

    expect(() => runAfterResponse(task, { label: 'webhook', onError })).not.toThrow();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it('reports a synchronous task failure', async () => {
    const onError = vi.fn();
    const task = () => { throw new Error('boom'); };

    runAfterResponse(task, { label: 'webhook', onError });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });

  it('awaits the task inline when after() is unavailable', async () => {
    afterSpy.mockImplementationOnce(() => { throw new Error('after() called outside a request scope'); });
    const order: string[] = [];
    const task = vi.fn(async () => { order.push('task'); });

    runAfterResponse(task, { label: 'webhook' });
    await vi.waitFor(() => expect(order).toEqual(['task']));
  });
});
