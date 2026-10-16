# v2.1.0 総点検 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（このリポジトリの AGENTS.md はサブエージェントを禁じているので、同じセッションで順に実行する）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重なり・見にくさ（ビューキューブ・自動保存の表示・3Dの名札・視差・狭い欄・狭い窓・小窓の位置）を直し、PLCの書込み・表示灯・運転状態・現在値の表示を実機に寄せ、説明書の図を約120枚に増やして本文を実画面に合わせ、動画9本を撮り直して v2.1.0 として公開する。

**Architecture:** 既存の層分けを保つ。カメラの合わせ方は `three/camera.ts` の純関数に閉じ、E2E の射影も同じ関数を読む。PLC のプログラム（書き込まれた写し）はストアと作業ファイルに持ち、Worker へは書込みのときだけ送る。表示灯はスナップショットに常に載せる `plcIo` から決める純関数（`three/appearance.ts`）にする。

**Tech Stack:** TypeScript / zod 4 / Vitest / React 19 / zustand / three 0.186 + @react-three/fiber 9 + drei / Electron / Playwright（SwiftShader）。

設計: `docs/superpowers/specs/2026-10-16-v2-1-0-quality-pass-design.md`（点検の記録は `OJT/release/verification/audit-2026-10-16/findings.md`）

Git運用（利用者決定 2026-10-16）: **各タスクが緑になった時点で日本語のコミットメッセージでコミットし、`git push origin HEAD:main` する**（pre-push フックが全テスト。push 中は追跡ファイルを触らない）。コミットの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。公開は Task 16 だけ（v2.1.0）。

報告は「タスク X / 16」で行う。

---

## ファイル構成

| 区分 | ファイル | 役割 |
|---|---|---|
| 変更 | `apps/desktop/src/renderer/three/{camera,CameraPresets,ViewGizmo,view-gizmo-layout}.ts(x)`、`e2e/projection.ts` | 視野角・寄れる距離・キューブを避ける合わせ方・「上から」の合わせ方・キューブの置き場所 |
| 新規 | `apps/desktop/src/renderer/panels/AutosaveStatus.tsx` | 自動保存の表示（下の帯・結果の帯に置く） |
| 変更 | `apps/desktop/src/renderer/{app/App.tsx,panels/SessionActivity.tsx,result/ResultShell.tsx}` | 固定表示をやめ、帯の中へ |
| 変更 | `apps/desktop/src/renderer/three/{PlcUnit,PlcRack,Fixtures,Outlet,label-declutter,labels}.tsx/ts` | 銘板を面に描く、名札の端を機器の外へ、名札の表示の切替 |
| 変更 | `apps/desktop/src/shared/{ipc,settings-validation}.ts`、`renderer/panels/Toolbar.tsx`、`renderer/app/ui-preferences.ts` | 「3Dの名札を表示」の設定 |
| 変更 | `apps/desktop/src/renderer/ladder/{LadderWorkspace,IoTable,SidePanel}.tsx`、`ladder.module.css`、`screens/screens.module.css` | PLCの右の欄・I/O割付・説明の欄・狭い窓 |
| 変更 | `apps/desktop/src/renderer/panels/ReportPopover.tsx`、`screens/InspectRepairSession.tsx`、`session/step-guide.ts`、`screens/InspectPartsSession.tsx`、`help/HelpDrawer.tsx` | 小窓の位置、C1の手順帯、図の拡大 |
| 変更 | `apps/desktop/src/worker/sim.worker.ts`、`renderer/session/runtime-bridge*.ts`、`renderer/three/appearance.ts`、`renderer/screens/PlcSession.tsx` | `plcIo`、表示灯、電源なしの札 |
| 変更 | `apps/desktop/src/renderer/app/store-ladder.ts`、`ladder/LadderWorkspace.tsx`、`screens/PlcSession.tsx`、`lab/*`、`shared/work-file-*.ts`、`packages/plc-dialects/src/{profile,jtekt}.ts`（ツールバーの書込み） | PLC のプログラムと書込み・判定・作業ファイル |
| 変更 | `apps/desktop/src/renderer/ladder/LadderGrid.tsx` | モニタ中の現在値 |
| 変更 | `docs/manual/*.md`、`shots.json`、`coverage.json`、`apps/desktop/e2e/{manual-shots,manual-walkthrough}.spec.ts`、`test/manual-appdata.test.ts` | 説明書・図・通し点検 |
| 変更 | `apps/desktop/scripts/record-tutorials.mjs`、`docs/tutorial-recording.md`、`src/renderer/public/tutorials/*` | 動画 |
| 変更 | `apps/desktop/package.json`、`docs/releases/v2.1.0.md`、`README.md` | 版・リリースノート |

