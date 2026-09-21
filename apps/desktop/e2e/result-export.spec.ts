import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { JIPM_BOARD } from '@ojt/board-model';
import { terminalId } from '@ojt/circuit-sim';
import { BUILTIN_PROBLEMS, buildReferenceSession, judgeAssemble } from '@ojt/content';
import { resultReportHtml } from '../src/renderer/result/report-html.js';
import { launchApp, SHOT_DIR, shot } from './app.js';

function freshOutput(): string {
  const parent = join(SHOT_DIR, 'result-reports');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'run-'));
}

async function watchReportErrors(application: ElectronApplication): Promise<void> {
  application.process().stderr?.on('data', (data: Buffer) => process.stderr.write(data));
  await application.evaluate(({ app }) => {
    app.on('web-contents-created', (_event, contents) => {
      contents.on('did-fail-load', (_event, code, description, url) => {
        console.error('Report load failed', { code, description, url });
      });
      const print = contents.printToPDF.bind(contents);
      contents.printToPDF = (options) =>
        print(options).catch((error: unknown) => {
          console.error('Report print failed', String(error));
          throw error;
        });
    });
  });
}

for (const [mode, id] of [
  ['assemble', 'b-001'],
  ['inspect-parts', 'c1-001'],
  ['inspect-repair', 'c2-001'],
  ['plc', 'd-001'],
] as const) {
  test(`${mode}の結果を1枚のPDFと単独HTMLに保存し、取消では何も作らない`, async () => {
    const { app, page, userDataDir } = await launchApp({
      contentSize: { width: 1280, height: 800 },
    });
    const output = freshOutput();
    try {
      await watchReportErrors(app);
      await page.getByTestId(`mode-${mode}`).click();
      await page.getByTestId(`open-${id}`).click();
      if (mode === 'plc') {
        await page.getByTestId('view-ladder').click();
        await page.getByTestId('ladder-editor').press('F5');
        await page.getByTestId('device-text').fill('X0');
        await page.getByTestId('device-commit').click();
        await page.getByTestId('cell-n1:0:15').click();
        await page.getByTestId('ladder-editor').press('F7');
        await page.getByTestId('device-text').fill('Y0');
        await page.getByTestId('device-commit').click();
        await page.getByTestId('ladder-editor').press('F4');
        await expect(page.getByTestId('convert-state')).toHaveText('変換に成功しました');
      }
      await page.getByTestId('judge-button').click();
      const save = page.getByTestId('result-export');
      await expect(save).toBeVisible();
      const settingsBefore = readFileSync(join(userDataDir, 'settings.json'), 'utf8');
      const filesBefore = readdirSync(output).sort();
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: '' });
      });
      await save.click();
      await expect(save).toBeEnabled();
      expect(readdirSync(output).sort()).toEqual(filesBefore);
      for (const extension of ['pdf', 'html']) {
        const target = join(output, `${id}.${extension}`);
        await app.evaluate(({ dialog }, filePath) => {
          dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
        }, target);
        await save.click();
        await expect.poll(() => existsSync(target), { timeout: 35_000 }).toBe(true);
        await expect(save).toBeEnabled();
        const saved = readFileSync(target);
        if (extension === 'pdf') {
          expect(saved.subarray(0, 5).toString()).toBe('%PDF-');
          expect(saved.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
        } else {
          const html = saved.toString('utf8');
          expect(html).toContain('練習結果レポート');
          expect(html).toContain("script-src 'none'");
          expect(html).not.toContain(userDataDir);
        }
        expect(
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
        ).toBe(1);
      }
      expect(readFileSync(join(userDataDir, 'settings.json'), 'utf8')).toBe(settingsBefore);
      expect(
        readdirSync(userDataDir).filter((name) => /result|report|partition/i.test(name)),
      ).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      if (mode === 'assemble') await shot(app, 'result-export-entry');
    } finally {
      await app.close();
    }
  });
}

test('長い課題名・最大件数の差分と配線候補もA4の1枚に収まる', async () => {
  const problem = BUILTIN_PROBLEMS[0]!;
  const reference = buildReferenceSession(problem, JIPM_BOARD);
  if (!reference.ok) throw new Error('reference');
  const judged = judgeAssemble(problem, JIPM_BOARD, reference.value.session);
  if (!judged.ok) throw new Error('judge');
  const html = resultReportHtml({
    problem: { ...problem, title: '長い日本語の課題名'.repeat(30) },
    result: {
      ...judged.value,
      passed: false,
      mismatches: Array.from({ length: 90 }, () => ({
        tMs: 200,
        signal: 'PL1',
        expected: true,
        actual: false,
        reason: 'value' as const,
      })),
    },
    sessionOpenedAtMs: Date.now(),
    restoredHazardCount: 20,
    hintStage: 3,
    schematicOpenCount: 1,
    suspects: Array.from({ length: 10 }, () => ({
      message: 'つながりを確認してください'.repeat(30),
      kind: 'missing' as const,
      devices: [],
      terminals: [terminalId('CR1', '9'), terminalId('PB1', '2c')],
      cellIds: [],
      wireIds: [],
    })),
    suspectTotal: 10,
  });
  const { app, page } = await launchApp();
  try {
    await watchReportErrors(app);
    const filePath = join(freshOutput(), 'long-report.pdf');
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: target });
    }, filePath);
    expect(
      await page.evaluate(
        (content) => window.ojt!.exportResult({ html: content, suggestedName: 'long.pdf' }),
        html,
      ),
    ).toEqual({ ok: true, canceled: false });
    expect(
      readFileSync(filePath)
        .toString('latin1')
        .match(/\/Type\s*\/Page\b/g),
    ).toHaveLength(1);
  } finally {
    await app.close();
  }
});
