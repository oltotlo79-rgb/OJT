import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD, PLC_PART_ID } from '@ojt/board-model';
import {
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  PLC_MODELS,
  PLC_VENDORS,
  plcBoardFor,
  resolvePlcIo,
} from '@ojt/content';
import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as {
  version: string;
  scripts: Record<string, string>;
};
const builderYml = readFileSync(join(APP_ROOT, 'electron-builder.yml'), 'utf8');

describe('配布物の版と設定（§15 / Plan 5 決定表#20）', () => {
  it('is version 1.0.0', () => {
    expect(pkg.version).toBe('1.0.0');
  });

  it('runs the artefact check after electron-builder', () => {
    expect(pkg.scripts['dist']).toContain('check-dist.mjs');
    expect(pkg.scripts['dist']).toContain('copy-content.mjs');
  });

  it('still ships NSIS and the portable zip with no auto-update (§15)', () => {
    expect(builderYml).toContain('target: nsis');
    expect(builderYml).toContain('target: zip');
    expect(builderYml).toContain('publish: null');
    expect(builderYml).toContain('productName: 電気教育ツール');
  });

  it('shows the installer description page (SmartScreen の手順。§15)', () => {
    const license = readFileSync(join(APP_ROOT, 'build', 'license.txt'), 'utf8');
    expect(license).toContain('詳細情報');
    expect(license).toContain('実行');
    expect(license).toContain('三菱電機');
  });

  it('saves the license text with a BOM so the NSIS installer renders Japanese (Phase 7 Task 1)', () => {
    const raw = readFileSync(join(APP_ROOT, 'build', 'license.txt'));
    expect(raw.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const firstLine = raw.subarray(3).toString('utf8').split(/\r?\n/)[0];
    expect(firstLine).toBe('電気教育ツール');
  });
});

describe('同梱課題が4メーカーで成立する（決定表#19）', () => {
  /*
   * 件数は**等号**で縛る（Batch E レビュー I4）。下限（`toBeGreaterThanOrEqual`）だけだと
   * 課題が1つ増えたときに `docs/releases/v1.0.0.md` の「合計 28題」とモード別の表だけが
   * 静かに嘘になる。課題を増やしたらこの数とリリースノートの表を**両方**直すこと。
   */
  it('ships exactly the builtin problems the release note lists (B 8 / C1 4 / C2 8 / D 8)', () => {
    expect({
      assemble: BUILTIN_ASSEMBLE_PROBLEMS.length,
      inspectParts: BUILTIN_INSPECT_PARTS_PROBLEMS.length,
      inspectRepair: BUILTIN_INSPECT_REPAIR_PROBLEMS.length,
      plc: BUILTIN_PLC_PROBLEMS.length,
      total: BUILTIN_ALL_PROBLEMS.length,
    }).toEqual({ assemble: 8, inspectParts: 4, inspectRepair: 8, plc: 8, total: 28 });
  });

  it.each(PLC_VENDORS.map((vendor, i) => [vendor, PLC_MODELS[i]] as const))(
    '%s (%s) gives every builtin problem a desk unit with enough I/O terminals',
    (vendor, model) => {
      expect(model).toBeDefined();
      if (model === undefined) return;
      for (const problem of BUILTIN_PLC_PROBLEMS) {
        const swapped = { ...problem, plc: { vendor, model } };
        const unit = plcBoardFor(swapped, JIPM_BOARD)?.plcUnit;
        expect(unit).toBeDefined();
        // 差し替えた機種そのものが返る（`plcUnitFor()` が既定へ落ちていない）
        expect(unit?.model).toBe(model);
        expect(unit?.vendor).toBe(vendor);
        const terminals = unit?.terminals ?? [];
        // 端子はすべて机上のPLC本体のもの（`PLC.<端子名>`）。§10.1
        expect(terminals.length).toBeGreaterThan(0);
        expect(terminals.every((t) => t.id.startsWith(`${PLC_PART_ID}.`))).toBe(true);
        // 課題が使う入出力の点数ぶんは必ずある（COM・電源を含む総数なので下限として見る）
        const io = resolvePlcIo(problem.io);
        expect(terminals.length).toBeGreaterThanOrEqual(io.inputs.length + io.outputs.length);
      }
    },
  );
});
