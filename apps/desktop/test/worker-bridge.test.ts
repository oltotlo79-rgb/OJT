import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkerBridge, type BridgeHandlers } from '../src/renderer/session/worker-bridge.js';
import type { SimMessage } from '../src/worker/protocol.js';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<SimMessage>) => void) | undefined;
  onerror: ((event: ErrorEvent) => void) | undefined;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
const handlers = (): BridgeHandlers => ({
  onSnapshot: vi.fn(),
  onJudge: vi.fn(),
  onError: vi.fn(),
});
beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

it('詳細の無いWorkerエラーでも復帰案内を出し、停止したWorkerへ送信しない', () => {
  const bridge = new WorkerBridge();
  const receiver = handlers();
  bridge.start(receiver);
  const worker = FakeWorker.instances[0]!;
  worker.onerror?.(new Event('error') as ErrorEvent);
  expect(receiver.onError).toHaveBeenCalledWith(
    expect.stringContaining('セッションをリセット'),
    true,
  );
  expect(bridge.running).toBe(false);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  bridge.send({ type: 'resetTrip' });
  expect(worker.postMessage).not.toHaveBeenCalled();
});

it('再接続後に旧Workerから遅れて届くエラーを新しいセッションへ適用しない', () => {
  const bridge = new WorkerBridge();
  const oldReceiver = handlers();
  const currentReceiver = handlers();
  bridge.start(oldReceiver);
  const oldWorker = FakeWorker.instances[0]!;
  bridge.start(currentReceiver);
  oldWorker.onerror?.(new ErrorEvent('error', { message: 'old failure' }));
  expect(oldReceiver.onError).not.toHaveBeenCalled();
  expect(currentReceiver.onError).not.toHaveBeenCalled();
  expect(bridge.running).toBe(true);
  expect(FakeWorker.instances[1]!.terminate).not.toHaveBeenCalled();
  bridge.stop();
});

it('致命的な演算エラーでも接続を閉じ、元の原因を保つ', () => {
  const bridge = new WorkerBridge();
  const receiver = handlers();
  bridge.start(receiver);
  FakeWorker.instances[0]!.onmessage?.(
    new MessageEvent('message', {
      data: { type: 'error', message: 'calculation failure', fatal: true },
    }),
  );
  expect(receiver.onError).toHaveBeenCalledWith('calculation failure', true);
  expect(bridge.running).toBe(false);
});
