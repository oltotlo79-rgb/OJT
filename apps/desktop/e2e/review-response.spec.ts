import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { parseProblem } from '@ojt/content';
import { getDialect } from '@ojt/plc-dialects';
import { toTerminalId } from '@ojt/circuit-sim';
import { launchApp, shot } from './app.js';
import { selectView, terminalPoint } from './projection.js';

test('演算処理が異常終了したときは判定を止め、画面のリセットで再開できる', async () => {
  const { app, page } = await launchApp();
  try {
    // 原因詳細の無いWorkerエラーを1回だけ発生させる。課題や解答の状態は注入しない。
    await page.evaluate(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          window.Worker = NativeWorker;
          setTimeout(() => this.dispatchEvent(new Event('error')), 0);
        }
      };
    });
    await page.getByTestId('mode-inspect-repair').click();
    await page
      .getByTestId('grade-filter')
      .getByRole('button', { name: 'すべて', exact: true })
      .click();
    await page.getByTestId('open-c2-001').click();
    await expect(page.getByTestId('error-banner')).toContainText(
      '原因の詳細を取得できませんでした',
    );
    await expect(page.getByTestId('judge-button')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('judge-button')).not.toContainText('判定中');
    await shot(app, 'v160-worker-recovery');
    await page.getByTestId('error-reset').click();
    await expect(page.getByTestId('error-banner')).toHaveCount(0);
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('result-resume')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('N01: 一覧での再開・取消・保存失敗・保存後の移動で配線を守る', async () => {
  const { app, page, userDataDir } = await launchApp({ contentSize: { width: 1440, height: 900 } });
  const saved = join(userDataDir, 'before-change.ojtw');
  try {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await page.getByTestId('terminal-list-summary').click();
    await page.getByTestId('terminal-row-P.1').click();
    await page.getByTestId('terminal-row-TB_PB.2c').click();
    await expect(page.getByTestId('status-overlay')).toContainText('自分で張った電線 1 本');
    await page.getByTestId('session-back').click();
    await expect(page.getByTestId('open-b-001')).toHaveText('再開');
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('status-overlay')).toContainText('自分で張った電線 1 本');
    await page.getByTestId('session-back').click();
    await page.getByTestId('open-b-002').click();
    const confirmation = page.getByTestId('problem-change-confirm');
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByTestId('resume-current-work').click();
    await expect(page.getByTestId('status-overlay')).toContainText('自分で張った電線 1 本');
    await page.getByTestId('session-back').click();
    await page.getByTestId('open-b-002').click();
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: '' });
    });
    await confirmation.getByRole('button', { name: '保存して進む', exact: true }).click();
    await expect(confirmation.getByRole('alert')).toContainText('保存を取り消しました');
    const blockedPath = join(userDataDir, 'occupied.ojtw');
    mkdirSync(blockedPath);
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, blockedPath);
    await confirmation.getByRole('button', { name: '保存して進む', exact: true }).click();
    await expect(confirmation.getByRole('alert')).toBeVisible();
    await expect(confirmation).toBeVisible();
    await shot(app, 'v160-navigation-save-failure');
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, saved);
    await confirmation.getByRole('button', { name: '保存して進む', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(JSON.parse(readFileSync(saved, 'utf8'))).toMatchObject({
      problemId: 'b-001',
      session: { wires: [{ from: 'P.1', to: 'TB_PB.2c' }] },
    });
    await expect(page.getByTestId('status-overlay')).toContainText('自分で張った電線 0 本');
    await page.getByTestId('session-back').click();
    await expect(page.getByTestId('open-b-002')).toHaveText('再開');
  } finally {
    await app.close();
  }
});

