/** 実アプリをマウス・キーで操作して解答する。解答状態の注入は行わない。 */
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { JIPM_BOARD, plcUnitFor, routeSession } from '@ojt/board-model';
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  buildInspectRepairCircuit,
  plcWiringPlan,
  resolvePlcIo,
  toSocketRoles,
} from '@ojt/content';
import { toTerminalId } from '@ojt/circuit-sim';
import { COIL_COL } from '@ojt/ladder-core';
import { getDialect } from '@ojt/plc-dialects';
import {
  boardPoint,
  terminalPoint,
  pushButtonPoint,
  SELF_HOLD_WIRES,
  plcBoardPointFor,
  plcTerminalPointFor,
} from '../e2e/projection.ts';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const root = dirname(
  execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: appRoot,
    encoding: 'utf8',
  }).trim(),
);
const runDir = join(root, 'release/verification/v1.7.0/tutorials');
const destination = join(appRoot, 'src/renderer/public/tutorials');
mkdirSync(runDir, { recursive: true });
mkdirSync(destination, { recursive: true });
const mode = process.argv[2] ?? 'assembly';
/*
 * PLCの動画はメーカーごと（`plc` は三菱、`plc-jtekt` / `plc-omron` / `plc-sharp`）。
 * 既定メーカーを設定に入れて起動するので、課題はそのメーカーの機種で開く。
 */
const plcVendor =
  mode === 'plc' ? 'mitsubishi' : mode.startsWith('plc-') ? mode.slice('plc-'.length) : undefined;
