import {
  COIL_COL,
  cellAt,
  compile,
  createPlcRuntime,
  empty,
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  X,
  Y,
  type LadderProgram,
  type PlcIoPort,
} from '@ojt/ladder-core';
import type { ShortcutTable } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import {
  applyLadderCell,
  applyOrContact,
  applyRuleLine,
  clearLadderCell,
  emptyLadderHistory,
  hasLadderContent,
  initialLadder,
  keyChord,
  ladderKeyToAction,
  LADDER_HISTORY_LIMIT,
  matchShortcut,
  moveCursor,
  nextNetworkId,
  pushLadder,
  redoLadder,
  shortcutKeyOf,
  togglePulseAt,
  toggleNoNcAt,
  undoLadder,
  type LadderCursor,
} from '../src/renderer/session/ladder.js';

/** 本物のプロファイルに依存しない最小のショートカット表（決定表#12 の入替可能性を見る）。 */
const TABLE: ShortcutTable = [
  { action: 'contact-no', keys: 'F5', label: 'a接点', confirmed: true },
  { action: 'contact-nc', keys: 'F6', label: 'b接点', confirmed: false },
  { action: 'or-contact-no', keys: 'Shift+F5', label: 'OR a接点', confirmed: false },
  { action: 'coil', keys: 'F7', label: 'コイル', confirmed: true },
  {
    action: 'application',
    keys: 'F8',
    label: '応用命令',
    confirmed: true,
    enabled: false,
    note: 'Phase 4',
  },
  { action: 'hline', keys: 'F9', label: '横線', confirmed: false },
  { action: 'rule-line', keys: 'Ctrl+←↑↓→', label: '罫線', confirmed: true },
  { action: 'convert', keys: 'F4', label: '変換', confirmed: false },
  { action: 'toggle-no-nc', keys: '/', label: '切換', confirmed: true },
  { action: 'toggle-pulse', keys: 'Alt+/', label: '微分切換', confirmed: true },
  { action: 'monitor', keys: 'F3', label: 'モニタ', confirmed: true },
  { action: 'insert-toggle', keys: 'Ins', label: '挿入・上書きの切換', confirmed: true },
];

function twoRungs(): LadderProgram {
  return program(
    network('n1', [[no(X(0)), hline(), out(Y(0))]]),
    network('n2', [[no(X(1)), out(Y(1))]]),
    endNetwork(),
  );
}

const at = (networkId: string, row: number, col: number): LadderCursor => ({ networkId, row, col });

describe('initialLadder（決定表#14: 模範ラダーは出さない）', () => {
  it('starts from one empty network plus END', () => {
    const p = initialLadder();
    expect(p.networks.map((n) => n.id)).toEqual(['n1', 'end']);
    expect(cellAt(p.networks[0]!, 0, 0)).toEqual(empty());
    expect(p.networks[0]!.cols).toBe(IR_COLS);
  });

  it('numbers a new network above the highest existing one (決定表#15)', () => {
    expect(nextNetworkId(twoRungs())).toBe('n3');
    expect(nextNetworkId(initialLadder())).toBe('n2');
  });
});

