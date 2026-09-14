import type { SimCommand, SimMessage, SimSnapshot } from '../../worker/protocol.js';

/**
 * Simulation Worker との橋渡し。設計仕様 §4.3。
 * React の外に置き、スナップショットをストアへ流し込む。3Dの再描画は
 * `invalidate()` を呼ぶ購読者（BoardScene）が担う（§12.2 の性能方針）。
 */

/** ブリッジの購読先。 */
export interface BridgeHandlers {
  onSnapshot: (snapshot: SimSnapshot) => void;
  onJudge: (message: Extract<SimMessage, { type: 'judgeResult' }>) => void;
  onError: (message: string) => void;
}

/** Worker を1本持ち、コマンド送信とメッセージ配送を行う。 */
export class WorkerBridge {
  private worker: Worker | undefined;
  private handlers: BridgeHandlers | undefined;

  /** Worker を起動して購読を始める。既に動いていれば作り直す（§13 #6 の復帰にも使う）。 */
  start(handlers: BridgeHandlers): void {
    this.stop();
    this.handlers = handlers;
    const worker = new Worker(new URL('../../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
      name: 'ojt-simulation',
    });
    worker.onmessage = (event: MessageEvent<SimMessage>) => {
      const message = event.data;
      if (message.type === 'snapshot') handlers.onSnapshot(message.snapshot);
      else if (message.type === 'judgeResult') handlers.onJudge(message);
      else handlers.onError(message.message);
    };
    worker.onerror = (event: ErrorEvent) => {
      handlers.onError(event.message);
    };
    this.worker = worker;
  }

  /** コマンドを送る。Worker が無ければ何もしない。 */
  send(command: SimCommand): void {
    this.worker?.postMessage(command);
  }

  /** 動いているか。 */
  get running(): boolean {
    return this.worker !== undefined;
  }

  /** Worker を止める。 */
  stop(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.handlers = undefined;
  }
}

/** アプリで1本だけ使うブリッジ。 */
export const bridge = new WorkerBridge();