const dry = process.env.OJT_TUTORIAL_DRY === '1';
const dataDir = join(runDir, `${mode}-${Date.now()}`);
mkdirSync(dataDir, { recursive: true });
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({
    tourDone: true,
    soundEnabled: false,
    ...(plcVendor === undefined ? {} : { defaultVendor: plcVendor }),
  }),
);
const app = await electron.launch({
  args: [
    join(appRoot, 'out/main/index.js'),
    `--user-data-dir=${dataDir}`,
    '--force-device-scale-factor=1',
    '--use-gl=swiftshader',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  env: { ...process.env, OJT_RECORDING: '1' },
  ...(dry ? {} : { recordVideo: { dir: dataDir, size: { width: 1600, height: 900 } } }),
});
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
/** @type {string[]} */
const faults = [];
page.on('pageerror', (error) => faults.push(error.message));
await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  win?.setContentSize(1600, 900);
});
/** @type {Array<{at: number; text: string}>} */
const notes = [];
const start = Date.now();
/** @param {number} ms */
const pause = (ms) => page.waitForTimeout(dry ? Math.min(ms, 450) : ms);
let pointerPosition = { x: 20, y: 20 };
/** @param {string} text @param {number} [hold] */
async function bubble(text, hold = 3200) {
  notes.push({ at: (Date.now() - start) / 1000, text });
  console.log(text);
  await page.evaluate((message) => {
    const target = globalThis.document.getElementById('recording-intent');
    if (target) target.textContent = message;
  }, text);
  await pause(hold);
}
/** @param {number} x @param {number} y */
async function move(x, y) {
  const origin = pointerPosition;
  const steps = dry ? 1 : 12;
  for (let n = 1; n <= steps; n++) {
    const t = n / steps,
      ease = t * t * (3 - 2 * t);
    await page.mouse.move(origin.x + (x - origin.x) * ease, origin.y + (y - origin.y) * ease);
    if (!dry) await page.waitForTimeout(20);
  }
  pointerPosition = { x, y };
  await pause(100);
}
/** @param {import("@playwright/test").Locator} target */
async function click(target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('操作対象が表示されていません');
  await move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await pause(110);
  await page.mouse.up();
  await pause(360);
}
/** @param {{x: number; y: number}} p */
async function point(p) {
  await move(p.x, p.y);
  await page.mouse.down();
  await pause(110);
  await page.mouse.up();
  await pause(380);
}
async function canvas() {
  const c = page.locator('[data-testid="viewport"] canvas');
  await expect(c).toBeVisible();
  const box = await c.boundingBox();
  if (!box) throw new Error('盤を表示できません');
  return box;
}
async function boardReady() {
  await expect(page.getByTestId('status-overlay')).toBeVisible();
  await pause(1700);
}
/** @param {string} mode @param {string} id */
async function openExercise(mode, id) {
  await click(page.getByTestId(`mode-${mode}`));
  await click(
    page.getByTestId('grade-filter').getByRole('button', { name: 'すべて', exact: true }),
  );
  await click(page.getByTestId(`open-${id}`));
  await boardReady();
}
/** @param {string} from @param {string} to */
async function wire(from, to) {
  await point(terminalPoint(toTerminalId(from), await canvas()));
  await point(terminalPoint(toTerminalId(to), await canvas()));
}
/** @param {boolean} on */
async function power(on) {
  if (on) {
    await click(page.getByTestId('power-breaker'));
    await click(page.getByTestId('power-switch'));
  } else {
    await click(page.getByTestId('power-switch'));
    await click(page.getByTestId('power-breaker'));
  }
}
/** @param {string} id @param {number} [ms] */
async function pressPb(id, ms = 650) {
  const p = pushButtonPoint(id, await canvas());
  await move(p.x, p.y);
  await page.mouse.down();
  await pause(ms);
  await page.mouse.up();
  await pause(600);
}
async function assembly() {
  await bubble('回路組立：タイムチャートを読み、自己保持回路を配線して合格まで進めます。', 3900);
  await openExercise('assemble', 'b-001');
  await bubble(
    'PB1を離してもPL1が点灯を続け、PB2で消灯します。CR1のa接点で、運転状態を自己保持しましょう。',
    5100,
  );
  const socket = JIPM_BOARD.sockets[0];
  if (!socket) throw new Error('S1がありません');
  const p = boardPoint(
    {
      x: socket.origin.x + socket.bodyMm.width / 2,
      y: socket.origin.y + socket.bodyMm.length / 2,
      z: 9,
    },
    await canvas(),
  );
  await bubble('右の部品カードからリレーをつかみ、CR1のソケットへドラッグして載せます。', 2800);
  const card = page.getByTestId('palette-relay-my4n');
  await card.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error('部品カードが見つかりません');
  await move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await pause(300);
  await move(p.x, p.y);
  await pause(300);
  await page.mouse.up();
  await pause(600);
  await expect(page.getByTestId('select-S1')).toBeVisible();
  const intents = [
    '電源Pから停止ボタンPB2の共通端子へ。停止を優先させるため、PB2のb接点を使います。',
    'ランプ用のCR1接点にもPを渡します。1端子の電線は2本以内に収めます。',
    'PB2のb接点からPB1の共通端子へ。停止ボタンを押すと、この経路が切れます。',
    'PB1と並列になる自己保持用接点の共通端子へ渡り配線をします。',
    'PB1のa接点からCR1のコイル＋（⑭）へ。PB1を押すとCR1が励磁します。',
    'CR1のa接点（⑤）をコイル＋へ。これでPB1を離しても励磁を続けます。',
    'コイル−（⑬）を電源Nへ。コイルの極性を確認します。',
    'ランプの−側にもNを渡します。まずは通電して点灯を確かめましょう。',
  ];
  for (let i = 0; i < SELF_HOLD_WIRES.length - 1; i++) {
    await bubble(intents[i] ?? '接続を確認します。', i === 0 ? 3800 : 2600);
    const ends = SELF_HOLD_WIRES[i];
    if (!ends) throw new Error('配線がありません');
    await wire(...ends);
  }
  await bubble('ブレーカ → 電源スイッチの順でONにして、PB1を押します。', 2500);
  await power(true);
  await pressPb('PB1');
  await bubble(
    'リレーは保持していますが、ランプが点きません。いったん判定して、どこが不足しているか確認します。',
    4200,
  );
  await click(page.getByTestId('judge-button'));
  await expect(page.getByTestId('verdict')).toHaveText('不合格', { timeout: 60000 });
  await bubble('PL1の動作が仕様と違います。作業へ戻り、ランプまでの経路をたどって直します。', 4200);
  await click(page.getByTestId('result-resume'));
  await boardReady();
  // Resume starts with the supply OFF. Never edit live conductors.
  await bubble(
    'CR1の出力接点（⑥）とPL1の＋の線が抜けていました。電源OFFを確認して、この1本を追加します。',
    4300,
  );
  const finalWire = SELF_HOLD_WIRES.at(-1);
  if (!finalWire) throw new Error('配線がありません');
  await wire(...finalWire);
  await power(true);
  await pressPb('PB1');
  await bubble(
    'PB1を離してもPL1が点灯しています。自己保持は正常です。PB2で止まることも確認します。',
    3600,
  );
  await pressPb('PB2');
  await bubble(
    '停止できました。もう一度判定して、配線の規則とタイムチャートの両方を確認します。',
    3100,
  );
  await click(page.getByTestId('judge-button'));
  await expect(page.getByTestId('verdict')).toHaveText('合格', { timeout: 60000 });
  await bubble(
    '合格です。動かなかったときは「電源 → 操作接点 → コイル → 出力接点 → 負荷」の順で経路を確認しましょう。',
    5500,
  );
}

