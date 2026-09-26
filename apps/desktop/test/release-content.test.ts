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
  it('配布版の版数をREADMEの入手先とリリース記録へ揃える', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    const root = resolve(APP_ROOT, '../..');
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain(
      `https://github.com/oltotlo79-rgb/OJT/releases/tag/v${pkg.version}`,
    );
    expect(readFileSync(join(root, 'docs/releases', `v${pkg.version}.md`), 'utf8')).toContain(
      `# 電気教育ツール v${pkg.version}`,
    );
  });

  it('runs the artefact check after electron-builder', () => {
    expect(pkg.scripts['dist']).toContain('check-dist.mjs');
    expect(pkg.scripts['dist']).toContain('copy-content.mjs');
  });

  it('インストーラと単一EXEを自動更新なしで配布する', () => {
    expect(builderYml).toContain('target: nsis');
    expect(builderYml).toContain('target: portable');
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

  /*
   * Phase 7 Task 8（QA-06）。アイコンが無いとインストーラ・exe・ショートカット・
   * タスクバーがすべて既定の Electron アイコンになる。署名もしていないので、
   * SmartScreen の警告が出たときに「見覚えのない素性のアプリ」に見えてしまう。
   * `electron-builder.yml` の変更は要らない（`buildResources: build` の `icon.ico` を拾う）。
   */
  it('ships an application icon (QA-06)', () => {
    const icon = readFileSync(join(APP_ROOT, 'build', 'icon.ico'));
    // ICONDIR: reserved=0 / type=1（アイコン） / count
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    const count = icon.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(6);
    // 0 は 256px を表す。Windows のインストーラと高DPIの一覧表示に要る
    const sizes = Array.from({ length: count }, (_, i) => icon.readUInt8(6 + i * 16));
    expect(sizes).toContain(0);
    expect(sizes).toContain(16);
    expect(sizes).toContain(32);
    expect(sizes).toContain(48);
    // マルチサイズなら必ずこの程度にはなる（1枚だけの手抜きを弾く）
    expect(icon.byteLength).toBeGreaterThanOrEqual(4 * 1024);
  });

  it('checks that icon from the dist script (QA-06)', () => {
    const script = readFileSync(join(APP_ROOT, 'scripts', 'inspect-dist.mjs'), 'utf8');
    expect(script).toContain('icon.ico');
  });
});

describe('配布物のハードニング（Phase 7 Task 8 / QA-05 ≡ DM-5・QA-18）', () => {
  /*
   * Electron Fuses。フューズは**配布する実行ファイルそのもの**を書き換えて機能を殺す
   * ので、アプリのコードから戻すことができない。`runAsNode` を残したままだと
   * `ELECTRON_RUN_AS_NODE=1 電気教育ツール.exe script.js` で本体が汎用の Node として
   * 動き、`onlyLoadAppFromAsar` と `enableEmbeddedAsarIntegrityValidation` が無いと
   * `app.asar` の差し替えが検出されない。
   */
  it.each([
    ['runAsNode', 'false'],
    ['enableNodeOptionsEnvironmentVariable', 'false'],
    ['enableNodeCliInspectArguments', 'false'],
    ['onlyLoadAppFromAsar', 'true'],
    ['enableEmbeddedAsarIntegrityValidation', 'true'],
  ])('blows the %s fuse to %s', (fuse, value) => {
    expect(builderYml).toContain('electronFuses:');
    expect(builderYml).toMatch(new RegExp(`^\\s+${fuse}:\\s*${value}\\s*(#.*)?$`, 'm'));
  });

  /*
   * 6つ目の `grantFileProtocolExtraPrivileges` だけは **true のまま**である。
   * renderer は `loadFile()` で `app.asar` の中の `index.html` を file:// として読むので、
   * false にすると配布物が `ERR_FILE_NOT_FOUND` で起動しない（Phase 7 Task 8 で
   * `release/win-unpacked` を実際に起動して確認した）。独自スキームへ移すまでは切れない。
   * ここが false に変わったら**配布物が動かなくなる**ので、テストで固定して気づけるようにする。
   */
  it('keeps grantFileProtocolExtraPrivileges on (asar の中を file:// で読むため)', () => {
    expect(builderYml).toMatch(/^\s+grantFileProtocolExtraPrivileges:\s*true\s*(#.*)?$/m);
    expect(builderYml).toContain('ERR_FILE_NOT_FOUND');
  });

  it('never asks for administrator rights (QA-18。README の「管理者権限は不要」の担保)', () => {
    expect(builderYml).toMatch(/^\s+allowElevation:\s*false\s*(#.*)?$/m);
    expect(builderYml).toMatch(/^\s+perMachine:\s*false\s*(#.*)?$/m);
  });
});

describe('同梱課題が4メーカーで成立する（決定表#19）', () => {
  /*
   * 件数は**等号**で縛る（Batch E レビュー I4）。下限（`toBeGreaterThanOrEqual`）だけだと
   * 課題が1つ増えたときに次のリリースノートのモード別の表だけが静かに嘘になる。
   * 課題を増やしたらこの数と、そのとき出すリリースノートの表を**両方**直すこと
   * （`docs/releases/v1.0.0.md` の「合計 28題」は v1.0.0 が実際に同梱した数なので直さない）。
   */
  it('ships exactly the builtin problems the next release note must list (B 60 / C1 36 / C2 60 / D 60)', () => {
    expect({
      assemble: BUILTIN_ASSEMBLE_PROBLEMS.length,
      inspectParts: BUILTIN_INSPECT_PARTS_PROBLEMS.length,
      inspectRepair: BUILTIN_INSPECT_REPAIR_PROBLEMS.length,
      plc: BUILTIN_PLC_PROBLEMS.length,
      total: BUILTIN_ALL_PROBLEMS.length,
    }).toEqual({ assemble: 100, inspectParts: 64, inspectRepair: 100, plc: 100, total: 364 });
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