describe('keyChord / matchShortcut（決定表#12）', () => {
  it('builds the chord text the shortcut table uses', () => {
    expect(keyChord({ key: 'F5' })).toBe('F5');
    expect(keyChord({ key: 'F5', shiftKey: true })).toBe('Shift+F5');
    expect(keyChord({ key: '/', altKey: true })).toBe('Alt+/');
    expect(keyChord({ key: 'ArrowLeft', ctrlKey: true })).toBe('Ctrl+ArrowLeft');
  });

  it('matches plain and modified function keys', () => {
    expect(matchShortcut(TABLE, { key: 'F5' })?.action).toBe('contact-no');
    expect(matchShortcut(TABLE, { key: 'F5', shiftKey: true })?.action).toBe('or-contact-no');
    expect(matchShortcut(TABLE, { key: 'F5', ctrlKey: true })).toBeUndefined();
  });

  it('expands the arrow set of the rule-line entry', () => {
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight']) {
      expect(matchShortcut(TABLE, { key, ctrlKey: true })?.action).toBe('rule-line');
    }
  });

  it('is driven by the table, not by hard-coded keys', () => {
    const swapped: ShortcutTable = [
      { action: 'coil', keys: 'F5', label: 'コイル', confirmed: false },
    ];
    expect(matchShortcut(swapped, { key: 'F5' })?.action).toBe('coil');
  });

  it('reads the short names the skin uses (Ins / Del / Esc) as real KeyboardEvent.key values', () => {
    // `KeyboardEvent.key` は 'Insert'。表の 'Ins' をそのまま比べると永久に一致しない
    expect(matchShortcut(TABLE, { key: 'Insert' })?.action).toBe('insert-toggle');
    expect(matchShortcut(TABLE, { key: 'Ins' })).toBeUndefined();
  });

  /**
   * 指摘 LE-1（Critical）: 実ブラウザで `C` キーを押すと `event.key` は小文字 `'c'` で来る
   * （`Shift+C` なら大文字）。方言表は大文字で書いてあるので、大小文字を畳まないと
   * OMRON のようなキー1文字割当のスキンでは1行も一致しない。
   */
  it('folds a single-letter key so a lowercase browser event still matches an uppercase table entry', () => {
    const singleLetter: ShortcutTable = [
      { action: 'contact-no', keys: 'C', label: 'a接点', confirmed: true },
    ];
    expect(matchShortcut(singleLetter, { key: 'c' })?.action).toBe('contact-no');
    expect(matchShortcut(singleLetter, { key: 'C' })?.action).toBe('contact-no');
  });

  it('does not fold multi-character keys (function keys stay exact)', () => {
    // `f5` のような入力は実ブラウザで起きない。機能キーは畳まない
    expect(matchShortcut(TABLE, { key: 'f5' })).toBeUndefined();
  });
});

describe('ladderKeyToAction', () => {
  const state = { cursor: at('n1', 0, 0), mode: 'write' as const };

  it('turns the table entries into actions', () => {
    expect(ladderKeyToAction(TABLE, { key: 'F5' }, state)).toEqual({
      type: 'place',
      kind: 'contact-no',
    });
    expect(ladderKeyToAction(TABLE, { key: 'F7' }, state)).toEqual({ type: 'place', kind: 'coil' });
    expect(ladderKeyToAction(TABLE, { key: 'F4' }, state)).toEqual({ type: 'convert' });
    expect(ladderKeyToAction(TABLE, { key: 'F3' }, state)).toEqual({
      type: 'setMode',
      mode: 'monitor',
    });
    expect(ladderKeyToAction(TABLE, { key: 'ArrowRight', ctrlKey: true }, state)).toEqual({
      type: 'ruleLine',
      direction: 'right',
    });
  });

  it('reports a disabled entry instead of doing nothing silently (F8)', () => {
    const action = ladderKeyToAction(TABLE, { key: 'F8' }, state);
    expect(action.type).toBe('disabled');
    if (action.type !== 'disabled') return;
    expect(action.entry.note).toContain('Phase 4');
  });

  it('moves with the bare arrow keys and Tab', () => {
    expect(ladderKeyToAction(TABLE, { key: 'ArrowRight' }, state)).toEqual({
      type: 'move',
      dRow: 0,
      dCol: 1,
    });
    expect(ladderKeyToAction(TABLE, { key: 'Tab' }, state)).toEqual({
      type: 'move',
      dRow: 0,
      dCol: 1,
    });
    expect(ladderKeyToAction(TABLE, { key: 'Tab', shiftKey: true }, state)).toEqual({
      type: 'move',
      dRow: 0,
      dCol: -1,
    });
  });

  it('opens the device input on Enter and clears on Delete', () => {
    expect(ladderKeyToAction(TABLE, { key: 'Enter' }, state)).toEqual({ type: 'edit' });
    expect(ladderKeyToAction(TABLE, { key: 'Delete' }, state)).toEqual({ type: 'delete' });
    expect(ladderKeyToAction(TABLE, { key: 'Backspace' }, state)).toEqual({ type: 'delete' });
  });

  it('turns the real Insert key into toggleInsert（B6）', () => {
    expect(ladderKeyToAction(TABLE, { key: 'Insert' }, state)).toEqual({ type: 'toggleInsert' });
  });

  it('routes Ctrl+Z / Ctrl+Y to the ladder history (決定表#3)', () => {
    expect(ladderKeyToAction(TABLE, { key: 'z', ctrlKey: true }, state)).toEqual({ type: 'undo' });
    expect(ladderKeyToAction(TABLE, { key: 'y', ctrlKey: true }, state)).toEqual({ type: 'redo' });
    expect(ladderKeyToAction(TABLE, { key: 'Z', ctrlKey: true, shiftKey: true }, state)).toEqual({
      type: 'redo',
    });
  });

  it('refuses every edit while the editor is in read or monitor mode (決定表#11)', () => {
    for (const mode of ['read', 'monitor'] as const) {
      const readonlyState = { cursor: at('n1', 0, 0), mode };
      expect(ladderKeyToAction(TABLE, { key: 'F5' }, readonlyState)).toEqual({ type: 'readOnly' });
      expect(ladderKeyToAction(TABLE, { key: 'Delete' }, readonlyState)).toEqual({
        type: 'readOnly',
      });
      // 移動と変換とモード切替は読出し中でも通す
      expect(ladderKeyToAction(TABLE, { key: 'ArrowDown' }, readonlyState)).toEqual({
        type: 'move',
        dRow: 1,
        dCol: 0,
      });
      expect(ladderKeyToAction(TABLE, { key: 'F4' }, readonlyState)).toEqual({ type: 'convert' });
    }
  });
});