/** @param {string} id */
async function expand(id) {
  if ((await page.getByTestId(`${id}-details`).getAttribute('open')) === null)
    await click(page.getByTestId(`${id}-summary`));
}
/** @param {string} label */
async function testerMode(label) {
  await click(page.getByTestId('tester-modes').getByRole('button', { name: label, exact: true }));
}
/** @param {string} note */
async function recordMeasurement(note) {
  await expand('measurement-panel');
  const field = page.getByTestId('measurement-panel').getByLabel('測定の目的・気付いたこと');
  await click(field);
  await field.fill(note);
  await expect(field).toHaveValue(note);
  await pause(700);
  await click(page.getByTestId('record-measurement'));
  await expect(page.getByTestId('measurement-record').last()).toContainText(note);
}
/** @param {string} target @param {string} off @param {string} on */
async function contact(target, off, on) {
  await testerMode('導通');
  await click(page.getByTestId(`probe-target-${target}`));
  await expect(page.getByTestId('tester-readout')).toContainText(off);
  const p = pushButtonPoint('PB4', await canvas());
  await move(p.x, p.y);
  await page.mouse.down();
  try {
    await expect(page.getByTestId('tester-readout')).toContainText(on);
    await pause(2300);
  } finally {
    await page.mouse.up();
  }
  await expect(page.getByTestId('tester-readout')).toContainText(off);
}
async function parts() {
  await bubble(
    '部品点検：コイルと接点を測り、4個のリレーの良否を判断します。外観だけで決めないことが大切です。',
    3900,
  );
  await openExercise('inspect-parts', 'c1-001');
  for (const n of [1, 2, 3, 4]) {
    await bubble(
      `部品${n}をチェック用ソケットへ挿します。まずコイル抵抗を測り、次に励磁前後の接点を比べます。`,
      2800,
    );
    await click(page.getByTestId(`plug-p${n}`));
    await power(true);
    await testerMode('Ω');
    await click(page.getByTestId('probe-target-coil'));
    await expect(page.getByTestId('tester-readout')).toContainText(n === 2 ? 'OL' : '650.0');
    await recordMeasurement(
      n === 2 ? 'コイル抵抗がOL。断線を疑う。' : 'コイル抵抗は約650Ω。接点の動作も確認する。',
    );
    if (n === 2) {
      await bubble(
        '抵抗はOLです。コイルの巻線が切れている可能性があります。赤PBで励磁してもa接点が閉じないことを確かめます。',
        4100,
      );
      await contact('a1', 'OL', 'OL');
      await bubble('コイル抵抗がOLで励磁できません。「コイル断線」と判断します。', 3000);
      await click(page.getByTestId('answer-p2-coil-open'));
    } else if (n === 3) {
      await bubble(
        '抵抗が正常なので、いったん「正常」と考えました。しかし、コイルだけでは接点の不良を見逃します。',
        3900,
      );
      await click(page.getByTestId('answer-p3-normal'));
      await bubble(
        'この部品は接点組2を調べます。a接点（⑩–⑥）が励磁してもOLのままか確認しましょう。',
        3800,
      );
      await contact('a2', 'OL', 'OL');
      await bubble(
        'a接点が閉じません。b接点（⑩–②）が通常どおり開閉すれば、b接点の溶着ではなくa接点の断線です。',
        4500,
      );
      await contact('b2', '導通', 'OL');
      await bubble('b接点は正常に開閉しました。先ほどの解答を「a接点 導通不良」に直します。', 3400);
      await click(page.getByTestId('answer-p3-a-open'));
    } else {
      await bubble(
        'コイル抵抗は約650Ωです。赤PBを押すとa接点が閉じ、離すと開くことを確認します。',
        3300,
      );
      await contact('a1', 'OL', '導通');
      await bubble('次はb接点。赤PBを離していると導通し、押すと開けば正常です。', 2800);
      await contact('b1', '導通', 'OL');
      await click(page.getByTestId(`answer-p${n}-normal`));
    }
    await testerMode('OFF');
    await power(false);
    await click(page.getByTestId(`eject-p${n}`));
  }
  await bubble(
    '4個すべてを測って解答できました。判定で、測定結果と判断が合っているか確認します。',
    3500,
  );
  await click(page.getByTestId('judge-button'));
  await expect(page.getByTestId('verdict')).toHaveText('合格', { timeout: 60000 });
  await bubble(
    '全問正解です。コイル抵抗・a接点・b接点の3つをそろえて確認すると、正常品と故障品を区別できます。',
    5200,
  );
}
/** @param {string} black @param {string} red */
async function probes(black, red) {
  for (const [side, terminal] of [
    ['black', black],
    ['red', red],
  ]) {
    if (!side || !terminal) continue;
    const target = page.getByTestId(`probe-${side}`);
    const displayed = terminal.replace(/^S1\./, 'CR1.');
    // 同じ端子を再度押すとプローブが外れる。移す必要のある側だけを操作する。
    if ((await target.innerText()).includes(displayed)) continue;
    await click(target);
    await point(terminalPoint(toTerminalId(terminal), await canvas()));
  }
}
/** @param {string} expected */
async function voltageWhileStarting(expected) {
  const p = pushButtonPoint('PB1', await canvas());
  await move(p.x, p.y);
  await page.mouse.down();
  try {
    await expect(page.getByTestId('tester-readout')).toContainText(expected);
    await pause(2400);
  } finally {
    await page.mouse.up();
  }
}
/**
 * 3D図で電線を押す（指摘の小窓が、その電線を指して開くまで）。
 * 押す点は電線の経路の長い区間の中ほどから選ぶ（端の圧着端子や交差する電線に当たりにくい）。
 * 収録の画面の大きさと視点は毎回同じなので、ふつうは最初の点で当たる。
 * @param {string} wireId
 */
