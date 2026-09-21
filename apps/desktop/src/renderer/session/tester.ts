import type { TerminalId } from '@ojt/circuit-sim';
import type { ProbeSide } from '../app/store-types.js';
import type { PickAction, PickHit } from './interaction.js';

/**
 * テスターのプローブ配置。設計仕様 §9.3 / §12.2。
 * 3D も React も使わないので Vitest だけで全分岐を検証できる（§14.2）。
 *
 * §9.3 は「プローブは黒 → 赤 の順に端子をクリックして配置する」と定める。ここでは
 * 「次に置く側」（`next`）を状態に持たせ、置くたびに黒→赤→黒…と巡らせることで
 * その順序を既定にしつつ、パネルのボタンで明示的に選び直せる逃げ道も残す。
 *
 * §9.3 の「配置済みプローブはドラッグで付け替える」は、**クリックで外す → クリックで置く**
 * に置き換えた。3Dビューポートでのドラッグは `OrbitControls` の回転と取り合いになり、
 * 端子1個（当たり判定4mm）を掴んだまま別の端子へ運ぶ操作は内蔵GPUの画面では現実的でない。
 */

/** プローブの側（定義は `store-types.ts` の1箇所だけ。Plan 2B Task 4 Step 3）。 */
export type { ProbeSide };

/** プローブ配置の判断に要る状態だけを抜き出したもの。 */
export interface TesterPickState {
  /** 黒プローブを置いた端子（物理端子ID）。 */
  black: TerminalId | undefined;
  /** 赤プローブを置いた端子（物理端子ID）。 */
  red: TerminalId | undefined;
  /** 次に置くプローブ。 */
  next: ProbeSide;
}

/** 黒 → 赤 → 黒 … と巡る。§9.3 */
export function nextProbeAfter(probe: ProbeSide): ProbeSide {
  return probe === 'black' ? 'red' : 'black';
}

/** その端子にプローブが載っていれば側を返す。 */
export function probeSideAt(state: TesterPickState, terminal: TerminalId): ProbeSide | undefined {
  if (state.black === terminal) return 'black';
  if (state.red === terminal) return 'red';
  return undefined;
}

/**
 * ピック結果をテスターの操作に変換する。§9.3
 * - 端子: 既にプローブが載っていれば外し、載っていなければ `next` の側を置く
 * - 押ボタン: 押す（§9.1 は赤PBで励磁しながら測る手順を要求する）
 * - 空クリック: 置いてあるプローブを両方外す
 * - 電線・ソケット: 何もしない（テスターは測るだけで盤を変えない）
 *
 * **`terminal.wirable` は見ない。** 配線できない本体側の端子（`CHK.9` など既設配線済みの
 * ピン）こそ §9.1 測定2 が測る対象であり、そこにプローブを当てられなければ点検できない。
 */
export function testerPickToAction(state: TesterPickState, hit: PickHit): PickAction {
  switch (hit.kind) {
    case 'terminal': {
      const side = probeSideAt(state, hit.id);
      if (side !== undefined) return { type: 'liftProbe', probe: side };
      return { type: 'placeProbe', probe: state.next, terminal: hit.id };
    }
    case 'pushbutton':
      return { type: 'pressButton', pbId: hit.id };
    case 'empty':
      return state.black === undefined && state.red === undefined
        ? { type: 'none' }
        : { type: 'liftProbe', probe: 'both' };
    case 'fixture':
      return { type: 'togglePower', fixture: hit.fixture };
    case 'wire':
    case 'socket':
      return { type: 'none' };
  }
}

/** キーボードでできるテスター操作。§8.2 / §9.3 */
export type TesterShortcut =
  { type: 'zero-adjust' } | { type: 'next-probe'; probe: ProbeSide } | { type: 'lift-both' };

/**
 * キー1つをテスター操作に直す（知らないキーは undefined）。§8.2 / §15 アクセシビリティ
 *
 * 割当: `b`＝次は黒プローブ、`r`＝次は赤プローブ、`0`＝0Ω調整、`Escape`＝両方外す。
 * 視点（上段 1/2/3・テンキー・Home）は画面に依存しない `useViewportShortcuts()` の担当、
 * 削除（`Delete`）は盤側の割当（Plan 1D1）なのでここでは扱わない。
 */
export function testerShortcut(key: string): TesterShortcut | undefined {
  switch (key.toLowerCase()) {
    case 'b':
      return { type: 'next-probe', probe: 'black' };
    case 'r':
      return { type: 'next-probe', probe: 'red' };
    case '0':
      return { type: 'zero-adjust' };
    case 'escape':
      return { type: 'lift-both' };
    default:
      return undefined;
  }
}