test('N01: 部品点検の解答を再開し、明示的なやり直しだけで初期化する', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByTestId('mode-inspect-parts').click();
    await page
      .getByTestId('grade-filter')
      .getByRole('button', { name: 'すべて', exact: true })
      .click();
    await page.getByTestId('open-c1-001').click();
    await page.getByTestId('answer-p1-normal').click();
    await page.getByTestId('session-back').click();
    await page.getByTestId('open-c1-001').click();
    await expect(page.getByTestId('answer-p1-normal')).toBeChecked();
    await page.getByTestId('session-back').click();
    await page.getByRole('button', { name: '最初からやり直す…', exact: true }).click();
    const confirmation = page.getByTestId('problem-change-confirm');
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await page.getByRole('button', { name: '最初からやり直す…', exact: true }).click();
    await confirmation.getByRole('button', { name: '保存せず進む', exact: true }).click();
    await expect(page.getByTestId('answer-p1-normal')).not.toBeChecked();
  } finally {
    await app.close();
  }
});

test('N02: 不完全な課題JSONを画面移動とアプリ再起動で保持する', async () => {
  const first = await launchApp();
  const { app, page, userDataDir } = first;
  const draftText = '{\n  "title": "編集中の課題・未完成JSON"';
  try {
    await page.getByTestId('open-settings').click();
    await page.getByTestId('problem-authoring-summary').click();
    const authoring = page.getByTestId('problem-authoring');
    await authoring.getByLabel('複製元の課題').selectOption('b-001');
    await authoring.getByRole('button', { name: '課題を複製', exact: true }).click();
    await authoring
      .getByText('詳細JSONを編集（高度な設定・データ形式の修正）', { exact: true })
      .click();
    await authoring.getByLabel('課題定義JSON').fill(draftText);
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    await page.getByTestId('open-settings').click();
    await page.getByTestId('problem-authoring-summary').click();
    await expect(authoring.getByLabel('課題定義JSON')).toHaveValue(draftText);
    await expect
      .poll(() => {
        const file = join(userDataDir, 'authoring-draft.json');
        return existsSync(file)
          ? (JSON.parse(readFileSync(file, 'utf8')) as { text: string }).text
          : '';
      })
      .toBe(draftText);
    await shot(app, 'v160-authoring-invalid-draft');
    await app.close();
  } catch (error) {
    await app.close();
    throw error;
  }
  const second = await launchApp({ userDataDir });
  try {
    await second.page.getByTestId('open-settings').click();
    await second.page.getByTestId('problem-authoring-summary').click();
    await expect(second.page.getByLabel('課題定義JSON')).toHaveValue(draftText);
    await second.page
      .getByRole('button', { name: '課題を検証（模範の自己判定）', exact: true })
      .click();
    await expect(second.page.getByTestId('problem-authoring').getByRole('status')).toContainText(
      '括弧・カンマ',
    );
  } finally {
    await second.app.close();
  }
});