async function clickWire(wireId) {
  const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === 'c2-001');
  if (!problem) throw new Error('C2-001がありません');
  const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const session = built.value.session;
  const wire = session.wires.find((w) => w.id === wireId);
  const route = routeSession(JIPM_BOARD, session).find((r) => r.wireId === wireId);
  if (!wire || !route) throw new Error(`電線 ${wireId} がありません`);
  /** @type {Array<{p: {x: number; y: number; z: number}; length: number}>} */
  const candidates = [];
  for (let i = 0; i + 1 < route.corners.length; i += 1) {
    const a = route.corners[i],
      b = route.corners[i + 1];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    for (const t of [0.5, 0.35, 0.65])
      candidates.push({
        p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
        length,
      });
  }
  candidates.sort((a, b) => b.length - a.length);
  const label = `${String(wire.from)}–${String(wire.to)} の${wire.color}線`;
  const box = await canvas();
  const popover = page.getByTestId('report-popover');
  let attempts = 0;
  for (const { p } of candidates) {
    const screen = boardPoint(p, box);
    if (screen.x < box.x || screen.x > box.x + box.width) continue;
    if (screen.y < box.y || screen.y > box.y + box.height) continue;
    attempts += 1;
    await point(screen);
    if ((await popover.count()) > 0 && ((await popover.textContent()) ?? '').includes(label)) {
      console.log(`電線 ${wireId} を ${attempts} 回目の点で押せました`);
      return;
    }
    if ((await popover.count()) > 0) await page.getByTestId('report-cancel').click();
  }
  throw new Error(`3D図で電線 ${wireId} を押せませんでした`);
}
async function repair() {
  await bubble('回路点検・修復：自己保持回路の故障2箇所を、測定結果から絞り込んで直します。', 3600);
  await openExercise('inspect-repair', 'c2-001');
  await power(true);
  await pressPb('PB1');
  await bubble(
    'PB1を押してもリレーもランプも動きません。コイル不良を疑う前に、起動信号がコイルまで届くか測りましょう。',
    4500,
  );
  await testerMode('DCV');
  await probes('N.1', 'TB_PB.1a');
  await bubble(
    '黒をN、赤をPB1のa接点出力へ。当てた場所は3D図のプローブと端子名の札で分かります。PB1を押したとき、約24Vが出るか確認します。',
    4600,
  );
  await voltageWhileStarting('24.');
  await probes('N.1', 'S1.14');
  await bubble(
    '次に、赤をコイル＋（CR1の⑭）へ移します。同じ起動操作で0Vなら、PB1からコイルの間が疑わしくなります。',
    4400,
  );
  await voltageWhileStarting('0.00');
  await power(false);
  await testerMode('Ω');
  await probes('S1.13', 'S1.14');
  await expect(page.getByTestId('tester-readout')).toContainText('650.0');
  await recordMeasurement(
    '電源OFFでコイル約650Ω。コイル不良ではなく、PB1からコイルへの配線を疑う。',
  );
  await bubble(
    'コイル抵抗は約650Ωで正常でした。最初の疑いを修正し、PB1のa接点からCR1⑭への断線を調べます。',
    4300,
  );
  await testerMode('OFF');
  await bubble(
    '故障の場所を指摘します。上の「指摘」を選び、3D図で断線している電線（PB1のa接点からCR1⑭への青線）を直接押します。',
    4600,
  );
  await click(page.getByTestId('tool-report'));
  await clickWire('sw-005');
  await expect(page.getByTestId('report-popover')).toBeVisible();
  await bubble(
    '押した場所の横に小窓が出ます。電線なら断線・誤配線、端子なら未配線、部品なら部品不良とその内容を選べます。ここでは「断線」です。',
    5200,
  );
  await click(page.getByTestId('report-kind-wire-open'));
  await expect(page.getByTestId('report-count')).toHaveText('1');
  await bubble(
    '同じ指摘は右の電線一覧からもできます。電線を選んで「この電線の故障を指摘」を押すと、同じ小窓が開きます。3Dで押しにくい電線に便利です。',
    5000,
  );
  await expand('wire-list');
  await click(page.getByTestId('wire-row-sw-005'));
  await click(page.getByRole('button', { name: 'この電線の故障を指摘', exact: true }));
  await expect(page.getByTestId('report-popover')).toBeVisible();
  await bubble('この電線はもう指摘してあるので、ここでは「取消」で閉じます。', 2800);
  await click(page.getByTestId('report-cancel'));
  await bubble('指摘できました。故障した青線だけを外し、同じ両端を白線でつなぎ直します。', 3400);
  await click(page.getByRole('checkbox', { name: '選択 sw-005', exact: true }));
  await click(page.getByRole('button', { name: '選択した電線を削除（Undo可）', exact: true }));
  await click(page.getByRole('button', { name: '白', exact: true }));
  await wire('TB_PB.1a', 'S1.14');
  await power(true);
  await pressPb('PB1');
  await bubble(
    'リレーは自己保持するようになりましたが、ランプはまだ消灯しています。2つ目の故障を、出力側で調べます。',
    4000,
  );
  await testerMode('DCV');
  await probes('N.1', 'S1.6');
  await expect(page.getByTestId('tester-readout')).toContainText('24.');
  await recordMeasurement('リレー保持中、CR1⑥はNに対し約24V。出力接点までは正常。');
  await bubble(
    'CR1⑥には約24Vがあります。赤をPL1の＋へ移すと0Vです。接点からランプへの線が足りないことが分かります。',
    4300,
  );
  await probes('N.1', 'TB_PL.1+');
  await expect(page.getByTestId('tester-readout')).toContainText('0.00');
  await recordMeasurement('CR1⑥は24VだがPL1＋は0V。両端をつなぐ電線が未配線。');
  await power(false);
  await testerMode('OFF');
  await bubble(
    '線が無い場所は、端子を押して指摘します。「指摘」を選び、3D図でPL1の＋端子を押して「未配線」を選びます。',
    4200,
  );
  await click(page.getByTestId('tool-report'));
  await point(terminalPoint(toTerminalId('TB_PL.1+'), await canvas()));
  await expect(page.getByTestId('report-popover')).toBeVisible();
  await pause(1200);
  await click(page.getByTestId('report-kind-wire-missing'));
  await expect(page.getByTestId('report-count')).toHaveText('2');
  await bubble(
    'PL1の＋端子を「未配線」として指摘しました。電源OFFのまま、CR1⑥からPL1＋へ白線を追加します。',
    4000,
  );
  await click(page.getByRole('button', { name: '白', exact: true }));
  await wire('S1.6', 'TB_PL.1+');
  await power(true);
  await pressPb('PB1');
  await pause(1000);
  await pressPb('PB2');
  await bubble(
    '起動・自己保持・停止を確認できました。指摘2件と修復内容をそろえて判定します。',
    3500,
  );
  await click(page.getByTestId('judge-button'));
  await expect(page.getByTestId('verdict')).toHaveText('合格', { timeout: 60000 });
  await bubble(
    '合格です。電圧が届く位置と届かない位置を比較して故障区間を絞り、修復後は一連の動作を確認します。',
    5200,
  );
}