describe('moveCursor', () => {
  const p = twoRungs();

  it('clamps inside the row', () => {
    expect(moveCursor(p, at('n1', 0, 0), 0, -1)).toEqual(at('n1', 0, 0));
    expect(moveCursor(p, at('n1', 0, COIL_COL), 0, 1)).toEqual(at('n1', 0, COIL_COL));
  });

  it('walks to the neighbouring network at the top and bottom edges', () => {
    expect(moveCursor(p, at('n2', 0, 3), -1, 0)).toEqual(at('n1', 0, 3));
    expect(moveCursor(p, at('n1', 0, 3), 1, 0)).toEqual(at('n2', 0, 3));
    // 先頭より上・末尾より下へは出ない（END ネットワークも行き先になる）
    expect(moveCursor(p, at('n1', 0, 3), -1, 0)).toEqual(at('n1', 0, 3));
    expect(moveCursor(p, at('end', 0, 0), 1, 0)).toEqual(at('end', 0, 0));
  });

  it('keeps the column inside the shorter network', () => {
    expect(moveCursor(p, at('n1', 0, COIL_COL), 1, 0)).toEqual(at('n2', 0, COIL_COL));
  });

  describe('gridCols（レビュー指摘 I1）', () => {
    // `profile.gridCols`（11）だけ描く画面では、非表示の列11〜14を飛び越えてコイル列へ移りたい。
    const gridCols = 11;

    it('jumps right from the last visible contact column straight to the coil column', () => {
      expect(moveCursor(p, at('n1', 0, gridCols - 1), 0, 1, gridCols)).toEqual(
        at('n1', 0, COIL_COL),
      );
    });

    it('jumps left from the coil column straight to the last visible contact column', () => {
      expect(moveCursor(p, at('n1', 0, COIL_COL), 0, -1, gridCols)).toEqual(
        at('n1', 0, gridCols - 1),
      );
    });

    it('defaults to COIL_COL when gridCols is omitted (既定の呼び出しは変えない)', () => {
      expect(moveCursor(p, at('n1', 0, COIL_COL - 1), 0, 1)).toEqual(at('n1', 0, COIL_COL));
      expect(moveCursor(p, at('n1', 0, COIL_COL), 0, -1)).toEqual(at('n1', 0, COIL_COL - 1));
    });
  });
});

