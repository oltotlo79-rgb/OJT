import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { expect, test, type Page } from '@playwright/test';
import { SHOT_DIR } from './app.js';
import { launchPortable, type PackagedApp } from './packaged-app.js';
import { verifyTutorials } from './tutorial-checks.js';
import {
  boardPoint,
  SELF_HOLD_WIRES,
  selectView,
  terminalPoint,
  wireCountText,
} from './projection.js';

function resourcesDirectory(page: Page): string {
  const url = fileURLToPath(page.url());
  expect(url).toMatch(/app\.asar/);
  const resources = url.split(/app\.asar[/\\]/)[0];
  if (!resources) throw new Error('同梱ファイルの場所を取得できません');
  return resources.replace(/[/\\]$/, '');
}

/** distの後に e2e:packaged で実行。ユーザーの設定やインストール先を使わない。 */
test('EXE1個から初回ガイド・372課題・回路の合格・ヘルプ・PLCと終了時の後始末を確認する', async () => {
  const app = await launchPortable();
  let extracted: string | undefined;
  try {
    const page = app.page;
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await expect(page.getByTestId('mode-assemble')).toBeVisible({ timeout: 30_000 });
    expect(readdirSync(app.received)).toHaveLength(1);
    expect(readdirSync(app.received)[0]).toMatch(/-Portable\.exe$/);
    const resources = resourcesDirectory(page);
    extracted = dirname(resources);
    expect(readFileSync(join(resources, 'manual.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    const counts = await page.evaluate(async () => {
      if (!window.ojt) throw new Error('配布版のpreloadが読み込まれていません');
      const payload = await window.ojt.listProblems();
      return payload.problems.reduce<Record<string, number>>((out, p) => {
        out[p.mode] = (out[p.mode] ?? 0) + 1;
        return out;
      }, {});
    });
    expect(counts).toEqual({ assemble: 102, 'inspect-parts': 66, 'inspect-repair': 102, plc: 102 });
    await verifyTutorials(page);
    // 配布物のasar内からも課題検証Workerを起動できることを確かめる。
    await page.getByTestId('open-settings').click();
    await page.getByTestId('problem-authoring-summary').click();
    const authoring = page.getByTestId('problem-authoring');
    await authoring.getByLabel('複製元の課題').selectOption('b-087');
    await authoring.getByRole('button', { name: '課題を複製', exact: true }).click();
    await authoring
      .getByRole('button', { name: '課題を検証（模範の自己判定）', exact: true })
      .click();
    await expect(authoring.getByRole('status')).toContainText('検証合格', { timeout: 65_000 });
    await page.screenshot({ path: join(SHOT_DIR, 'portable-authoring-validated.png') });
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('session-activity')).not.toHaveAttribute('open', '');
    await expect(page.getByTestId('status-overlay')).toContainText(wireCountText(0, 0));
    await expect(page.getByTestId('tour-guide')).toHaveAttribute('data-step', 'rotate');
    await page.getByTestId('tour-later').click();
    await selectView(page, '正面');
    const box = await page.locator('[data-testid="viewport"] canvas').boundingBox();
    if (!box) throw new Error('配布版の3D表示の位置を取得できません');
    const socket = JIPM_BOARD.sockets[0]!;
    const center = boardPoint(
      {
        x: socket.origin.x + socket.bodyMm.width / 2,
        y: socket.origin.y + socket.bodyMm.length / 2,
        z: 9,
      },
      box,
    );
    await page.mouse.click(center.x, center.y);
    await expect(page.getByText('S1（CR1）を選択中')).toBeVisible();
    await page.getByTestId('mount-relay-my4n').click();
    await expect(page.getByTestId('operation-log')).toContainText('S1 に リレー MY4N を装着');
    // ストアへ模範解を注入せず、実際の端子クリックだけで回路を完成させる。
    for (const pair of SELF_HOLD_WIRES) {
      for (const terminal of pair) {
        const point = terminalPoint(toTerminalId(terminal), box);
        await page.mouse.click(point.x, point.y);
      }
    }
    await expect(page.getByTestId('status-overlay')).toContainText(
      wireCountText(SELF_HOLD_WIRES.length, 0),
    );
    await page.getByTestId('session-back').click();
    await page.getByTestId('resume-current-work').click();
    await expect(page.getByTestId('status-overlay')).toContainText(
      wireCountText(SELF_HOLD_WIRES.length, 0),
    );
    await page.getByTestId('power-breaker').click();
    await page.getByTestId('power-switch').click();
    await expect(page.getByTestId('status-overlay')).toContainText('通電中');
    await page.keyboard.press('F1');
    await expect(page.getByTestId('help-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('verdict')).toHaveText('合格');
    await expect(page.getByTestId('no-mismatch')).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, 'portable-result-pass.png') });
    await page.getByRole('button', { name: '課題一覧へ', exact: true }).click();
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    // 新しい修復操作も、ビルド済みの画面ではなく配布EXEの実操作で確認する。
    await page.getByTestId('mode-inspect-repair').click();
    await page.getByTestId('open-c2-001').click();
    await page
      .getByTestId('problem-change-confirm')
      .getByRole('button', { name: '保存せず進む', exact: true })
      .click();
    await expect(page.getByTestId('session-activity')).not.toHaveAttribute('open', '');
    const repairWires = page.getByTestId('wire-list');
    if ((await repairWires.getAttribute('open')) === null)
      await repairWires.locator('summary').click();
    await page.getByTestId('wire-row-sw-005').click();
    await page.getByRole('button', { name: 'この電線の故障を指摘', exact: true }).click();
    await page.getByTestId('report-kind-wire-open').click();
    await page.getByTestId('edit-report-0').click();
    await page.getByTestId('report-kind-wire-misrouted').click();
    await expect(page.getByTestId('report-kind-text-0')).toHaveText('誤配線');
    await page.getByTestId('edit-report-0').click();
    await page.getByTestId('report-kind-wire-open').click();
    await expect(page.getByTestId('report-count')).toHaveText('1');
    await page.getByTestId('wire-row-sw-005').click();
    await page
      .getByRole('button', { name: 'この電線を外す（Delete / Backspace）', exact: true })
      .click();
    await expect(page.getByTestId('wire-row-sw-005')).toHaveCount(0);
    await page.getByTestId('restore-wire-sw-005').click();
    await expect(page.getByTestId('wire-row-sw-005')).toHaveCount(1);
    await expect(page.getByTestId('restore-wire-sw-005')).toHaveCount(0);
    await expect(page.getByTestId('report-count')).toHaveText('1');
    await page.screenshot({ path: join(SHOT_DIR, 'portable-repair-restored.png') });
    await page.getByTestId('session-back').click();
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    await page.getByTestId('mode-plc').click();
    await page.getByTestId('open-d-001').click();
    await page
      .getByTestId('problem-change-confirm')
      .getByRole('button', { name: '保存せず進む', exact: true })
      .click();
    await expect(page.getByTestId('plc-session')).toBeVisible();
    await page.getByTestId('view-ladder').click();
    await expect(page.getByTestId('ladder-workspace')).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, 'portable-plc.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
  if (!extracted) throw new Error('展開先の検査が完了していません');
  await expect
    .poll(() => existsSync(extracted), {
      timeout: 10_000,
      message: `終了後に一時展開先が残っています: ${extracted}`,
    })
    .toBe(false);
});