/** @param {string} keyName */
async function ladderKey(keyName) {
  await page.getByTestId('ladder-editor').press(keyName);
  await pause(350);
}
/** @param {string} value */
async function device(value) {
  await click(page.getByTestId('device-text'));
  await page.getByTestId('device-text').fill('');
  await page.keyboard.type(value, { delay: dry ? 10 : 160 });
  await click(page.getByTestId('device-commit'));
  // CX-Programmer風は、デバイスを確定すると続けてコメント欄が開く（Enter で確定する）
  const comment = page.getByTestId('entry-comment');
  if (await comment.isVisible()) {
    await pause(500);
    await comment.press('Enter');
  }
  await expect(page.getByTestId('device-input')).toHaveCount(0);
}

/**
 * PLC動画のメーカー別の台本（2026-09-26 利用者指示「他メーカーのPLCでも同様にチュートリアルの
 * 動画を作成して（他メーカーのシーケンサーでは配線も変わるため）」）。
 *
 * 同じ課題 D-001 を、各メーカーの端子名・デバイス表記・入力操作で最後まで解く。デバイスの綴りは
 * 方言の `formatDevice()`、端子名と配線の順は `plcWiringPlan()` から取るので、表記を台本に
 * 書き写さない。キー割当の無いPCwin風（JTEKT）は記号ボタンで置く。
 * @type {Record<string, {
 *   model: string;
 *   tool: string;
 *   keys: Record<'contact-no' | 'contact-nc' | 'or-contact-no' | 'coil', string> | undefined;
 *   networkKey: string | undefined;
 *   convertKey: string | undefined;
 *   notation: string;
 *   entry: string;
 * }>}
 */
const PLC_VENDORS = {
  mitsubishi: {
    model: 'FX5U',
    tool: '三菱電機 FX5U（GX Works3風）',
    keys: { 'contact-no': 'F5', 'contact-nc': 'F6', 'or-contact-no': 'Shift+F5', coil: 'F7' },
    networkKey: undefined,
    convertKey: 'F4',
    notation: '',
    entry: '',
  },
  jtekt: {
    model: 'PC10G-1SP',
    tool: 'JTEKT TOYOPUC PC10G（PCwin風）',
    keys: undefined,
    networkKey: undefined,
    convertKey: undefined,
    notation:
      'TOYOPUCのデバイスは「プログラム番号＋種類＋16進3桁」です。入力の端子X0は1X000、出力の端子Y10は1Y010と書きます。',
    entry:
      'PCwin風にはキーの割当がありません。置きたいマスを押してから、上の記号ボタン（a接点・b接点・OR・コイル）を押して置きます。',
  },
  omron: {
    model: 'CP1E',
    tool: 'OMRON CP1E（CX-Programmer風）',
    keys: { 'contact-no': 'C', 'contact-nc': '/', 'or-contact-no': 'W', coil: 'O' },
    networkKey: 'R',
    convertKey: undefined,
    notation:
      'CP1Eのデバイスは「チャネル.ビット」です。入力は0.00から、出力は100.00から始まり、本体の端子の名前と同じです。',
    entry:
      'キーはCでa接点、/でb接点、WでOR接点、Oでコイルです。番号を確定するとコメント欄が開くので、Enterで閉じます。',
  },
  sharp: {
    model: 'JW-300',
    tool: 'シャープ JW300（JW-300SP風）',
    keys: { 'contact-no': 'S', 'contact-nc': 'D', 'or-contact-no': 'G', coil: 'X' },
    networkKey: 'L',
    convertKey: undefined,
    notation:
      'JW300のリレー番号は8進6桁です。入力の端子A0は000000、出力の端子C0は000020と書きます。端子名と番号が違う点に注意します。',
    entry:
      'JW-300SP風は先に記号を置き、Enterで番号を入れます。キーはSでA接点、DでB接点、GでOR接点、Xでコイル、Lで回路の追加です。',
  },
};

/**
 * 記号を1つ置く（キーの割当があるメーカーはキー、無いメーカーは記号ボタン）。
 * @param {typeof PLC_VENDORS[string]} vendor
 * @param {'contact-no' | 'contact-nc' | 'or-contact-no' | 'coil'} kind
 */
