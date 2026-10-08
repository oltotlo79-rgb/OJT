import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_PLC_PROBLEMS, buildPlcReferenceSession } from '@ojt/content';
import { endNetwork, hline, network, no, out, program, X, Y } from '@ojt/ladder-core';
import { expect, test } from '@playwright/test';
import { WORK_FILE_FORMAT_VERSION, type WorkFile } from '../src/shared/ipc.js';
import { launchApp, settledShot } from './app.js';

test('PLCの結果から戻り、再変換せずに実際のスキャンを再開できる', async () => {
  const { app, page, userDataDir } = await launchApp({ contentSize: { width: 1440, height: 900 } });
  try {
    const problem = BUILTIN_PLC_PROBLEMS.find((item) => item.id === 'd-001')!;
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範の盤を作れません');
    const file: WorkFile = {
      formatVersion: WORK_FILE_FORMAT_VERSION,
      problemId: problem.id,
      problemSnapshot: problem,
      mode: 'plc',
      savedAt: new Date().toISOString(),
      elapsedMs: 0,
      hazardCount: 0,
      session: built.value.session,
      ladder: program(
        network('n1', [[no(X(0)), ...Array.from({ length: 14 }, hline), out(Y(0))]]),
        endNetwork(),
      ),
      dialectId: 'mitsubishi',
    };
    const path = join(userDataDir, 'resume-plc.ojtw');
    writeFileSync(path, JSON.stringify(file));
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
    }, path);
    await page.getByTestId('mode-plc').click();
    await page.getByTestId('open-d-001').click();
    await page.getByTestId('toolbar-overflow-toggle').click();
    await page.getByRole('button', { name: '作業を読込', exact: true }).click();
    await page.getByTestId('view-ladder').click();
    await page.getByTestId('ladder-editor').press('F4');
    await expect(page.getByTestId('convert-state')).toHaveText('変換に成功しました');
    await page.getByTestId('judge-button').click();
    await page.getByTestId('result-resume').click();
    await expect(page.getByTestId('toolbar-plc-run')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('power-breaker').click();
    await page.getByTestId('power-switch').click();
    await page.getByTestId('toolbar-monitor-start').click();
    await page.getByTestId('toolbar-plc-run').click();
    await expect
      .poll(async () => {
        const text = await page.getByTestId('monitor-scan').textContent();
        return Number(text?.match(/:\s*(\d+)/u)?.[1] ?? 0);
      })
      .toBeGreaterThan(1);
    await expect(page.getByTestId('error-banner')).toHaveCount(0);
    await settledShot(app, page, 'review-plc-resume');
  } finally {
    await app.close();
  }
});

test('見直し中の通常終了で作業を保存し、復元確認のキーボード操作を閉じ込める', async () => {
  const first = await launchApp({ contentSize: { width: 1440, height: 900 } });
  const autosavePath = join(first.userDataDir, 'autosave.json');
  let closed = false;
  let before: WorkFile;
  try {
    await first.page.getByTestId('mode-assemble').click();
    await first.page.getByTestId('open-b-001').click();
    await first.page.getByTestId('socket-list-S1').click();
    await first.page.getByTestId('mount-relay-my4n').click();
    await expect(first.page.getByTestId('autosave-status')).toContainText('自動保存済み');
    before = JSON.parse(readFileSync(autosavePath, 'utf8')) as WorkFile;
    await first.page.getByTestId('judge-button').click();
    await first.page.getByTestId('replay-open').click();
    await expect(first.page.getByTestId('replay-bar')).toHaveAttribute('aria-busy', 'false');
    const closing = first.app.waitForEvent('close');
    await first.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.close();
    });
    await closing;
    closed = true;
    const saved = JSON.parse(readFileSync(autosavePath, 'utf8')) as WorkFile;
    expect(saved.session).toEqual(before.session);
    expect(saved.problemId).toBe('b-001');
  } finally {
    if (!closed) await first.app.close();
  }

  const second = await launchApp({ userDataDir: first.userDataDir, keepRestorePrompt: true });
  try {
    const dialog = second.page.getByTestId('restore-prompt');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('button', { name: '後で決める', exact: true })).toBeFocused();
    await settledShot(second.app, second.page, 'review-restore-dialog');
    for (let index = 0; index < 5; index += 1) {
      await second.page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
    await second.page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(existsSync(autosavePath)).toBe(true);
    await second.page.getByTestId('recent-problem').click();
    await expect(second.page.getByTestId('judge-button')).toBeVisible();
    await expect(second.page.getByTestId('error-banner')).toHaveCount(0);
  } finally {
    await second.app.close();
  }

  const third = await launchApp({ userDataDir: first.userDataDir, keepRestorePrompt: true });
  try {
    await expect(third.page.getByTestId('restore-prompt')).toBeVisible();
    await expect(third.page.getByTestId('recent-problem')).toBeVisible();
    await third.page.getByRole('button', { name: '復元しない', exact: true }).click();
    await expect.poll(() => existsSync(autosavePath)).toBe(false);
    await expect(third.page.getByTestId('recent-problem')).toHaveCount(0);
    await expect(third.page.getByTestId('error-banner')).toHaveCount(0);
  } finally {
    await third.app.close();
  }
});

/*
 * v2.0.0 総点検 Task 2: 手順帯の「部品装着」は、課題の回路で使う部品が載ったら「済」になる。
 * b-001 は在庫にリレー2・タイマ2があるが、使うのは CR1 だけ。以前は在庫の残りで決めていたため
 * CR1 を載せても「いまここ」のままだった。
 */
test('部品装着は課題で使う部品（CR1）を載せた時点で済になり、案内は次の部品とソケットを言う', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1440, height: 900 } });
  try {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('step-parts')).toHaveAttribute('data-state', 'current');
    await expect(page.getByTestId('step-hint')).toContainText('CR1 をソケット S1 に載せます');
    await page.getByTestId('socket-list-S1').click();
    await page.getByTestId('mount-relay-my4n').click();
    await expect(page.getByTestId('step-parts')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('step-wire')).toHaveAttribute('data-state', 'current');
    await expect(page.getByTestId('step-hint')).toContainText('3D盤の端子を2つクリックして配線します');
    // 在庫にはタイマが残っているが、載せなくても「済」のまま
    await expect(page.getByTestId('parts-palette')).toContainText('残り');
  } finally {
    await app.close();
  }
});