for (const [mode, id, nextId] of [
  ['inspect-parts', 'c1-001', 'c1-002'],
  ['inspect-repair', 'c2-001', 'c2-002'],
  ['plc', 'd-001', 'd-002'],
] as const) {
  test(`N01: ${mode}も再開・取消・保存失敗・保存成功で作業を保持する`, async () => {
    const { app, page, userDataDir } = await launchApp({
      contentSize: { width: 1600, height: 900 },
    });
    const beforePath = join(userDataDir, 'original.ojtw');
    const savedPath = join(userDataDir, 'retained.ojtw');
    try {
      await page.getByTestId(`mode-${mode}`).click();
      await page
        .getByTestId('grade-filter')
        .getByRole('button', { name: 'すべて', exact: true })
        .click();
      await page.getByTestId(`open-${id}`).click();
      if (mode === 'inspect-parts') await page.getByTestId('answer-p1-normal').click();
      else if (mode === 'inspect-repair') {
        await page.getByRole('button', { name: '白', exact: true }).click();
        await selectView(page, '正面');
        const box = await page.locator('[data-testid="viewport"] canvas').boundingBox();
        if (!box) throw new Error('回路点検の盤が表示されていません');
        for (const terminal of ['P.1', 'TB_PB.4a']) {
          const point = terminalPoint(toTerminalId(terminal), box);
          await page.mouse.click(point.x, point.y);
        }
        await expect(page.getByTestId('status-overlay')).toContainText('自分で張った電線 9 本');
      } else {
        await page.getByTestId('view-ladder').click();
        await page.getByTestId('ladder-editor').press('F5');
        await page.getByTestId('device-text').fill('X0');
        await page.getByTestId('device-commit').click();
      }
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
      }, beforePath);
      await page.getByRole('button', { name: '作業を保存', exact: true }).click();
      await expect.poll(() => existsSync(beforePath)).toBe(true);
      const before = JSON.parse(readFileSync(beforePath, 'utf8')) as Record<string, unknown>;
      await page.getByTestId('session-back').click();
      await page.getByTestId(`open-${id}`).click();
      if (mode === 'inspect-parts')
        await expect(page.getByTestId('answer-p1-normal')).toBeChecked();
      else if (mode === 'inspect-repair')
        await expect(page.getByTestId('status-overlay')).toContainText('自分で張った電線 9 本');
      else await expect(page.getByTestId('cell-n1:0:0')).toContainText('X0');
      await page.getByTestId('session-back').click();
      await page.getByTestId(`open-${nextId}`).click();
      const confirm = page.getByTestId('problem-change-confirm');
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByTestId(`open-${nextId}`).click();
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: '' });
      });
      await confirm.getByRole('button', { name: '保存して進む', exact: true }).click();
      await expect(confirm.getByRole('alert')).toContainText('保存を取り消しました');
      const blockedPath = join(userDataDir, 'occupied.ojtw');
      mkdirSync(blockedPath);
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
      }, blockedPath);
      await confirm.getByRole('button', { name: '保存して進む', exact: true }).click();
      await expect(confirm.getByRole('alert')).not.toContainText('保存を取り消しました');
      await expect(confirm.getByRole('alert')).toBeVisible();
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
      }, savedPath);
      await confirm.getByRole('button', { name: '保存して進む', exact: true }).click();
      await expect(confirm).toHaveCount(0);
      const after = JSON.parse(readFileSync(savedPath, 'utf8')) as Record<string, unknown>;
      for (const key of [
        'problemId',
        'session',
        'answers',
        'reports',
        'tester',
        'ladder',
        'checkPartId',
        'resolvedFaults',
        'faultSeed',
        'measurements',
        'diagnosisNotes',
      ])
        expect(after[key], key).toEqual(before[key]);
      await page.getByTestId('session-back').click();
      await expect(page.getByTestId(`open-${nextId}`)).toHaveText('再開');
    } finally {
      await app.close();
    }
  });
}