test('課題下書きと模範編集を配布EXEで保持し、終了直前の変更も再起動で復元する', async () => {
  const tempRoot = resolve(tmpdir());
  const userDataDir = mkdtempSync(join(tempRoot, 'ojt-portable-authoring-'));
  if (dirname(userDataDir) !== tempRoot) throw new Error('検査プロファイルの削除範囲が違います');
  let app: PackagedApp | undefined;
  const draftText = '{ "unfinished": "終了直前の未完成JSON"';
  try {
    app = await launchPortable({ userDataDir });
    const page = app.page;
    await page.getByTestId('open-settings').click();
    await page.getByTestId('problem-authoring-summary').click();
    const authoring = page.getByTestId('problem-authoring');
    await authoring.getByLabel('複製元の課題').selectOption('d-061');
    await authoring.getByRole('button', { name: '課題を複製', exact: true }).click();
    await authoring.getByLabel('課題名', { exact: true }).fill('配布EXEの下書き確認');
    await authoring.getByTestId('author-reference-open').click();
    const reference = page.getByTestId('author-reference-editor');
    await reference.getByTestId('cell-term0:0:0').dblclick();
    await reference.getByTestId('direct-text').fill('LDI X0');
    await expect(
      reference.getByRole('button', { name: '編集を終える', exact: true }),
    ).toBeDisabled();
    await reference.getByTestId('device-commit').click();
    await reference.getByRole('button', { name: '課題全体を検証', exact: true }).click();
    await expect(reference).toContainText('検証合格', { timeout: 65_000 });
    await page.screenshot({ path: join(SHOT_DIR, 'portable-reference-ladder.png') });
    await reference.getByRole('button', { name: '編集を終える', exact: true }).click();
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    await page.getByTestId('open-settings').click();
    await page.getByTestId('problem-authoring-summary').click();
    await expect(authoring.getByLabel('課題名', { exact: true })).toHaveValue(
      '配布EXEの下書き確認',
    );
    await authoring
      .getByText('詳細JSONを編集（高度な設定・データ形式の修正）', { exact: true })
      .click();
    await authoring.getByLabel('課題定義JSON').fill(draftText);
    await expect(authoring.getByLabel('課題名', { exact: true })).toHaveCount(0);
    await expect(authoring.getByRole('status')).toContainText('編集中の内容は下書きへ保存');
    // 自動保存の1秒待ちを挟まず、通常終了時の書込待ちを検査する。
    await app.close();
    const saved = JSON.parse(readFileSync(join(userDataDir, 'authoring-draft.json'), 'utf8')) as {
      text: string;
    };
    expect(saved.text).toBe(draftText);
    app = await launchPortable({ userDataDir });
    await app.page.getByTestId('open-settings').click();
    await app.page.getByTestId('problem-authoring-summary').click();
    await expect(app.page.getByLabel('課題定義JSON')).toHaveValue(draftText);
    await app.page.screenshot({ path: join(SHOT_DIR, 'portable-draft-restored.png') });
  } finally {
    await app?.close();
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('同じEXEの展開先は起動ごとに変わり、片方を閉じても他方の課題を壊さない', async () => {
  const first = await launchPortable();
  let second: PackagedApp | undefined;
  let third: PackagedApp | undefined;
  let secondDir: string | undefined;
  let thirdDir: string | undefined;
  try {
    await expect(first.page.getByTestId('mode-assemble')).toBeVisible();
    const firstDir = dirname(resourcesDirectory(first.page));
    await first.close();
    await expect.poll(() => existsSync(firstDir)).toBe(false);
    second = await launchPortable();
    await expect(second.page.getByTestId('mode-assemble')).toBeVisible();
    secondDir = dirname(resourcesDirectory(second.page));
    // まず順に起動して検査する。固定名へ戻る回帰でも上書きのダイアログを出さずに拒否する。
    expect(secondDir).not.toBe(firstDir);
    third = await launchPortable();
    await expect(third.page.getByTestId('mode-assemble')).toBeVisible();
    thirdDir = dirname(resourcesDirectory(third.page));
    expect(thirdDir).not.toBe(secondDir);
    await second.close();
    await expect.poll(() => existsSync(secondDir!)).toBe(false);
    expect(existsSync(thirdDir)).toBe(true);
    await third.page.getByTestId('mode-assemble').click();
    await third.page.getByTestId('open-b-001').click();
    await expect(third.page.locator('[data-testid="viewport"] canvas')).toBeVisible();
  } finally {
    await third?.close();
    await second?.close();
    await first.close();
  }
  if (!thirdDir) throw new Error('同時起動の検査が完了していません');
  await expect.poll(() => existsSync(thirdDir)).toBe(false);
});

/** 本体の準備後に、標準進捗画面や独立したローディング画面が残らないことを確認する。 */
test('本体の起動後に進捗画面とローディング画面を残さない（3回起動）', async () => {
  test.setTimeout(240_000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const app = await launchPortable();
    try {
      await expect(app.page.getByTestId('mode-assemble')).toBeVisible();
      await expect(app.page.locator('#startup')).toHaveCount(0);
      const script = String.raw`
Add-Type -ReferencedAssemblies System,System.Core -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class OjtPortableDialogProbe {
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
 delegate bool Callback(IntPtr hwnd,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback,IntPtr data);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd,StringBuilder text,int count);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd,StringBuilder text,int count);
 public static string[] Find(uint root) {
  var found=new List<string>();
  EnumWindows((hwnd,data)=>{
   uint pid;GetWindowThreadProcessId(hwnd,out pid);
   if(pid!=root||!IsWindowVisible(hwnd))return true;
   var cls=new StringBuilder(128);GetClassNameW(hwnd,cls,cls.Capacity);
   var title=new StringBuilder(256);GetWindowTextW(hwnd,title,title.Capacity);
   Rect rect;GetWindowRect(hwnd,out rect);
   var pending=cls.ToString()=="#32770"||
    (String.Equals(cls.ToString(),"STATIC",StringComparison.OrdinalIgnoreCase)&&
     title.ToString()=="電気教育ツールを起動しています…");
   if(pending&&rect.right>rect.left&&rect.bottom>rect.top)
    found.Add(String.Format("{0}:{1}x{2}",cls,rect.right-rect.left,rect.bottom-rect.top));
   return true;
  },IntPtr.Zero);
  return found.ToArray();
 }
}
'@
$observed=New-Object 'System.Collections.Generic.List[string]'
for($sample=0;$sample -lt 12;$sample++){
 foreach($dialog in [OjtPortableDialogProbe]::Find(${app.launcherPid})){$observed.Add($dialog)}
 Start-Sleep -Milliseconds 100
}
@{samples=12;dialogs=@($observed)} | ConvertTo-Json -Compress
`;
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { windowsHide: true, encoding: 'utf8', timeout: 20_000 },
      );
      const audit = JSON.parse(output.trim().replace(/^\uFEFF/u, '')) as {
        samples: number;
        dialogs: string[];
      };
      expect(audit.samples).toBe(12);
      expect(audit.dialogs, `起動${attempt + 1}回目に進捗画面が残っています`).toEqual([]);
      await app.page.screenshot({
        path: join(SHOT_DIR, `portable-no-installer-${attempt + 1}.png`),
      });
    } finally {
      await app.close();
    }
  }
});

/** Windowsの読取ハンドルで削除だけを拒否する。対象はこの検査が起動したEXEだけ。 */
async function holdAgainstDeletion(path: string): Promise<() => Promise<void>> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$held = [IO.File]::Open('${path.replace(/'/gu, "''")}', [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)`,
    'try { [Console]::Out.WriteLine("locked"); [void][Console]::In.ReadLine() } finally { $held.Dispose() }',
  ].join('\n');
  const holder = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const stopped = once(holder, 'close');
  let errorOutput = '';
  holder.stderr.on('data', (chunk: Buffer) => {
    errorOutput += chunk.toString();
  });
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    holder.stdin.end('\n');
    await stopped;
  };
  try {
    const ready = await Promise.race([
      once(holder.stdout, 'data').then(([chunk]) => String(chunk).trim()),
      stopped.then(() => {
        throw new Error(`検証用の読取ハンドルを開けません: ${errorOutput}`);
      }),
      delay(10_000).then(() => {
        throw new Error('検証用の読取ハンドルの準備が終わりません');
      }),
    ]);
    expect(ready).toBe('locked');
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}

test('終了後もEXEが13秒間使用中なら解放を待ち、一時展開先を残さない', async () => {
  const app = await launchPortable();
  let release: (() => Promise<void>) | undefined;
  try {
    await expect(app.page.getByTestId('mode-assemble')).toBeVisible();
    const extracted = dirname(resourcesDirectory(app.page));
    release = await holdAgainstDeletion(join(extracted, '電気教育ツール.exe'));
    // 旧版の10秒の再試行では残る条件を、実際のWindowsハンドルで再現する。
    const unlock = delay(13_000).then(release);
    await app.close();
    await unlock;
    expect(existsSync(extracted), 'ロックを解放した後も展開先が残っています').toBe(false);
  } finally {
    await release?.();
    await app.close();
  }
});
