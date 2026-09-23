import type { BoardSession, PlcUnitDefinition, SocketRoles } from '@ojt/board-model';
import type { ChatterEvent, HazardEvent, Netlist, SignalLog, WireColor } from '@ojt/circuit-sim';
import type { StaticCheckId } from './schema/judge.js';
import type { ResolvedPlcIo } from './schema/plc.js';

/**
 * 静的チェックの型だけを置くファイル。設計仕様 §7.4。
 *
 * `static-checks.ts`（汎用6件）と `plc-static-checks.ts`（モードD3件）が互いを必要とするため、
 * 型はどちらにも属さないここに置く。`import-x/no-cycle` は型だけの往復も循環と見なすので、
 * この切り出しは必須である。
 */

export type { StaticCheckId };

/** チェック1件の結果。§7.4 */
export interface StaticCheckResult {
  id: StaticCheckId;
  ok: boolean;
  message: string;
  details: string[];
  issues?: readonly {
    code: string;
    terminals: readonly string[];
    wireIds: readonly string[];
    expected: string;
    observed: string;
  }[];
}

/**
 * モードDの静的チェックに要る文脈。§10.2
 * `roles` はどの静的チェックも読まない（配線の判定は `unit` / `io` とネットリストだけで足りる）。
 * Plan 3B が使う可能性があるためフィールドごと削除はせず、任意化だけしておく（レビュー反映）。
 */
export interface PlcCheckContext {
  unit: PlcUnitDefinition;
  io: ResolvedPlcIo;
  roles?: SocketRoles;
}

/** チェックの入力（訓練者側の盤・ネットリスト・再生結果）。 */
export interface StaticCheckInput {
  session: BoardSession;
  netlist: Netlist;
  log: SignalLog;
  hazards: readonly HazardEvent[];
  chatters: readonly ChatterEvent[];
  /** 新規配線に使ってよい線色。モードB・Dは青のみ、モードC2は白のみ。§8.1 */
  allowedColors: readonly WireColor[];
  /**
   * 課題の開始時点で既に盤にあった電線のID。線色の検査から外す。§9.2
   * モードC2は「初期配線は青のまま・修復だけ白」なので、残っている青線を違反にしない。
   * モードBでは渡さない（訓練者が引いた電線しか無いため）。
   */
  preexistingWireIds?: ReadonlySet<string>;
  /**
   * モードDの文脈（PLC本体・I/O割付・ソケット役割）。§10.2
   * `twoStage` / `plcPowerIndependent` / `ioAssignment` を有効にするときは必須である。
   */
  plc?: PlcCheckContext;
}