test('N04: 模範ラダーをGUIで変更し、検証・保存・読込・配線・解答まで完了する', async () => {
  const { app, page, userDataDir } = await launchApp({ contentSize: { width: 1600, height: 900 } });
  const directory = join(userDataDir, 'authored');
  mkdirSync(directory);
  const path = join(directory, 'user-visual-plc.json');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
    }, path);
    await page.getByTestId('open-settings').click();
    await page.getByTestId('problem-authoring-summary').click();
    const authoring = page.getByTestId('problem-authoring');
    await authoring.getByLabel('複製元の課題').selectOption('d-061');
    await authoring.getByRole('button', { name: '課題を複製', exact: true }).click();
    await authoring.getByLabel('課題ID', { exact: true }).fill('user-visual-plc');
    await authoring
      .getByLabel('操作・達成条件の説明', { exact: true })
      .fill('PB1を離し、PB2・PB3・PB4を押すとPL1が点灯する。PL2はPB4の押下状態を表示する。');
    await authoring.getByTestId('author-reference-open').click();
    const reference = page.getByTestId('author-reference-editor');
    await reference.getByTestId('cell-term0:0:0').dblclick();
    await reference.getByTestId('direct-text').fill('LDI X0');
    await expect(
      reference.getByRole('button', { name: '編集を終える', exact: true }),
    ).toBeDisabled();
    await reference.getByTestId('device-commit').click();
    await expect(reference.getByTestId('device-input')).toHaveCount(0);
    await reference.getByRole('button', { name: 'ラダーを変換', exact: true }).click();
    await expect(reference).toContainText('ラダーの変換に成功しました');
    await reference.getByRole('button', { name: '課題全体を検証', exact: true }).click();
    await expect(reference).toContainText('検証合格', { timeout: 65_000 });
    await shot(app, 'v160-authoring-ladder');
    // 表示が狭くても操作欄がスクロールで届き、閉じる操作が隠れない。
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 720),
    );
    await reference.getByRole('button', { name: '編集を終える', exact: true }).click();
    await authoring.getByTestId('author-reference-open').click();
    await reference.getByTestId('cell-term0:0:0').click();
    await reference.getByTestId('ladder-editor').press('Delete');
    await reference.getByRole('button', { name: 'この画面の変更を取り消す…', exact: true }).click();
    await reference.getByRole('button', { name: '変更を取り消して閉じる', exact: true }).click();
    await authoring.getByRole('button', { name: '検証してJSONを保存', exact: true }).click();
    await expect(authoring.getByRole('status')).toContainText('保存しました', { timeout: 65_000 });
    const parsed = parseProblem(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.ok || parsed.problem.mode !== 'plc') throw new Error('saved PLC problem invalid');
    const definition = parsed.problem;
    expect(definition.referenceLadder.networks[0]?.cells[0]?.[0]).toMatchObject({
      kind: 'contact',
      type: 'NC',
    });
    await authoring
      .getByRole('button', { name: '保存先を利用者課題フォルダに設定する', exact: true })
      .click();
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    await page.getByTestId('mode-plc').click();
    await page
      .getByTestId('grade-filter')
      .getByRole('button', { name: 'すべて', exact: true })
      .click();
    await page.getByTestId('open-user-visual-plc').click();
    await page.getByTestId('view-ladder').click();
    const profile = getDialect(definition.plc.vendor);
    const networks = definition.referenceLadder.networks.filter(
      (net) => net.cells[0]?.[0]?.kind !== 'end',
    );
    for (const [index, net] of networks.entries()) {
      if (index > 0) {
        await page.getByTestId('native-menu-edit').click();
        await page.getByTestId('native-item-insert-network').click();
      }
      for (const [col, cell] of (net.cells[0] ?? []).entries()) {
        if (cell.kind !== 'contact' && cell.kind !== 'coil') continue;
        await page.getByTestId(`cell-n${index + 1}:0:${col}`).click();
        await page
          .getByTestId('ladder-editor')
          .press(cell.kind === 'coil' ? 'F7' : cell.type === 'NC' ? 'F6' : 'F5');
        await page.getByTestId('device-text').fill(profile.formatDevice(cell.device));
        await page.getByTestId('device-commit').click();
      }
    }
    await page.getByTestId('ladder-editor').press('F4');
    await expect(page.getByTestId('convert-state')).toHaveText('変換に成功しました');
    const io = page.getByTestId('io-assignment-editor');
    await io.getByRole('button', { name: 'I/O割付を変更', exact: true }).click();
    await io.getByRole('checkbox').check();
    await io.getByRole('button', { name: '確認して確定', exact: true }).click();
    await page.getByTestId('view-board').click();
    for (const socket of ['S1', 'S2']) {
      await page.getByTestId(`socket-list-${socket}`).click();
      await page.getByTestId('mount-relay-my4n').click();
      await page.getByTestId('socket-list-back').click();
    }
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toHaveText('合格', { timeout: 65_000 });
    await shot(app, 'v160-created-plc-pass');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
