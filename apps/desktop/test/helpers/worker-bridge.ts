import type { BridgeHandlers } from '../../src/renderer/session/worker-bridge.js';

/**
 * `session/worker-bridge.js` の `vi.mock` を畳む（QA-25）。
 *
 * 13ファイルがそれぞれ10〜14行の `vi.mock('../src/renderer/session/worker-bridge.js', ...)` を
 * 複写しており、`bridge.running` の既定値だけが版によって違っていた（`true` / `false` / 省略）。
 * `WorkerBridge.running` を読む本番コードは無い（`grep -rn '\.running\b' apps/desktop/src` で
 * 確認済み）ので値そのものはどのテストの合否にも影響しないが、既定は1つに揃える。
 * `true`（`bridge.start()` を呼んだあとの状態）を既定にする。13ファイル中、明示していた6ファイル
 * のうち4ファイルがこの値で、意味としても「起動済み」を表すほうが `start()` 呼び出し後の実態に合う。
 *
 * 呼び出し側は状態を `vi.hoisted()` で作り（`vi.hoisted` は import より前に持ち上がるので、
 * ここだけはインポートした関数を呼べず素のオブジェクトリテラルのまま書く）、
 * `vi.mock` のファクトリからは畳んだ関数を呼ぶだけでよい:
 *
 * ```ts
 * const bridgeMock = vi.hoisted(
 *   () => ({ sent: [], handlers: undefined }) satisfies WorkerBridgeMockState,
 * );
 * vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));
 * // beforeEach(() => resetWorkerBridgeMock(bridgeMock));
 * ```
 */

/**
 * モック状態。送ったコマンドの記録と、直近に登録されたハンドラ。
 * `sent` は `Record<string, unknown>` にする（元の13ファイルの過半数が `c['type']` の形で
 * ブラケットアクセスしていたため。`unknown[]` にすると呼び出し側で毎回キャストが要る）。
 */
export interface WorkerBridgeMockState {
  sent: Array<Record<string, unknown>>;
  handlers: BridgeHandlers | undefined;
}

/** モック化した `bridge` の形。 */
export interface WorkerBridgeMockModule {
  bridge: {
    start: (handlers: BridgeHandlers) => void;
    send: (command: Record<string, unknown>) => void;
    stop: () => void;
    running: boolean;
  };
}

/**
 * `vi.mock('.../worker-bridge.js', () => workerBridgeMockModule(state))` にそのまま渡せる形。
 * `running` を省くと `true`（既定。上のコメント参照）。
 */
export function workerBridgeMockModule(
  state: WorkerBridgeMockState,
  running = true,
): WorkerBridgeMockModule {
  return {
    bridge: {
      start: (handlers: BridgeHandlers) => {
        state.handlers = handlers;
      },
      send: (command: Record<string, unknown>) => {
        state.sent.push(command);
      },
      stop: () => {
        state.handlers = undefined;
      },
      running,
    },
  };
}

/** `beforeEach` で呼び、前のテストの送信記録・ハンドラを消す。 */
export function resetWorkerBridgeMock(state: WorkerBridgeMockState): void {
  state.sent = [];
  state.handlers = undefined;
}