---

### Task 1: 点検の記録・設計・計画

**Files:** Create `docs/superpowers/specs/2026-10-16-v2-1-0-quality-pass-design.md`、`docs/superpowers/plans/2026-10-16-v2-1-0-quality-pass.md`（点検の画像と `findings.md` は `OJT/release/verification/audit-2026-10-16/`、リポジトリ外）

- [x] **Step 1:** `ui-quality` を `OJT_SHOT_DIR` 付きで流して全画面×3サイズを撮り、追加撮影（ヘルプ・動画・実験・視点）と視野角の比較を撮る。
- [x] **Step 2:** 画像を1枚ずつ見て `findings.md` にまとめ、設計を書く。
- [x] **Step 3:** コミット「v2.1.0 総点検の設計と計画を追加する」→ push。

### Task 2: 自動保存の表示を帯の中へ移す（U2）

**Files:** Create `apps/desktop/src/renderer/panels/AutosaveStatus.tsx`; Modify `app/App.tsx`、`panels/SessionActivity.tsx`、`panels/session-activity.module.css`、`result/ResultShell.tsx`; Test `apps/desktop/test/autosave-status.test.tsx`（新規）

- [x] **Step 1: 失敗するテスト** — `SessionActivity` を描くと帯（`activity-toggle`）の中に `autosave-status` があり、状態ごとの文言（「自動保存待ち」「自動保存中…」「自動保存済み 12:34:56」「自動保存失敗 — 再試行」）が出る。再試行ボタンを押しても `<details>` が開閉しない（`open` が変わらない）。`App` は `position: fixed` の `autosave-status` を描かない。
- [x] **Step 2:** `App.tsx` の固定表示を `AutosaveStatus`（`useAutosaveStatus()` を読む小さな部品）に切り出し、`SessionActivity` の経過時間の左と `ResultShell` の下の帯の右端に置く。`App.tsx` からは消す。再試行ボタンは `onClick` で `preventDefault()`・`stopPropagation()`。
- [x] **Step 3:** 単体テスト・`walkthrough` の `08-autosave`・`ui-quality` の該当画面を流す。`ui-quality.spec.ts` の重なりの例外から `autosave-status` を外す。
- [x] **Step 4:** 説明書 08章「画面右下の…」を「下の帯の…」に直す（図は Task 13）。
- [x] **Step 5:** コミット「自動保存の表示を下の帯に移し、右の欄のボタンを覆わないようにする」→ push。

### Task 3: 視野角とビューキューブを避けるカメラ（U1・U4・U10・U11）

**Files:** Modify `three/camera.ts`、`three/CameraPresets.tsx`、`three/ViewGizmo.tsx`、`three/view-gizmo-layout.ts`、`three/BoardScene.tsx`、`e2e/projection.ts`; Test `test/camera-fit.test.ts`（新規）、既存の `scene.test.ts`・`terminal-field.test.ts`・`terminal-pick.test.ts`・`view-gizmo.test.tsx`