async function placeSymbol(vendor, kind) {
  if (vendor.keys === undefined) await click(page.getByTestId(`symbol-${kind}`));
  else await ladderKey(vendor.keys[kind]);
  // 置いただけで番号の入力が開かないスキン（下書きのマス）は Enter で開く
  if ((await page.getByTestId('device-input').count()) === 0) await ladderKey('Enter');
  await expect(page.getByTestId('device-input')).toBeVisible();
}
/** @param {string} id */
async function cell(id) {
  await click(page.getByTestId(`cell-${id}`));
}
/** @param {typeof PLC_VENDORS[string]} vendor */
async function addNetwork(vendor) {
  if (vendor.networkKey !== undefined) {
    await ladderKey(vendor.networkKey);
    return;
  }
  await click(page.getByTestId('native-menu-edit'));
  await click(page.getByTestId('native-item-insert-network'));
}

/** @param {string} vendorId */
async function plc(vendorId) {
  const vendor = PLC_VENDORS[vendorId];
  if (vendor === undefined) throw new Error(`メーカーの台本がありません: ${vendorId}`);
  const problem = BUILTIN_PLC_PROBLEMS[0];
  if (!problem) throw new Error('PLC課題がありません');
  const unit = plcUnitFor(vendor.model);
  if (unit === undefined) throw new Error(`PLC本体の定義がありません: ${vendor.model}`);
  const dialect = getDialect(/** @type {import('@ojt/plc-dialects').DialectId} */ (vendorId));
  /** @param {'input' | 'output'} kind @param {number} index */
  const dev = (kind, index) => dialect.formatDevice({ kind, index });
  const roles = toSocketRoles(problem.board.socketRoles),
    io = resolvePlcIo(problem.io);
  const coil = String(COIL_COL);
  await bubble(
    `PLC（${vendor.tool}）：I/O表を確認して配線し、自己保持・停止確認・点検灯のラダーを入力して合格まで進めます。`,
    4600,
  );
  await openExercise('plc', problem.id);
  await expect(page.getByTestId('plc-model')).toContainText(unit.displayName);
  await bubble(
    'まず仕様のタイムチャートを確認します。上の「タイムチャートを見る」を押すと、左の欄の仕様のチャートへ移ります。',
    3800,
  );
  await click(page.getByTestId('plc-show-chart'));
  await pause(1200);
  await click(page.getByTestId('chart-panel').getByTestId('chart-enlarge-button').first());
  await expect(page.getByTestId('chart-modal')).toBeVisible();
  await bubble(
    '「拡大」で大きく表示できます。PB1を押すとPL1が点き、PB2で消えるまで続く――この動きをラダーで作ります。',
    4600,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chart-modal')).toHaveCount(0);
  await pause(500);
  await bubble(
    `${dev('input', 0)}で運転を開始し、${dev('input', 1)}で停止します。${dev('output', 0)}の接点を${dev('input', 0)}と並列に置き、ボタンを離しても出力を保持します。`,
    4600,
  );
  if (vendorId === 'mitsubishi') {
    await ladderKey('F5');
    await click(page.getByTestId('device-text'));
    await page.keyboard.type('X9', { delay: dry ? 10 : 150 });
    await click(page.getByTestId('device-commit'));
    await expect(page.getByTestId('device-error')).toBeVisible();
    await bubble(
      'X9と入力してエラーになりました。三菱のX・Yは8進表記です。I/O表の起動入力はX0なので、番号を直します。',
      4600,
    );
    await device('X0');
    await ladderKey('ArrowLeft');
    await ladderKey('Shift+F5');
    await device('Y0');
  } else {
    await bubble(vendor.notation, 4800);
    await bubble(vendor.entry, 4600);
    await cell('n1:0:0');
    await placeSymbol(vendor, 'contact-no');
    await device(dev('input', 0));
    await cell('n1:0:0');
    await placeSymbol(vendor, 'or-contact-no');
    await device(dev('output', 0));
    // OR接点は閉じ側の縦線を右隣の列に引く。縦線の上に置かないよう、その次の列から続ける
    await cell('n1:0:2');
  }
  await bubble(
    `自己保持の分岐の後ろに${dev('input', 1)}のb接点を置きます。停止ボタンを押したときは保持回路も切れる配置です。`,
    4000,
  );
  await placeSymbol(vendor, 'contact-nc');
  await device(dev('input', 1));
  await cell(`n1:0:${coil}`);
  await placeSymbol(vendor, 'coil');
  await device(dev('output', 0));
  await bubble(
    `2段目は停止確認灯です。${dev('output', 0)}がOFF、かつ${dev('input', 1)}がONのときに${dev('output', 1)}をONにします。`,
    3800,
  );
  await addNetwork(vendor);
  await placeSymbol(vendor, 'contact-nc');
  await device(dev('output', 0));
  await placeSymbol(vendor, 'contact-no');
  await device(dev('input', 1));
  await cell(`n2:0:${coil}`);
  await placeSymbol(vendor, 'coil');
  await device(dev('output', 1));
  await bubble(
    `3段目は点検灯。${dev('input', 2)}を押している間だけ${dev('output', 2)}がONになる回路を作ります。`,
    3500,
  );
  await addNetwork(vendor);
  await placeSymbol(vendor, 'contact-no');
  await device(dev('input', 2));
  await cell(`n3:0:${coil}`);
  await placeSymbol(vendor, 'coil');
  await device(dev('output', 2));
  if (vendor.convertKey !== undefined) {
    await bubble(
      `${vendor.convertKey}で変換し、入力の誤りや未接続がないか確認します。変換が通ってから配線を進めます。`,
      3400,
    );
    await ladderKey(vendor.convertKey);
    await expect(page.getByTestId('convert-state')).toHaveText('変換に成功しました');
  } else {
    await expect(page.getByTestId('convert-state')).toHaveText(
      '変換に成功しました（自動で変換されます）',
    );
    await bubble(
      'このメーカーのツールには「変換」の操作がありません。入力するたびに自動で変換され、下の欄に結果が出ます。',
      4200,
    );
  }
  await click(page.getByTestId('view-board'));
  await pause(1200);
  const outputs = [0, 1, 2].map((i) => dev('output', i)).join('・');
  await bubble(
    `${outputs}は中継リレーCR1〜CR3を動かします。ランプをPLC出力へ直接つながず、リレー3個を載せます。`,
    4200,
  );
  for (const socket of JIPM_BOARD.sockets.slice(0, 3)) {
    await point(
      plcBoardPointFor(
        unit,
        {
          x: socket.origin.x + socket.bodyMm.width / 2,
          y: socket.origin.y + socket.bodyMm.length / 2,
          z: 9,
        },
        await canvas(),
      ),
    );
    await click(page.getByTestId('mount-relay-my4n'));
  }
  const unordered = plcWiringPlan(io, unit);
  const plan = [
    ...unordered.filter((w) => String(w.from).startsWith('OUTLET.')),
    ...unordered.filter((w) => !String(w.from).startsWith('OUTLET.')),
  ];
  /** 端子の表示名（本体に印字された名前。`PLC.SS` は `S/S`）。 @param {string} id */
  const name = (id) =>
    unit.terminals.find((t) => String(t.id) === id)?.label ?? id.replace(/^PLC\./u, '');
  const supply = plan
    .filter((w) => String(w.from).startsWith('OUTLET.'))
    .map((w) => name(String(w.to)));
  const inputs = io.inputs.map((_, i) =>
    name(String(plan.find((w) => String(w.from) === `TB_PB.${i + 1}a`)?.to ?? '')),
  );
  const inputCommonId = String(plan.find((w) => String(w.from) === 'P.1')?.to ?? '');
  const inputCommon = name(inputCommonId);
  const outputCommon = name(String(plan.find((w) => String(w.from) === inputCommonId)?.to ?? ''));
  const firstOutput = name(String(plan.find((w) => String(w.to) === 'CR1.14')?.from ?? ''));
  for (const [i, w] of plan.entries()) {
    const from = String(w.from),
      to = String(w.to);
    if (i === 0)
      await bubble(
        `まずPLC本体の電源端子（${supply.join('・')}）を壁コンセントのL・Nへ。盤の24V電源P・Nとは別の系統です。`,
        4200,
      );
    else if (from === 'TB_PB.1a')
      await bubble(
        `押ボタンPB1〜PB3のa接点を、I/O表どおり入力端子 ${inputs.join('・')} へつなぎます。端子名はメーカーごとに違います。`,
        4200,
      );
    else if (to === 'CR1.14')
      await bubble(
        `出力 ${firstOutput} からCR1のコイル＋（⑭）へ。CR2・CR3も同じ順に、出力の番号を1つずつ進めてつなぎます。`,
        4000,
      );
    else if (from === 'CR1.5')
      await bubble('CR1〜CR3のa接点（⑤）から、ランプPL1〜PL3の＋へつなぎます。', 3200);
    else if (from === 'P.1')
      await bubble(
        `I/O表の入力方式はシンクです。入力の共通端子 ${inputCommon} へPをつなぎ、押ボタンの共通側はNへ戻します。`,
        4200,
      );
    else if (from === inputCommonId)
      await bubble(
        `出力の共通端子 ${outputCommon} にもPを渡し、そこからリレー接点の共通（⑨）へ送ります。1端子の電線は2本までです。`,
        4300,
      );
    else if (from === 'N.1')
      await bubble('Nは押ボタンの共通、CR1〜CR3のコイル−（⑬）、ランプの−へ順に渡します。', 3400);
    await point(plcTerminalPointFor(unit, roles, from, await canvas()));
    await point(plcTerminalPointFor(unit, roles, to, await canvas()));
    await expect(page.getByTestId('status-overlay')).toContainText(`自分で張った電線 ${i + 1} 本`);
  }
  await bubble(
    '配線できました。盤電源をONにし、モニタを開始してRUNにします。PLCの電源状態も確認します。',
    3400,
  );
  await power(true);
  await click(page.getByTestId('view-split'));
  await pause(800);
  await click(page.getByTestId('toolbar-monitor-start'));
  await click(page.getByTestId('toolbar-plc-run'));
  await click(page.getByTestId('view-board'));
  await pause(700);
  for (const [id, message] of [
    ['PB1', 'PB1で運転開始。離してもPL1が点灯し続ければ自己保持ができています。'],
    ['PB3', 'PB3を押している間、PL3が点灯することを確認します。'],
    ['PB2', 'PB2でPL1が消灯し、押している間はPL2が点灯します。停止確認の回路も正常です。'],
  ]) {
    await bubble(message ?? '', 3200);
    const definition = JIPM_BOARD.pushButtons.find((pb) => pb.id === id);
    if (!definition) throw new Error('PBがありません');
    const p = plcBoardPointFor(
      unit,
      { x: definition.pos.x, y: definition.pos.y, z: 4.5 },
      await canvas(),
    );
    await move(p.x, p.y);
    await page.mouse.down();
    await pause(1800);
    await page.mouse.up();
    await pause(700);
  }
  await bubble(
    '3つの動作を確認できました。判定で電源・I/O・リレー経由の配線とタイムチャートをまとめて確認します。',
    3800,
  );
  await click(page.getByTestId('judge-button'));
  await expect(page.getByTestId('verdict')).toHaveText('合格', { timeout: 60000 });
  await bubble(
    `合格です。入力が入らないときは共通端子 ${inputCommon} と電源、出力ONでも点灯しないときはコイルからランプまでの経路を順に調べましょう。`,
    5500,
  );
}
let success = false;
let contentEndSec = 0;
/** @type {unknown} */
let backgroundCapture;
try {
  await expect(page.getByTestId('mode-assemble')).toBeVisible({ timeout: 30000 });
  if (!dry) {
    const coverPath = join(dataDir, 'recording-cover.html');
    writeFileSync(
      coverPath,
      '<!doctype html><meta charset="UTF-8"><title>操作動画の収録</title><body style="background:#17212f;color:#edf2f7;font:20px sans-serif;padding:48px"><h1>操作動画を背面で収録しています</h1><p>この下にある練習画面を操作しています。収録中もほかのウィンドウを使用できます。</p></body>',
    );
    backgroundCapture = await app.evaluate(async ({ BrowserWindow }, file) => {
      const target = BrowserWindow.getAllWindows()[0];
      if (!target) throw new Error('収録対象がありません');
      const cover = new BrowserWindow({
        ...target.getBounds(),
        show: false,
        title: '操作動画の収録',
        backgroundColor: '#17212f',
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await cover.loadFile(file);
      cover.show();
      cover.moveTop();
      cover.focus();
      await new Promise((done) => globalThis.setTimeout(() => done(undefined), 150));
      return {
        covered: true,
        focused: target.isFocused(),
        throttling: target.webContents.getBackgroundThrottling(),
        bounds: target.getBounds(),
      };
    }, coverPath);
  }
  await page.evaluate(() => {
    const style = globalThis.document.createElement('style');
    style.textContent = `#recording-pointer{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:32px;height:40px;filter:drop-shadow(0 2px 3px #000b)} #recording-ring{position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;border:4px solid #ffbd2e;border-radius:50%;opacity:0;transform:translate(-50%,-50%)} #recording-ring.active{opacity:.85} #recording-intent{position:fixed;z-index:2147483645;pointer-events:none;bottom:36px;left:26px;max-width:600px;background:#fffdf1;color:#17212f;border:3px solid #e7ae24;border-radius:16px;padding:16px 22px;box-shadow:0 5px 24px #0008;font:600 20px/1.65 'Yu Gothic UI',sans-serif;white-space:pre-wrap}`;
    globalThis.document.head.append(style);
    const pointer = globalThis.document.createElement('div');
    pointer.id = 'recording-pointer';
    pointer.innerHTML =
      '<svg viewBox="0 0 32 40"><path d="M3 2 L3 31 L11 23 L17 37 L23 34 L17 21 L28 21 Z" fill="#fff" stroke="#142333" stroke-width="2.5"/></svg>';
    const ring = globalThis.document.createElement('div');
    ring.id = 'recording-ring';
    const note = globalThis.document.createElement('div');
    note.id = 'recording-intent';
    globalThis.document.body.append(pointer, ring, note);
    globalThis.document.addEventListener('pointermove', (event) => {
      pointer.style.transform = `translate(${event.clientX}px,${event.clientY}px)`;
    });
    globalThis.document.addEventListener('pointerdown', (event) => {
      ring.style.left = `${event.clientX}px`;
      ring.style.top = `${event.clientY}px`;
      ring.classList.add('active');
    });
    globalThis.document.addEventListener('pointerup', () =>
      globalThis.setTimeout(() => ring.classList.remove('active'), 450),
    );
  });
  if (mode === 'assembly') await assembly();
  else if (mode === 'parts') await parts();
  else if (mode === 'repair') await repair();
  else if (plcVendor !== undefined) await plc(plcVendor);
  else throw new Error(`収録シナリオが未定義です: ${mode}`);
  await page.screenshot({ path: join(runDir, `${mode}-passed.png`) });
  contentEndSec = (Date.now() - start) / 1000;
  success = true;
} catch (error) {
  await page.screenshot({ path: join(runDir, `${mode}-failed.png`) }).catch(() => undefined);
  writeFileSync(
    join(runDir, `${mode}-failed-ui.txt`),
    await page
      .locator('body')
      .innerText()
      .catch(() => 'closed'),
  );
  throw error;
} finally {
  const video = page.video();
  await app.close();
  writeFileSync(
    join(runDir, `${mode}-notes.json`),
    JSON.stringify(
      {
        success,
        durationSec: (Date.now() - start) / 1000,
        contentEndSec,
        notes,
        faults,
        dataDir,
        backgroundCapture,
      },
      null,
      2,
    ),
  );
  if (success && video && !dry) copyFileSync(await video.path(), join(destination, `${mode}.webm`));
}