describe('applyLadderCell / clearLadderCell', () => {
  it('places a cell and leaves the original program untouched', () => {
    const before = twoRungs();
    const result = applyLadderCell(before, at('n1', 0, 1), no(X(2)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(cellAt(result.program.networks[0]!, 0, 1)).toEqual(no(X(2)));
    expect(cellAt(before.networks[0]!, 0, 1)).toEqual(hline());
  });

  it('returns the LadderError message instead of throwing', () => {
    const result = applyLadderCell(twoRungs(), at('n1', 9, 0), no(X(0)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('行 9');
  });

  it('clears a cell', () => {
    const result = clearLadderCell(twoRungs(), at('n1', 0, 0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(cellAt(result.program.networks[0]!, 0, 0)).toEqual(empty());
  });

  it('returns ok:false instead of throwing for an out-of-range row in insert mode (レビュー指摘 M1)', () => {
    const result = applyLadderCell(twoRungs(), at('n1', 9, 0), no(X(0)), true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('範囲外');
  });

  /**
   * 指摘 LE-9: `edit.ts` の `setVerticalLink()` は「罫線は空セル・横線・縦線の上にだけ
   * 引けます: n1 (0, 0) は contact」のようにネットワークIDとセル座標を埋め込んで投げる。
   * `guard()`（`session/ladder.ts`）はこれを `friendlyLadderErrorMessage()` に通して
   * 内部識別子を追い出す。
   */
  it('replaces the raw internal-id message when a rule-line targets an occupied cell (LE-9)', () => {
    const withContacts = program(network('n1', [[no(X(0))], [no(X(1))]]), endNetwork());
    const result = applyRuleLine(withContacts, at('n1', 0, 0), 'down');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('罫線は空セル・横線・縦線の上にだけ引けます');
    expect(result.message).not.toContain('n1');
    expect(result.message).not.toContain('contact');
  });
});

describe('applyOrContact（並列分岐）', () => {
  it('branches from the left rail when the contact is in column 0', () => {
    const result = applyOrContact(twoRungs(), at('n1', 0, 0), no(Y(0)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const net = result.program.networks[0]!;
    expect(net.rows).toBe(2);
    expect(cellAt(net, 1, 0)).toEqual(no(Y(0)));
    // 右側だけ罫線を引く（左は0列目の左母線が全行を繋いでいる）
    expect(cellAt(net, 0, 1).kind).toBe('vline');
  });

  it('draws both rule lines when the contact is not in column 0', () => {
    const base = program(network('n1', [[hline(), no(X(0)), hline(), out(Y(0))]]), endNetwork());
    const result = applyOrContact(base, at('n1', 0, 1), no(Y(0)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const net = result.program.networks[0]!;
    expect(cellAt(net, 0, 0).kind).toBe('vline');
    expect(cellAt(net, 1, 0).kind).toBe('hline');
    expect(cellAt(net, 1, 1)).toEqual(no(Y(0)));
    expect(cellAt(net, 0, 2).kind).toBe('vline');
  });

  it('refuses to branch where the left neighbour is a contact', () => {
    const base = program(network('n1', [[no(X(0)), no(X(1)), out(Y(0))]]), endNetwork());
    const result = applyOrContact(base, at('n1', 0, 1), no(Y(0)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('罫線');
  });

  it('refuses to branch in the column just before the coil column', () => {
    const result = applyOrContact(twoRungs(), at('n1', 0, COIL_COL - 1), no(Y(0)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('コイル列');
  });

  /**
   * 指摘 LE-5: `applyOrContact()` は閉じ側の縦線を `cursor.col + 1` に引く。`LadderEditor` の
   * `onCommit` はこの直後にカーソルを送るが、+1（縦線の上）のままだと続けて記号を置いたときに
   * 縦線を上書きして下の行の分岐が孤立する。+2（縦線の次）へ送れば空セルに着地する。
   */
  it('draws the closing vline one column right, so a 2-column cursor step lands past it', () => {
    const result = applyOrContact(twoRungs(), at('n1', 0, 0), no(Y(0)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const net = result.program.networks[0]!;
    const afterOneStep = moveCursor(result.program, at('n1', 0, 0), 0, 1);
    expect(cellAt(net, afterOneStep.row, afterOneStep.col).kind).toBe('vline');
    const afterTwoSteps = moveCursor(result.program, at('n1', 0, 0), 0, 2);
    expect(cellAt(net, afterTwoSteps.row, afterTwoSteps.col).kind).not.toBe('vline');
  });
});

describe('toggleNoNcAt / togglePulseAt', () => {
  it('swaps a and b contacts', () => {
    const toggled = toggleNoNcAt(twoRungs(), at('n1', 0, 0));
    expect(toggled.ok).toBe(true);
    if (!toggled.ok) return;
    expect(cellAt(toggled.program.networks[0]!, 0, 0)).toMatchObject({ type: 'NC' });
  });

  it('cycles the differential and SET/RST forms', () => {
    let p = twoRungs();
    const step = (cursor: LadderCursor): string => {
      const result = togglePulseAt(p, cursor);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      p = result.program;
      const cell = cellAt(p.networks[0]!, cursor.row, cursor.col);
      return 'type' in cell ? cell.type : cell.kind;
    };
    expect(step(at('n1', 0, 0))).toBe('P');
    expect(step(at('n1', 0, 0))).toBe('NO');
    expect(step(at('n1', 0, 2))).toBe('SET');
    expect(step(at('n1', 0, 2))).toBe('RST');
    expect(step(at('n1', 0, 2))).toBe('OUT');
  });

  it('says why nothing happens on a blank cell', () => {
    const result = toggleNoNcAt(twoRungs(), at('n1', 0, 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('接点');
  });
});

describe('ラダーの取り消し／やり直し（決定表#2）', () => {
  it('walks back and forward through the snapshots', () => {
    const first = twoRungs();
    const edited = applyLadderCell(first, at('n1', 0, 1), no(X(5)));
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const history = pushLadder(emptyLadderHistory(), first);
    const back = undoLadder(history, edited.program);
    expect(back?.program).toBe(first);
    const forward = redoLadder(back!.history, first);
    expect(forward?.program).toBe(edited.program);
  });

  it('drops the oldest snapshot past the limit and clears the redo列', () => {
    let history = emptyLadderHistory();
    for (let i = 0; i < LADDER_HISTORY_LIMIT + 5; i += 1) history = pushLadder(history, twoRungs());
    expect(history.done).toHaveLength(LADDER_HISTORY_LIMIT);
    expect(history.undone).toEqual([]);
  });

  it('returns undefined when there is nothing to undo', () => {
    expect(undoLadder(emptyLadderHistory(), twoRungs())).toBeUndefined();
    expect(redoLadder(emptyLadderHistory(), twoRungs())).toBeUndefined();
  });
});

describe('hasLadderContent（Batch 4+5 レビュー B2）', () => {
  it('says false for undefined and for the initial (empty + END) ladder', () => {
    expect(hasLadderContent(undefined)).toBe(false);
    expect(hasLadderContent(initialLadder())).toBe(false);
  });

  it('says true once a real cell (contact/coil/…) is placed', () => {
    expect(hasLadderContent(twoRungs())).toBe(true);
  });
});

describe('shortcutKeyOf（決定表#12 / Batch 4+5 レビュー M9）', () => {
  it('finds the key string for a known action', () => {
    expect(shortcutKeyOf({ shortcuts: TABLE } as never, 'convert')).toBe('F4');
  });

  it('returns undefined for an action not in the table', () => {
    expect(shortcutKeyOf({ shortcuts: TABLE } as never, 'no-such-action')).toBeUndefined();
  });
});

describe('コイルの自動結線（GX Works3 と同じ「置いたら繋がる」）', () => {
  /** 入力を差し替えられる最小の `PlcIoPort`。 */
  class Io implements PlcIoPort {
    inputs: boolean[] = [false, false, false, false];
    outputs: boolean[] = [];
    readInputs(): readonly boolean[] {
      return this.inputs;
    }
    writeOutputs(values: readonly boolean[]): void {
      this.outputs = [...values];
    }
  }

  /** 組んだラダーを変換して走らせ、X0 を押したときの Y0 を返す。 */
  function y0WhenX0On(source: LadderProgram): boolean {
    const compiled = compile(source);
    expect(compiled.ok, compiled.ok ? '' : (compiled.errors[0]?.message ?? '')).toBe(true);
    if (!compiled.ok) return false;
    const io = new Io();
    const runtime = createPlcRuntime(compiled.program, { io });
    runtime.scan();
    io.inputs[0] = true;
    runtime.scan();
    return io.outputs[0] === true;
  }

  /** 1行だけの空のネットワーク（＋END）。訓練者がセッションを始めた直後の姿。 */
  function blank(): LadderProgram {
    return program(network('n1', [[empty()]]), endNetwork());
  }

  it('fills columns 1〜14 when a coil is placed after a contact in column 0', () => {
    const withContact = applyLadderCell(blank(), at('n1', 0, 0), no(X(0)));
    expect(withContact.ok).toBe(true);
    if (!withContact.ok) return;
    const withCoil = applyLadderCell(withContact.program, at('n1', 0, COIL_COL), out(Y(0)));
    expect(withCoil.ok).toBe(true);
    if (!withCoil.ok) return;
    const net = withCoil.program.networks[0]!;
    for (let col = 1; col < COIL_COL; col += 1) expect(cellAt(net, 0, col)).toEqual(hline());
    // 表示列数 11 のままでも導通する（これが直っていないと訓練者は永久に合格できない）
    expect(y0WhenX0On(withCoil.program)).toBe(true);
  });

  it('keeps an OR branch conducting once the coil is placed', () => {
    const withContact = applyLadderCell(blank(), at('n1', 0, 0), no(X(0)));
    expect(withContact.ok).toBe(true);
    if (!withContact.ok) return;
    // 自己保持（Shift+F5）: 0列目から下へ分岐して Y0 のa接点を置く
    const branched = applyOrContact(withContact.program, at('n1', 0, 0), no(Y(0)));
    expect(branched.ok).toBe(true);
    if (!branched.ok) return;
    const withCoil = applyLadderCell(branched.program, at('n1', 0, COIL_COL), out(Y(0)));
    expect(withCoil.ok).toBe(true);
    if (!withCoil.ok) return;
    const net = withCoil.program.networks[0]!;
    // 分岐の縦線（1列目）は残り、その右だけが横線で埋まる
    expect(cellAt(net, 0, 1).kind).toBe('vline');
    expect(cellAt(net, 0, 2)).toEqual(hline());
    expect(y0WhenX0On(withCoil.program)).toBe(true);
  });

  it('fills only the columns right of the rightmost symbol', () => {
    let built = blank();
    for (const [col, cell] of [
      [0, no(X(0))],
      [5, no(X(1))],
    ] as const) {
      const step = applyLadderCell(built, at('n1', 0, col), cell);
      expect(step.ok).toBe(true);
      if (!step.ok) return;
      built = step.program;
    }
    const withCoil = applyLadderCell(built, at('n1', 0, COIL_COL), out(Y(0)));
    expect(withCoil.ok).toBe(true);
    if (!withCoil.ok) return;
    const net = withCoil.program.networks[0]!;
    // 1〜4列目は訓練者が空けたまま（勝手に繋がない）。6〜14列目だけ埋まる
    for (let col = 1; col < 5; col += 1) expect(cellAt(net, 0, col)).toEqual(empty());
    for (let col = 6; col < COIL_COL; col += 1) expect(cellAt(net, 0, col)).toEqual(hline());
  });

  it('undoes the coil and its auto-filled hlines in one step (決定表#2)', () => {
    const withContact = applyLadderCell(blank(), at('n1', 0, 0), no(X(0)));
    expect(withContact.ok).toBe(true);
    if (!withContact.ok) return;
    const before = withContact.program;
    const withCoil = applyLadderCell(before, at('n1', 0, COIL_COL), out(Y(0)));
    expect(withCoil.ok).toBe(true);
    if (!withCoil.ok) return;
    const back = undoLadder(pushLadder(emptyLadderHistory(), before), withCoil.program);
    const net = back!.program.networks[0]!;
    expect(cellAt(net, 0, COIL_COL)).toEqual(empty());
    expect(cellAt(net, 0, 1)).toEqual(empty());
  });

  it('still refuses to insert when a real symbol sits in the last contact column', () => {
    const row = [no(X(0)), ...Array.from({ length: COIL_COL - 2 }, () => hline()), no(X(1))];
    const blocked = program(network('n1', [row]), endNetwork());
    const result = applyLadderCell(blocked, at('n1', 0, 1), no(X(2)), true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('右端が埋まっている');
  });

  it('treats an auto-filled hline in the last contact column as free space', () => {
    const withContact = applyLadderCell(blank(), at('n1', 0, 0), no(X(0)));
    expect(withContact.ok).toBe(true);
    if (!withContact.ok) return;
    const withCoil = applyLadderCell(withContact.program, at('n1', 0, COIL_COL), out(Y(0)));
    expect(withCoil.ok).toBe(true);
    if (!withCoil.ok) return;
    const inserted = applyLadderCell(withCoil.program, at('n1', 0, 1), no(X(1)), true);
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const net = inserted.program.networks[0]!;
    expect(cellAt(net, 0, 1)).toEqual(no(X(1)));
    expect(cellAt(net, 0, COIL_COL - 1)).toEqual(hline());
    expect(y0WhenX0On(inserted.program)).toBe(false);
    // X1 も入れれば通電する（押し出された横線がコイルまで繋がったまま）
    const io = { inputs: [true, true, false, false] };
    const compiled = compile(inserted.program);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const port = new Io();
    port.inputs = io.inputs;
    const runtime = createPlcRuntime(compiled.program, { io: port });
    runtime.scan();
    expect(port.outputs[0]).toBe(true);
  });
});