- [x] **Step 1: 失敗するテスト** — `cameraPose(preset, { aspect, viewportPx })` について、盤ペイン 1264×700・1424×800・1904×960、PLC分割 640×320、並べて 900×300 の各大きさ × プリセット（front・socket・plc・top）で、中身の箱（盤: 330×235mm＋部品の高さ 60mm、PLC: `plcViewRect()`）の8隅を射影した外接矩形が、`gizmoLayoutForViewport()` の下地の正方形（左上 `[0, 2·margin]²`）と交わらず、ペインの内側に収まる。視野角は 24°。
- [x] **Step 2:** `CAMERA_FOV_DEG = 24`、`MIN_CAMERA_DISTANCE_MM = 145`、`MAX_CAMERA_DISTANCE_MM = 1900`。`fitPose()` を足し、プリセットの向き（前方ベクトル・上）と中身の点群から距離を求める（面直のプリセットは `fitDistanceMm` を使い、「上から」は8隅が収まる距離を二分探索）。`viewportPx` があればキューブの正方形を避ける2案（横・縦）を計算して大きく映るほうを選び、注視点と位置を平行にずらす。
- [x] **Step 3:** `CameraPresets.tsx` が `useThree(s => s.size)` の幅・高さを `viewportPx` で渡す。`e2e/projection.ts` の `cameraPose(...)` 呼び出しにも `viewportPx: { width: box.width, height: box.height }` を渡す（`terminalPoint` ほか全部）。`ViewGizmo` の `alignment` を常に `top-left` にする。
- [x] **Step 4:** 既存の単体テスト（視野角・距離の数値を固定しているもの）を新しい値に直し、E2E の navigation（ホイールの拡大・360°回転・プリセット）と direct-manipulation・wire-delete・plc・manual-shots の一部を流して端子のクリックが当たることを確かめる。
- [x] **Step 5:** 画面を撮って確かめる（盤の正面・並べて・ソケット拡大・上から・PLC分割、1264×761 と 1904×1041）。`audit-2026-10-16/after-t3/`。
- [x] **Step 6:** コミット「視野角を24°にして視差を減らし、ビューキューブを避けて盤・PLCを収める」→ push。

### Task 4: 3Dの名札（U3）

**Files:** Modify `three/PlcUnit.tsx`、`three/PlcRack.tsx`、`three/Fixtures.tsx`、`three/Outlet.tsx`、`three/labels.ts`、`styles.css`（`.block-label` の基準点）、`shared/ipc.ts`、`shared/settings-validation.ts`、`renderer/panels/Toolbar.tsx`、`renderer/app/ui-preferences.ts`、`i18n/ja.ts`; Test `test/plc-nameplate.test.tsx`（新規）、`test/board-labels-toggle.test.tsx`（新規）、`test/settings-validation.test.ts`

- [x] **Step 1: 失敗するテスト** — PLC本体（4社）を描くと、銘板（`appearance.nameplate`）・ラックのモジュール形式・ベースの銘板が `Html` の `.block-label` ではなく面のテクスチャ（`mesh[name="plc-nameplate"]` など）で出る。機種名の名札の基準点は本体の下端より下にあり、`data-anchor="top"`。設定 `showBoardLabels`（既定 true）が false なら `.block-label`・`.socket-label`・`.part-label` を描かない。
- [x] **Step 2:** 銘板を `makeCanvasTexture` で焼いて面に貼る（大きさは `nameplateRectMm()`）。機種名・壁コンセント・固定機器の名札は `Html` の `center` をやめ、`transform: translate(-50%, 0)`（上端基準）または `translate(-50%, -100%)`（下端基準）にする。
- [x] **Step 3:** 設定に `showBoardLabels` を足し（検証・既定値・保存）、「表示・作業ファイル」に「3Dの名札を表示」のチェックを足す。ビューポートの要素に `data-labels="off"` を付けて CSS で名札を消す（ホバーの札・状態表示・プローブの札は残す）。`coverage.json` に登録。
- [x] **Step 4:** 画面を撮って確かめる（PLC 4社の盤、PLC分割、ラック）。
- [x] **Step 5:** コミット「PLCの銘板を本体の面に描き、名札が機器に重ならないようにし、名札の表示を切り替えられるようにする」→ push。

### Task 5: PLCの右の欄とI/O割付（U5）

**Files:** Modify `ladder/LadderWorkspace.tsx`、`ladder/IoTable.tsx`、`ladder/ladder.module.css`、`screens/screens.module.css`; Test `test/io-table.test.tsx`、`test/ladder-layout.test.tsx`

