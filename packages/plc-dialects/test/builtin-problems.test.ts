import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COIL_COL,
  ctu,
  device,
  empty,
  end,
  fall,
  hline,
  IR_COLS,
  mc,
  mcr,
  nc,
  network,
  no,
  out,
  program,
  rise,
  rst,
  set,
  ton,
  vline,
  type Cell,
  type Device,
  type DeviceKind,
  type LadderProgram,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { availableDialects, instructionList } from '../src/index.js';

/**
 * 内蔵モードD課題8題（`@ojt/content` の `src/builtin/plc/*.json`）が4方言すべてで
 * 命令語リストに書き出せることを確かめる（レビュー M5(a)）。
 *
 * `@ojt/plc-dialects` の `package.json` は `@ojt/ladder-core` にしか依存しない（決定表#7）ので、
 * `@ojt/content` からは import しない。課題JSONを直接読み、`referenceLadder.networks` を
 * `@ojt/ladder-core` の生成関数（`no()` / `out()` / `ton()` / …）で組み立てなおす。パディング規則
 * （行末が出力セルなら横線で15列目まで押し出す）は `@ojt/content` の `schema/ladder.ts` の
 * `padRow()` と同じ規則を、ここでも独立に再現する。
 */

/** 課題JSONのデバイス表現。 */
interface JsonDevice {
  kind: DeviceKind;
  index: number;
}

/** 課題JSONのセル表現（`@ojt/content` の `CellSchema` と同じ形）。 */
interface JsonCell {
  kind: string;
  type?: string;
  device?: JsonDevice;
  presetMs?: number;
  preset?: number;
  resetDevice?: JsonDevice;
}

/** 課題JSONのネットワーク表現。 */
interface JsonNetwork {
  id: string;
  comment?: string;
  cells: JsonCell[][];
}

/** 課題JSONの参照ラダー部分。 */
interface JsonReferenceLadder {
  networks: JsonNetwork[];
}

function toDevice(raw: JsonDevice): Device {
  return device(raw.kind, raw.index);
}

const CONTACT_BUILDERS: Readonly<Record<string, (d: Device) => Cell>> = {
  NO: no,
  NC: nc,
  P: rise,
  F: fall,
};

const COIL_BUILDERS: Readonly<Record<string, (d: Device) => Cell>> = {
  OUT: out,
  SET: set,
  RST: rst,
};

/** 出力位置に置くセル種別（コイル・タイマ・カウンタ・MC/MCR）か。 */
function isOutputKind(kind: string): boolean {
  return (
    kind === 'coil' || kind === 'timer' || kind === 'counter' || kind === 'mc' || kind === 'mcr'
  );
}

/** JSONのセル1つを `@ojt/ladder-core` の生成関数で組み立てる。 */
function toCell(raw: JsonCell): Cell {
  switch (raw.kind) {
    case 'contact': {
      const build = CONTACT_BUILDERS[raw.type ?? ''];
      if (build === undefined || raw.device === undefined) {
        throw new Error(`未対応の接点セルです: ${JSON.stringify(raw)}`);
      }
      return build(toDevice(raw.device));
    }
    case 'coil': {
      const build = COIL_BUILDERS[raw.type ?? ''];
      if (build === undefined || raw.device === undefined) {
        throw new Error(`未対応のコイルセルです: ${JSON.stringify(raw)}`);
      }
      return build(toDevice(raw.device));
    }
    case 'timer':
      if (raw.device === undefined || raw.presetMs === undefined) {
        throw new Error(`不完全な timer セルです: ${JSON.stringify(raw)}`);
      }
      return ton(toDevice(raw.device), raw.presetMs);
    case 'counter':
      if (raw.device === undefined || raw.preset === undefined || raw.resetDevice === undefined) {
        throw new Error(`不完全な counter セルです: ${JSON.stringify(raw)}`);
      }
      return ctu(toDevice(raw.device), raw.preset, toDevice(raw.resetDevice));
    case 'mc':
      if (raw.device === undefined) throw new Error(`不完全な mc セルです: ${JSON.stringify(raw)}`);
      return mc(toDevice(raw.device));
    case 'mcr':
      if (raw.device === undefined)
        throw new Error(`不完全な mcr セルです: ${JSON.stringify(raw)}`);
      return mcr(toDevice(raw.device));
    case 'hline':
      return hline();
    case 'vline':
      return vline();
    case 'empty':
      return empty();
    case 'end':
      return end();
    default:
      throw new Error(`未対応のセル種別です: ${raw.kind}`);
  }
}

/**
 * 1行を16列に詰める。`@ojt/content` の `schema/ladder.ts` の `padRow()` と同じ規則:
 * 行末が出力セルなら、それをコイル列（15列目）へ送り、手前を横線で埋める。
 */
function padRow(cells: readonly JsonCell[]): Cell[] {
  const row = cells.map(toCell);
  const lastRaw = cells[cells.length - 1];
  if (lastRaw !== undefined && isOutputKind(lastRaw.kind) && row.length < IR_COLS) {
    const last = row.pop();
    while (row.length < COIL_COL) row.push(hline());
    if (last !== undefined) row.push(last);
    return row;
  }
  while (row.length < IR_COLS) row.push(empty());
  return row;
}

function toProgram(ladder: JsonReferenceLadder): LadderProgram {
  const nets = ladder.networks.map((net) =>
    network(
      net.id,
      net.cells.map(padRow),
      net.comment === undefined ? {} : { comment: net.comment },
    ),
  );
  return program(...nets);
}

/** `packages/content/src/builtin/plc/` を直接読む（import ではなくファイル読み込みだけ）。 */
const BUILTIN_DIR = fileURLToPath(new URL('../../content/src/builtin/plc/', import.meta.url));

function loadBuiltinPrograms(): readonly (readonly [string, LadderProgram])[] {
  const files = readdirSync(BUILTIN_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
  return files.map((name) => {
    const raw = JSON.parse(readFileSync(join(BUILTIN_DIR, name), 'utf8')) as {
      referenceLadder: JsonReferenceLadder;
    };
    return [name, toProgram(raw.referenceLadder)] as const;
  });
}

describe('内蔵モードD課題8題の命令語リスト（§16 Phase 4 / レビュー M5(a)）', () => {
  const programs = loadBuiltinPrograms();

  it('finds all 8 built-in PLC problems', () => {
    expect(programs).toHaveLength(8);
  });

  it.each(programs)('%s は4方言すべてで errors:[]・CRLF・連番ステップになる', (_name, p) => {
    for (const profile of availableDialects()) {
      const result = instructionList(p, profile);
      expect(result.errors, `${_name} / ${profile.id}`).toEqual([]);
      expect(result.lines.length, `${_name} / ${profile.id}`).toBeGreaterThan(0);
      // CRLF（§10.7）: 裸の LF が無く、末尾は必ず CRLF
      expect(result.text, `${_name} / ${profile.id}`).not.toMatch(/[^\r]\n/u);
      expect(result.text.endsWith('\r\n'), `${_name} / ${profile.id}`).toBe(true);
      // ステップは0起点の連番
      expect(
        result.lines.map((l) => l.step),
        `${_name} / ${profile.id}`,
      ).toEqual(result.lines.map((_line, index) => index));
    }
  });
});
