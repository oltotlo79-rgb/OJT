import {
  JIPM_BOARD,
  N_RAIL_ID,
  P_RAIL_ID,
  pinRole,
  SOCKET_PIN_COUNT,
  type BoardDefinition,
} from '@ojt/board-model';
import type { Netlist, TerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  buildPlcReferenceSession,
  buildReferenceSession,
  plcBoardFor,
} from '@ojt/content';
import { describe, expect, it } from 'vitest';
import {
  busSideOfRole,
  coilBusSide,
  COIL_N_PIN,
  COIL_P_PIN,
  COIL_PINS,
  pinGroup,
  type BusSide,
} from '../src/renderer/session/socket-pins.js';

/**
 * コイルとランプの極性（どちらの端子が P(+24V) 側か）。利用者指摘 2026-09-20
 * 「リレーソケットの13、14番の端子にコイルとしか書いてないがこれではどちらがPかNか分からない。
 * ランプも同様」。
 *
 * 画面に出す向き（`session/socket-pins.ts` の `COIL_P_PIN` / `COIL_N_PIN`）は**決め打ちの定数**
 * なので、盤や課題の側が変わったときに黙って嘘になりうる。このテストは同じ向きを
 * **アプリが持つ回路そのものから3通りに導き直し**、定数と食い違ったら落ちる。
 *
 * 1. 盤定義の役割（`pinRole()` が ⑭ を `coil+`、⑬ を `coil-` とする）
 * 2. 盤の既設配線（§6.3 のチェック用回路。⑭ が押ボタン経由で P、⑬ が直に N）
 * 3. 内蔵課題の模範回路すべて（モードB・C2・D）の**つながり方**
 *
 * 3 は「負荷（コイル・ランプ・ブザー）と電源をいったん取り除いた回路」で、
 * 負荷の `+` 側の端子から P 母線だけに、`−` 側の端子から N 母線だけに着けるかを見る。
 * 接点は開閉を問わず導通しているものとして扱う（見たいのは**つなぎ方**であって動作ではない）。
 */

/** 極性を持つ負荷1個ぶんの導出結果。 */
interface PolarityRow {
  problemId: string;
  partId: string;
  load: string;
  plusTerminal: TerminalId;
  minusTerminal: TerminalId;
  plusSide: string;
  minusSide: string;
}