- [x] **Step 1: 失敗するテスト** — I/O割付の表の端子名が `X0`／`0.00`（`PLC.` を付けない）。「変換・書込み・RUNの違い」が `SidePanel` の形（`plc-operation-guide-summary`）。分割の右の欄の幅が 260px、1904px の窓で格子が 11 列入る（`ladder-layout.test.tsx` の計算）。
- [x] **Step 2:** 実装。表の文字が識別子の途中で折れないようにし、説明文は左揃え。
- [x] **Step 3:** `ui-quality` のモードD（4社×3サイズ）を流し、画像で切れが無いことを確かめる。
- [x] **Step 4:** コミット「PLCの右の欄を広げ、I/O割付の表が切れないようにする」→ push。

### Task 6: 狭い窓のレイアウト（U6）

**Files:** Modify `screens/screens.module.css`（`.plcLayout` の 1279px 以下、モードBの「並べて」）、`e2e/ui-quality.spec.ts`（単色の点検の前に `scrollIntoViewIfNeeded`）; Test `test/ladder-layout.test.tsx`

- [x] **Step 1:** 1279px 以下の PLC 分割の1行目を `clamp(420px, 60vh, 760px)` にする。モードBの「並べて」を 3D 最低 300px・エディタ最低 420px にして縦スクロールにする。
- [x] **Step 2:** `ui-quality` の canvas 点検をキャンバスが画面に入ってから測るようにする。1264×761 で撮って確かめる。
- [x] **Step 3:** コミット「狭い窓でも並べて・分割の3Dとエディタ・ラダーが使える高さを保つ」→ push。

### Task 7: 小窓・手順帯・ヘルプの図（U7・U8・U9）

**Files:** Modify `panels/ReportPopover.tsx`、`screens/InspectRepairSession.tsx`、`three/TerminalField.tsx`（小窓中は札を出さない）、`i18n/ja.ts`（`reportTargetLabel`）、`session/step-guide.ts`、`screens/InspectPartsSession.tsx`、`help/HelpDrawer.tsx`、`help/help.module.css`; Test `test/report-popover.test.tsx`、`test/step-guide.test.ts`、`test/help-drawer.test.tsx`

- [x] **Step 1: 失敗するテスト** — `popoverPosition(anchor, viewport, size)` が実寸で上下を選び、3Dペインの下端から 8px 以上離れる。端子の見出しが「S1 端子9（CR1⑨）」の形。`inspectPartsSteps({ poweredOnce: true, powered: false, … })` で「通電」が済。図の拡大が窓の 92%×85% に収まる最大の大きさ。
- [x] **Step 2:** 実装（小窓は `ResizeObserver` で実寸を測って位置を直す。C1 は挿している部品ごとに「一度でも通電したか」を覚える）。
- [x] **Step 3:** C2・C1 の E2E（inspect・repair・walkthrough の C1/C2）を流す。
- [x] **Step 4:** コミット「指摘の小窓を押した場所の近くに出し、C1の手順帯とヘルプの図の拡大を直す」→ push。

### Task 8: PLCの表示灯と電源なしの札（P2・P3）

**Files:** Modify `worker/sim.worker.ts`（`plcIo` を常に載せる）、`shared/messages.ts`（スナップショットの型）、`renderer/three/appearance.ts`、`renderer/three/PlcUnit.tsx`・`PlcRack.tsx`（表示灯の入力）、`renderer/screens/PlcSession.tsx`（札）、`i18n/ja.ts`; Test `test/plc-appearance.test.ts`、`test/sim-worker.test.ts`（またはランタイムのテスト）

- [x] **Step 1: 失敗するテスト** — `litLedKeys(appearance, { powered: false, … })` が空。給電中・RUN で `status:RUN`（三菱 `P.RUN`）、入力1が ON なら `input:<名>`（モニタでなくても）、出力も同様。プログラムなしの RUN で ERR。札は給電されていなければ「PLC: 電源なし」。
- [x] **Step 2:** 実装。
- [x] **Step 3:** PLC の E2E（plc・plc-vendors）を流し、盤の表示灯を撮って確かめる。
- [x] **Step 4:** コミット「PLCの表示灯を電源と実際の入出力に合わせ、電源が無いときは運転中と出さない」→ push。

### Task 9: PLCへの書込み（P1）

**Files:** Modify `renderer/app/store-ladder.ts`（`plcProgram`、`writePlc()`、`plcProgramState`）、`ladder/LadderWorkspace.tsx`（`download`／`online` の動き、RUN の前の確認、書込みの確かめの窓）、`screens/PlcSession.tsx`（手順帯・札・判定の前の確認・判定に渡すラダー）、`lab/*`（動かすに使うラダー）、`session/use-runtime-connection.ts`（再接続で送るのは PLC のプログラム）、`shared/work-file-schema.ts`・`work-file-codec.ts`（保存・読込・以前のファイル）、`packages/plc-dialects/src/{profile,jtekt}.ts`（ジェイテクトの道具列に書込み）、`ladder/skins/jtekt.ts`（前提の注記）、`i18n/ja.ts`; Test `test/plc-write.test.tsx`（新規）、`test/work-file*.test.ts`、`packages/plc-dialects/test/jtekt.test.ts`、E2E `plc.spec.ts`・`plc-vendors.spec.ts`・`ladder-entry.spec.ts`・`lab.spec.ts`・`review-fixes.spec.ts`・`ui-quality.spec.ts`・`manual-shots.spec.ts`・`manual-walkthrough.spec.ts`

- [x] **Step 1: 失敗するテスト（単体）** — 変換だけでは Worker に `load` が飛ばない。書込みで `load`（変換結果）が1回飛び、`plcProgram` が入る。RUN 中の書込みは確かめの窓が出て、承認で `run off` → `load`。プログラムなしの RUN は断られる。手順帯が「変換 → 書込み → モニタ開始・RUN」。エディタを編集すると札が「エディタと違う」。判定は `plcProgram` を送る（未書込みの変更があれば確かめの窓）。作業ファイルに `plcProgram` が入り、読込で戻る。`plcProgram` の無い以前のファイルは `converted` なら書込み済み扱い。メーカー切替で `plcProgram` が空になる。ジェイテクトの道具列に `download`。
- [x] **Step 2:** 実装。
- [x] **Step 3:** E2E を書込みの手順に合わせて直し、PLC 関係（plc・plc-vendors・ladder-entry・lab・review-fixes・interaction-audit）を流す。
- [x] **Step 4:** コミット「PLCは書き込んだプログラムで動くようにし、書込みの手順と確かめを実機に合わせる」→ push。

実装メモ（2026-10-17）: 札「PLCのプログラム」を足したことで、PLCに電源がつながると手順帯が1段↔2段に伸び縮みし、3D盤が27pxずれて配線中の端子が逃げた（plc.spec ④で検出）→ 手順帯は2段に固定（`StepGuide layout="two-rows"`）。作業ファイルの読込のあとに PLC のプログラムを Worker へ載せ直し、保存時に変換済みだったラダーは変換し直して開く。1280×800 でデバイス入力中に格子が上へ送られて見えなくなる件も直した。

### Task 10: モニタ中のタイマ・カウンタの現在値（P5）

**Files:** Modify `ladder/LadderGrid.tsx`、`ladder/ladder.module.css`、`packages/plc-dialects/src/profile.ts`（現在値の表記 `currentValueText`）; Test `test/ladder-monitor-values.test.tsx`（新規）

- [x] **Step 1: 失敗するテスト** — モニタ中、`T0`（設定 K30、経過 1.2s）のコイルのマスに「12」（三菱）／「0012」（オムロン BCD）が出る。モニタでないときは出ない。カウンタも同様。
- [x] **Step 2:** 実装。
- [x] **Step 3:** コミット「モニタ中はタイマ・カウンタの現在値をラダーの格子に出す」→ push。

実装メモ（2026-10-17）: マスの中（46〜52px）は命令の箱・デバイスコメントと重なるため、現在値は**回路ブロックの見出しの右**に「T0 現在値 12（設定 K30）」の形で出す。オムロン・シャープの TIM／TMR・CNT は PLC調査資料の命令表どおり**減算式**なので、T0（K30・経過1.2秒）は「0018」。ジェイテクトは資料未入手のため加算式・16進4桁を前提にし、スキンの根拠に記した。

### Task 11: 命令表記の表と説明書の照合テスト（P4）

**Files:** Modify `docs/manual/06-mode-d.md`、`test/manual-appdata.test.ts`