/** 電線・既設リンク・接点だけを通って `start` から行ける端子（負荷と電源は通らない）。 */
function reachable(netlist: Netlist, start: TerminalId): Set<string> {
  const adjacency = new Map<string, string[]>();
  const join = (a: string, b: string): void => {
    const listA = adjacency.get(a) ?? [];
    listA.push(b);
    adjacency.set(a, listA);
    const listB = adjacency.get(b) ?? [];
    listB.push(a);
    adjacency.set(b, listB);
  };
  for (const wire of netlist.wires) join(wire.from, wire.to);
  for (const link of netlist.links) join(link.from, link.to);
  for (const part of netlist.parts) {
    for (const element of part.elements) {
      // 負荷（コイル・ランプ・ブザー・PLC入力）と電源は通り抜けさせない。
      // これを通すと P と N がつながってしまい「どちら側か」が決まらない
      if (element.kind === 'load' || element.kind === 'source') continue;
      join(element.from, element.to);
    }
  }
  const seen = new Set<string>([start]);
  const stack: string[] = [start];
  for (;;) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

/** 行ける端子の集合が P 母線／N 母線のどちらに着くか（`P` / `N` / `両方` / `どちらでもない`）。 */
function sideOf(reached: Set<string>): string {
  const terminals = [...reached];
  const p = terminals.some((id) => id.startsWith(`${P_RAIL_ID}.`));
  const n = terminals.some((id) => id.startsWith(`${N_RAIL_ID}.`));
  if (p && n) return '両方';
  if (p) return 'P';
  if (n) return 'N';
  return 'どちらでもない';
}

/** 模範回路1つぶんの、極性を持つ負荷の導出結果。 */
function rowsOf(problemId: string, netlist: Netlist): PolarityRow[] {
  const out: PolarityRow[] = [];
  for (const part of netlist.parts) {
    if (
      part.meta.kind !== 'relay-my4n' &&
      part.meta.kind !== 'timer-h3y4' &&
      part.meta.kind !== 'lamp' &&
      part.meta.kind !== 'buzzer'
    ) {
      continue;
    }
    for (const element of part.elements) {
      if (element.kind !== 'load') continue;
      out.push({
        problemId,
        partId: part.id,
        load: element.load,
        plusTerminal: element.from,
        minusTerminal: element.to,
        plusSide: sideOf(reachable(netlist, element.from)),
        minusSide: sideOf(reachable(netlist, element.to)),
      });
    }
  }
  return out;
}

/** 内蔵課題すべての模範回路（モードB 8題・C2 8題・D 8題）から導いた表。 */
function derivedRows(): PolarityRow[] {
  const out: PolarityRow[] = [];
  for (const problem of [...BUILTIN_ASSEMBLE_PROBLEMS, ...BUILTIN_INSPECT_REPAIR_PROBLEMS]) {
    const built = buildReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(`${problem.id} の模範回路が組めません`);
    out.push(...rowsOf(problem.id, built.value.netlist));
  }
  for (const problem of BUILTIN_PLC_PROBLEMS) {
    const board: BoardDefinition | undefined = plcBoardFor(problem, JIPM_BOARD);
    if (board === undefined) throw new Error(`${problem.id} のPLC盤が作れません`);
    const built = buildPlcReferenceSession(problem, board);
    if (!built.ok) throw new Error(`${problem.id} の模範回路が組めません`);
    out.push(...rowsOf(problem.id, built.value.netlist));
  }
  return out;
}

/** 端子ID（`CR1.14`）のピン番号。ソケット以外の端子は undefined。 */
function pinOf(terminal: TerminalId): number | undefined {
  const name = terminal.split('.')[1];
  const pin = Number(name);
  return Number.isInteger(pin) && pin >= 1 && pin <= SOCKET_PIN_COUNT ? pin : undefined;
}

describe('コイルとランプの極性（利用者指摘 2026-09-20）', () => {
  it('①盤定義の役割が ⑭ = coil+ / ⑬ = coil− である', () => {
    expect(pinRole(COIL_P_PIN)).toBe('coil+');
    expect(pinRole(COIL_N_PIN)).toBe('coil-');
    expect([...COIL_PINS].sort((a, b) => a - b)).toEqual([COIL_N_PIN, COIL_P_PIN]);
    expect(coilBusSide(COIL_P_PIN)).toBe('P');
    expect(coilBusSide(COIL_N_PIN)).toBe('N');
    expect(() => coilBusSide(9)).toThrow();
  });

  it('①役割 → 母線の側の表が盤定義と一致し、交流のコンセントには極性を付けない', () => {
    expect(busSideOfRole('coil+')).toBe('P');
    expect(busSideOfRole('coil-')).toBe('N');
    expect(busSideOfRole('+')).toBe('P');
    expect(busSideOfRole('-')).toBe('N');
    for (const role of ['com', 'no', 'nc', 'c', 'a', 'b', 'ac', 'ac-l', 'ac-n'] as const) {
      expect(busSideOfRole(role), role).toBeUndefined();
    }
  });

  it('②盤の既設配線（チェック用回路）も ⑭ が P 側・⑬ が N 側である（§6.3）', () => {
    const netlist = buildReferenceSession(
      BUILTIN_ASSEMBLE_PROBLEMS[0] ??
        (() => {
          throw new Error('モードB課題がありません');
        })(),
      JIPM_BOARD,
    );
    if (!netlist.ok) throw new Error('模範回路が組めません');
    // CHK ソケットは既設配線だけでつながっている（課題の配線は触らない）
    expect(sideOf(reachable(netlist.value.netlist, 'CHK.14' as TerminalId))).toBe('P');
    expect(sideOf(reachable(netlist.value.netlist, 'CHK.13' as TerminalId))).toBe('N');
  });

  it('③内蔵課題すべての模範回路で、コイルの ⑭ が P に・⑬ が N に着く（反例なし）', () => {
    const rows = derivedRows().filter((row) => row.load === 'coil');
    expect(rows.length).toBeGreaterThanOrEqual(24);
    const contradictions = rows.filter(
      (row) =>
        pinOf(row.plusTerminal) !== COIL_P_PIN ||
        pinOf(row.minusTerminal) !== COIL_N_PIN ||
        row.plusSide !== 'P' ||
        row.minusSide !== 'N',
    );
    expect(
      contradictions.map(
        (row) =>
          `${row.problemId} ${row.partId}: ${row.plusTerminal}=${row.plusSide} / ${row.minusTerminal}=${row.minusSide}`,
      ),
    ).toEqual([]);
  });

  it('③ランプとブザーも `+` が P・`−` が N である（つないでいない機器は数えない）', () => {
    const rows = derivedRows().filter((row) => row.load === 'lamp' || row.load === 'buzzer');
    // 課題で使っていないランプは両端がどの母線にも着かない（回路に入っていない）ので外す
    const wired = rows.filter((row) => row.plusSide !== 'どちらでもない');
    expect(wired.length).toBeGreaterThanOrEqual(24);
    const contradictions = wired.filter(
      (row) =>
        !row.plusTerminal.endsWith('.+') ||
        !row.minusTerminal.endsWith('.-') ||
        row.plusSide !== 'P' ||
        row.minusSide !== 'N',
    );
    expect(
      contradictions.map(
        (row) =>
          `${row.problemId} ${row.partId}: ${row.plusTerminal}=${row.plusSide} / ${row.minusTerminal}=${row.minusSide}`,
      ),
    ).toEqual([]);
  });

  it('コイル以外のピンには母線の側が無い（`COM` を P 側と言わない）', () => {
    const sides: Array<BusSide | undefined> = [];
    for (let pin = 1; pin <= SOCKET_PIN_COUNT; pin += 1) {
      sides.push(pinGroup(pin) === 'coil' ? coilBusSide(pin) : undefined);
    }
    expect(sides.filter((side) => side !== undefined)).toEqual(['N', 'P']);
  });
});