- [ ] **Step 1: 失敗するテスト** — 06章「本アプリの命令表記」の表の各セルが、方言の `instructionNames` と `timerInstructionName()` から作った文字列と一致する。
- [ ] **Step 2:** 表を直す（ジェイテクト TMR・TMRH など）。
- [ ] **Step 3:** コミット「命令表記の表をメーカーの方言から確かめるテストを足し、ジェイテクトのタイマを直す」→ push。

### Task 12: 説明書の本文（R1・R5）

**Files:** Modify `docs/manual/00〜15*.md`、`docs/manual/coverage.json`、`docs/manual/terms.json`（必要なら）

- [ ] **Step 1:** Task 2〜10 の変更を本文に入れる（自動保存の場所、名札の切替、キューブの場所、書込み・表示灯・電源なし・現在値、C1 の手順帯、小窓、ヘルプの図）。
- [ ] **Step 2:** 「親切に」: 各章の最初に「この章でできること」の1行と、手順の節に「うまくいかないとき」の1〜2行を足す。13章の手順12を直す。
- [ ] **Step 3:** `node scripts/build-manual.mjs`、manual 系の単体テスト（sync・style・coverage・appdata）。
- [ ] **Step 4:** コミット「説明書を新しい画面とPLCの書込みに合わせて直す」→ push。

### Task 13: 説明書の図を増やして全部撮り直す（R5）

**Files:** Modify `docs/manual/shots.json`、`docs/manual/*.md`（図を置く段落）、`apps/desktop/e2e/manual-shots.spec.ts`、`apps/desktop/test/manual-images.test.ts`（上限）

- [ ] **Step 1:** 設計 §2.11 の図を `shots.json` に足し、本文の段落の直後に置く（1段落に1枚、吹き出しの番号は本文に書く）。
- [ ] **Step 2:** `manual-shots.spec.ts` に撮る手順を足す。部分実行で吹き出しの位置を確かめてから、**全体を撮る**（部分実行は最終の画像にならない）。
- [ ] **Step 3:** `manual-images` / `help-drawer` / `manual-shots` のテスト、新しい図を全部目で見る。
- [ ] **Step 4:** コミット「説明書の図を増やし、新しい画面で全部撮り直す」→ push。

### Task 14: 動画9本（R4・R6）

**Files:** Modify `apps/desktop/scripts/record-tutorials.mjs`、`docs/tutorial-recording.md`、`apps/desktop/src/renderer/public/tutorials/*`

- [ ] **Step 1:** PLC の4本に書込みの手順と失敗の場面（三菱: 書込み忘れ、ほか: 書込み前の RUN）を足す。dry run（`OJT_TUTORIAL_DRY=1`）で9本を通す。
- [ ] **Step 2:** ビルドしてから9本を1本ずつ収録し、`finalize-tutorials.mjs`、`review-tools.spec.ts`。失敗の場面のフレームを確かめる。
- [ ] **Step 3:** コミット「動画9本を新しい画面と書込みの手順で撮り直す」→ push。

### Task 15: PDF と通し点検

- [ ] **Step 1:** `manual-walkthrough.spec.ts` に新しい記述（書込み・表示灯・電源なし・名札の切替・自動保存の場所・C1 の手順帯）を足し、不一致 0 件まで直す。
- [ ] **Step 2:** `build-manual` → `print-manual` で PDF を作り、新しい図のページを画像で確かめる。
- [ ] **Step 3:** コミット・push。

### Task 16: 検証・配布・公開（v2.1.0）

- [ ] 版を `2.1.0`、`docs/releases/v2.1.0.md`、README のリンク。
- [ ] `pnpm install --frozen-lockfile`、`pnpm verify`、`validate src/builtin`、ビルド＋既定の E2E ×2、`dist`（check-dist）、`e2e:packaged`、同梱物の照合、記録 `OJT/release/verification/v2.1.0/README.md`。
- [ ] 注釈付きタグ `v2.1.0` → push、下書きリリース（EXE 2個）、main とタグの CI 成功、`pnpm release:publish`、認証なしのダウンロード照合、`OJT/release/v2.1.0` に Portable EXE を1個。
