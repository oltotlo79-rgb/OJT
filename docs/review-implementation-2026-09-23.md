# レビュー改善・課題追加・操作動画の実装記録

対象: 電気教育ツール v1.5.0。開始点は phase7 の `35359a81e760cdc24898fc100945a21f3f43ef69`（v1.4.3）。

元のレビューは OJT 直下の `docs/project-review-2026-09-23.md`。本書の R/C/F/D はその指摘番号に対応する。元の作業ツリーの未保存変更と `docs/reviews/` は本実装の編集対象に含めていない。サブエージェントは使用していない。

## 1. 変更の概要

- 保存・復元の検証を共有化し、失敗するデータを現在の作業へ部分適用しない構造にした。旧版の形式1も読み込み、65ブロック以上の旧作業は原本と分割ファイルへ救出できる。
- PLC電源の誤配線を採点とライブ実行の両方で検査する。四つの押ボタンの入力割付、自由I/O変更、端子追跡、1スキャン実行、停止条件、入力強制を追加した。
- 配線一覧から接続変更・一括削除・線番・注記・経路を編集できる。測定値と診断メモを保存し、結果・PDFへ出力できる。
- GUIによる課題の複製・編集・検証・JSON保存、組立用の拡張盤と訓練ルールを追加した。
- 課題を216問から324問へ増やし、四つの解答操作動画を同梱した。
- 説明書原稿、アプリ内ヘルプ、日本語表記を更新した。

## 2. 不具合 R01〜R21 の対応

以下のソースパスはこの作業ツリーを基準とする。`renderer/` は `apps/desktop/src/renderer/`、`shared/` と `main/` は `apps/desktop/src/` 配下。

| ID | 実装した修正と理由 | 確認するコード・検査 |
|---|---|---|
| R01 | 保存された課題・メーカーから実効盤を確定してから全端子を検証する。PLC本体・コンセントの配線を通常盤の端子集合で拒否しない。 | `shared/work-file-codec.ts`、`renderer/session/work-file.ts`、`test/work-file-plc.test.ts`、`test/review-persistence-regression.test.ts` |
| R02 | mainとrendererで同じ構造検証を使う。復元候補を独立したストアで完成してから一括適用し、欠落・null・異常端子・壊れた回路図を理由付きで拒否する。未完成の下書きは保存可能。 | `shared/work-file-schema.ts`、`shared/work-file-codec.ts`、`renderer/app/store.ts`、作業ファイル関連テスト |
| R03 | L/Nが異なるネットで対応するコンセント端子へ到達することを検査する。同一ネット、片側欠落、PE代用、盤電源混入を原因別に扱い、対象端子を表示する。 | `packages/circuit-sim/src/plc.ts`、`packages/content/src/plc-static-checks.ts`、PLC電源の回帰検査 |
| R04 | 障害時の再開はライブ計算・通信世代を作り直す。C1解答、C2故障・修復・指摘、配線、Undo、測定記録を残し、再開を繰り返しても課題を破棄しない。 | `renderer/app/store-session.ts`、`renderer/session/use-runtime-connection.ts`、`test/work-file-restart-resend.test.tsx` |
| R05 | 編集・読込・保存で64回路ブロックを共通上限にした。旧版で65以上になったファイルは、未加工の原本コピーと64個ごとの確認用ファイルを新しいフォルダへ出力する。元のファイルは変更しない。 | `packages/ladder-core/src/edit.ts`、共有スキーマ、`main/work-file-rescue.ts`、`test/work-files.test.ts` |
| R06 | 同じ課題IDも永続作業全体で比較する。「保存して開く」「保存せず開く」「取消」を表示する。配線以外の解答・指摘・下書き・記録も保護する。 | `renderer/session/work-file.ts` の `persistentWorkKey` / `needsDiscardConfirm`、`renderer/app/App.tsx` |
| R07 | 復元分と今回分の危険操作回数を合算する。詳細ログを上限で整理しても累計件数を失わない。 | `renderer/session/work-file.ts`、`worker/sim.worker.ts`、`test/review-persistence-regression.test.ts` |
| R08 | ヒント段階と回路図参照回数を共通の学習記録として保存・復元する。旧作業に無い追加項目は既定値へ移行する。 | `shared/work-file-codec.ts`、`renderer/session/work-file.ts` |
| R09 | 変更後約1.2秒の自動保存、30秒の経過時間チェックポイント、保存待ち/成功/失敗の表示と再試行を追加。書込を直列化し、通常終了は最新保存完了を待つ。失敗・応答タイムアウト時は終了を止める。 | `renderer/session/autosave.ts`、`main/index.ts`、`test/review-tools-regression.test.ts` |
| R10 | 作業に保存時の課題定義を含める。同一IDの課題が後日変更されても保存時の条件で再開し、現在の定義との相違を通知する。旧版のIDのみのファイルは現在の定義を使用する。 | `WorkFile.problemSnapshot`、共有codec、`renderer/session/work-file.ts` |
| R11 | PLCの入力割付上限をPB1〜PB4の4入力へ統一した。重複したPB/入力番号・機種の点数超過は拒否する。 | `packages/content/src/schema/plc.ts`、`schema/task.schema.json`、追加PLC課題 |
| R12 | 課題読込・CLI検証・GUI検証で同じメーカー能力検査を実施。模範ラダーの命令、デバイス、タイマ単位等が選択メーカーで成立することを検査する。 | `packages/content/src/schema/index.ts`、`definition-validation.ts`、`packages/plc-dialects` の検査 |
| R13 | PLC電源の成立判定をライブ実行と採点で共有する。PLC電源不成立時はスキャン・出力を進めず、電源喪失では実行状態を初期化する。 | `packages/circuit-sim/src/simulation.ts`、`packages/content/src/plc-io.ts`、`test/sim-worker-plc.test.ts` |
| R14 | PLC電源・I/O等の検査見出しを原因に合う表記に変更し、期待状態・観測状態・対象IDを構造化した。 | `packages/content/src/static-check-types.ts`、`plc-static-checks.ts`、`renderer/result/StaticCheckList.tsx` |
| R15 | 10秒レンジは最小0.1秒/刻み0.1秒、60秒レンジは最小0.5秒/刻み0.5秒へ統一。入力、丸め、部品説明、保存検証で同じ範囲を使う。 | `renderer/panels/TimerDial.tsx`、`packages/board-model/src/catalog.ts`、タイマ入力検査 |
| R16 | ウォッチ登録を画面ローカル状態から課題ストアへ移した。盤・ラダー間の移動と作業の保存復元で保持する。 | `renderer/ladder/WatchPanel.tsx`、`renderer/app/store-ladder.ts`、`test/ladder-panels.test.tsx` |
| R17 | NFKC正規化、複数語のAND検索、原文との位置対応を使う抜粋・強調、見出し/現在モードの優先、追加結果表示を実装した。再検索時は表示件数を戻す。 | `renderer/help/help-model.ts`、`HelpDrawer.tsx`、`test/help-drawer.test.tsx` |
| R18 | PDF操作名を「説明書全体をPDFで開く」に変更した。現在の節へ移動するという説明を除いた。 | `renderer/help/HelpDrawer.tsx`、`i18n/ja.ts`、説明書02章 |
| R19 | 設定の控えを保存できた場合のみ保存済みと通知する。控えの作成に失敗した場合は破損元を上書きせず、失敗理由を示す。 | `main/settings.ts`、`shared/messages.ts`、`test/settings.test.ts` の実ファイル検査 |
| R20 | ACVは未対応と画面・説明書へ表示し、測定結果を0Vと偽らない。未対応・未配置・通電中抵抗測定を測定記録へ保存しない。 | `packages/circuit-sim/src/meter.ts` / `tester.ts`、`renderer/panels/TesterPanel.tsx` |
| R21 | 復元後の画面・ストア・Workerへ同じ実効機種を渡す。保存メーカー欠損の旧作業では課題メーカーを選び、その扱いを通知する。 | `renderer/session/work-file.ts`、`plc-skin.ts`、`use-runtime-connection.ts`、4メーカー往復検査 |

### 実操作で追加確認した表示の問題

- 1280px幅では、動画ボタンを追加した上部メニューの「作業を保存」「作業を読込」が右にはみ出した。`Toolbar.tsx` で開いたメニューの実寸を測り、画面端から8px内側へ位置を補正する。リサイズ時も再計算し、1100/1280pxの実画面でクリック位置を検査する。
- 拡張盤のPB5/PL5以降が、課題で指定した緑ではなく既定の灰/白で描かれた。`session/colors.ts`、`three/PushButton.tsx`、`three/Lamp.tsx` と回路図のシンボルへ部品定義の色を反映し、追加端子を配線した実画面で確認した。
- 測定記録のPDFがUTCのISO文字列と内部名 `OHM` を表示し、デジタル測定へ不要なアナログ倍率を併記した。`shared/diagnosis.ts` の共通表示で端末の日本語日時、測定方式、実際に使うレンジと対象部品を表示する。
- 狭いPLC画面のI/O欄に電源異常の全文が並び、見出しと配線の説明を同時に読みにくくなった。異常件数と開閉式の詳細にまとめ、I/O表の後へ配置した。
- PDFの目次を左右4章ずつに固定していたため、節を追加すると第4章だけ次ページに押し出され、第5章が先に現れた。`scripts/manual-build.mjs` で節数と文字の折り返しを見積もって列を分割し、出力PDFの第1〜15章が読む順序どおりに並ぶことを確認した。
- 説明書の接点入力・設定画面の図で案内番号が本文と重なった。`scripts/annotate-shots.mjs` で対象から100px以内の余白も探索し、離れた番号から対象へ線を引く。40枚の実測矩形を使った検査で文字との重なりがないことを確認する。
- PLC誤配線の実画面検査で、盤電源へ接続済みでも「未接続」が重なり、関連端子へのボタンだけが説明と離れて並ぶ問題を確認した。接続中の盤端子名を表示し、未配線との二重報告を除き、観測状態・修正先・移動ボタンを同じ項目にまとめた。補足説明も原因コードから短絡・接続先違い・未配線・盤電源を区別する。

## 3. 構成・性能 C01〜C04

| ID | 変更内容 | 確認方法 |
|---|---|---|
| C01 | 各モードの通信開始、snapshot受信、判定応答、例外、再接続を `use-runtime-connection.ts` にまとめた。新規課題の初期化と障害復旧を区別し、テスター設定を再送する。 | モード別の復元/再開検査、4モードの操作動画・E2E |
| C02 | 作業ファイルのDTO・codec・スキーマ・能力上限をsharedと各ドメインへ集約。mainからrendererの型へ依存する経路を除き、PLCモニタDTOもsharedへ移した。 | 全workspace型検査、保存ファイルの正常/異常境界検査 |
| C03 | `SignalLog.drain()` と `EventBus.drain()` により送信済み詳細を解放。直近信号値、危険操作の累計と代表例を別保持する。rendererの詳細表示は最大200件。採点の全区間再生ではログを間引かない。 | 100,000変化点・10,000危険操作の検査、実回路10分の性能記録 |
| C04 | 電気的接続の構造をWeakMapで保持し、構造変更を署名で検出して無効化する。ソルバーの行列・右辺領域を再使用し、毎tickの再確保を減らした。 | 接続追加・除去・故障変化後の再計算検査、既存の回路/採点テスト、性能記録 |

計測スクリプトは OJT の `release/verification/review-fixes-2026-09-23/performance-probe.mjs`。d-018の連続点滅、d-090の4入力PLC、b-090の追加PB/表示灯4組をそれぞれ10分ぶん加速実行する。tickの平均・95パーセンタイル・最大、snapshot作成/複製時間、保持ログ数、GC後ヒープを出力する。UI描画と実時間追従の測定は含めない。

Node v25.9.0 / Windows arm64 / Snapdragon X1E80100（12論理CPU）で各60,000tickを測定した。結果は `performance-probe.json`。

| 条件 | 平均tick | p95 tick | 最大tick | 最大保持ログ数 | 1分→10分のGC後ヒープ |
|---|---:|---:|---:|---:|---:|
| d-018 点滅 | 0.443 ms | 0.581 ms | 54.70 ms | 154 | 24.99→24.98 MB |
| d-090 4入力PLC | 0.384 ms | 0.522 ms | 31.04 ms | 112 | 25.23→25.25 MB |
| b-090 拡張盤 | 0.292 ms | 0.358 ms | 60.35 ms | 50 | 25.18→25.19 MB |

d-018では10分間に38,522件の変化点を配信したが、送信直後の保持詳細は0件になり、長時間の履歴蓄積を解消できた。snapshotの作成・複製・JSON化のp95は0.099〜0.245ms、最大サイズは8,336bytes。旧版の平均0.424〜0.484msと測定条件が完全には同じでないため、大幅な平均速度向上を示す結果とは扱わない。OS上の別プロセス負荷とGCの影響を含む最大値は10msを超えており、常時10ms以内や実GPUの60fpsを保証する数値ではない。

## 4. 配線・PLC・診断 F01〜F08

| ID | 利用者が行える操作 | 実装・確認先 |
|---|---|---|
| F01 | 配線一覧で端子/線番を検索し、選択線を3Dで強調。線番・注記、接続元/先/色の変更、複数線の削除を行う。失敗時は元の線を維持し、確定した一括変更はUndo/Redoできる。 | `renderer/panels/WireListPanel.tsx`、`renderer/session/wire-edit.ts`、`test/review-tools-regression.test.ts` |
| F02 | 一覧から経由する配線帯を選ぶ。経路設定と電気的接続を別データとして保存し、接続・採点を変えず見た目を整理できる。 | `packages/board-model/src/routing.ts`、`BoardSession.wireRoutePreferences`、配線経路検査 |
| F03 | 自由課題のI/O表で入力/出力番号とシンク/ソースを編集。配線の変更内容を見て推奨配線へ一括変更、または表だけ変更。行から端子・線・ラダー使用箇所へ移動し、モニタ値を確認できる。 | `IoAssignmentEditor.tsx`、`IoTable.tsx`、`session/plc-assignment.ts`。割付とラダーを変えた実採点、GUIの重複拒否/一括変更/Undo/Redo |
| F04 | RUN/STOP、診断の一時停止、1スキャン、条件成立後の停止を独立操作にした。各回路ブロックの書込、命令の通電、タイマ/カウンタの現在値・設定値・リセット理由を確認できる。自由課題の入力強制中は明示し、採点を禁止する。 | `ladder-core/src/runtime.ts`、`renderer/ladder/PlcDebugPanel.tsx`、Worker命令、連続実行と手動スキャンの一致検査 |
| F05 | 組立の拡張盤で中継端子を最大8対、PB5〜PB8とPL5〜PL8を各4個まで追加。部品種別、線色、端子本数2〜4、ヒント、静的検査を課題データで指定する。 | `packages/board-model/src/profiles.ts`、課題schema、3D/回路図/保存/採点。GUIでb-087を複製し追加端子を配線して合格 |
| F06 | 現在の測定値、黒/赤端子、単位、時刻、通電状態、対象部品、目的を固定記録する。予測と判断を関連付けた診断メモを作成し、作業復元と結果/PDFに残す。各記録の上限は200件。 | `shared/diagnosis.ts`、`MeasurementPanel.tsx`、`result/report-html.ts`。古いsnapshotの拒否、ライブ変化からの独立、GUI保存/復元/PDF検査 |
| F07 | 設定から課題フォルダの選択/表示、内蔵課題複製、操作列/I/O/故障/部品/盤ルールの編集、模範自己判定、JSON保存まで実施する。詳細JSONも編集可能。 | `ProblemAuthoring.tsx`、`main/authoring.ts`、`main/definition-validation.ts`、`definition-worker.ts`、GUI通し検査 |
| F08 | 配線/故障指摘/検査行から対象へ移動。削除した線は旧端子で追跡する。アプリ版・モード・直近50操作・Worker状態を診断用JSONへ書き出せる。 | `result/StaticCheckList.tsx`、`panels/ReportPanel.tsx` / `RepairPanel.tsx`、`session/diagnostic-navigation.ts` / `diagnostic-export.ts` |

F04は今回のレビューで受入条件に挙げた診断モードを対象とする。レビューで「別段階」としたワード演算の追加、実PLCとの通信、CPU実行途中状態の作業ファイルへの保存は実装していない。STOP時の出力OFFと内部値保持は本アプリの訓練モデルとして説明書に明記した。F05の拡張盤は回路組立に提供し、点検・PLCでは標準盤を使用する。

## 5. 日本語・説明書 D01〜D20

原稿の正本は `docs/manual/`。画面の用語と一致させ、原稿からヘルプとPDFを生成する。

| ID | 修正内容 | 原稿 |
|---|---|---|
| D01 | 端子選択を「始点」「接続先」へ変更。電線の「1本目」と区別した。 | 03、JA辞書、配線案内 |
| D02 | 標準盤は1端子2本まで。3本目は接続拒否・危険操作記録と説明。自由盤の設定は別途明記。 | 03、10 |
| D03 | 電源は3D盤または画面上部の①ブレーカ→②電源スイッチで操作する。 | 03、13 |
| D04 | 部品カードのドラッグ、クリック配置、装着後の詳細を順に説明した。 | 03、13 |
| D05 | タイマの最小値と刻みを0.1〜10.0秒/0.5〜60.0秒で統一した。 | 03、部品名 |
| D06 | コイル測定の黒⑬（−）/赤⑭（＋）を明記した。 | 05 |
| D07 | チェック用の固定線と修復対象の青線を区別。不要な除去が判定へ影響すると説明した。 | 05 |
| D08 | 交換の入口を右欄「修復」の対象部品の「交換」に合わせた。 | 05 |
| D09 | 正解の見分け方と自分の測定記録を分け、F06の記録/結果表示手順を追加した。 | 04、05 |
| D10 | PLCの①配線〜⑤判定を番号付きの5段階として説明した。 | 06 |
| D11 | 基本の記号に加え、接点・出力の種別から選ぶ命令とメーカー別対応表を追加した。 | 06 |
| D12 | 設定の既定メーカーは次に開く課題に適用。練習中は表記切替と配線への影響確認を案内。 | 06、09 |
| D13 | 保存対象、復元時に初期化する状態、旧形式の扱い、自動保存周期、終了処理、救出手順を一覧化。 | 08 |
| D14 | 危険操作の「減点」を回数記録と静的検査による合否の説明へ変更した。 | 03、JA辞書 |
| D15 | 部品を外せば経路が通るという案内を修正し、端子確認、経路指定、診断記録を案内。 | 12 |
| D16 | 操作ログは直近30件を操作順に表示し、新しい操作が下に追加されると説明した。 | 02 |
| D17 | 異常例1件に対して末尾を「1件の問題」へ修正した。 | 10 |
| D18 | 課題複製の入口をGUIへ統一。ポータブル版でも同じ手順で取り出せる。 | 09、10 |
| D19 | 用語/読み/意味/例の列へ変更し、PLC・I/O・COM・OL・スキャン等を追加。巻線短絡の説明と＋/−表記を修正。 | 11、04、12 |
| D20 | 電圧測定はDCV、ACVは未対応と明記した。 | 14、テスター画面 |

自由I/O変更、PLCの電源→入力COM→入力→ラダー→出力COM→リレー→表示灯の診断順、スキャン診断、測定記録、GUI課題作成、解答動画の見方も追加した。

## 6. 追加課題

| モード | 旧版 | v1.5.0 | 増加 | 追加内容 |
|---|---:|---:|---:|---|
| 回路組立 | 60 | 90 | 30 | 4入力の成立/禁止条件、16入力組合せの確認、0.5/1.5/2.5秒のタイマ、追加PB/表示灯/中継端子 |
| 部品点検 | 36 | 54 | 18 | 5〜7部品の混合、正常を含む抵抗・接点の複合判別 |
| 回路点検・修復 | 60 | 90 | 30 | 複数の配線故障と部品故障を含む診断・修復 |
| PLC | 60 | 90 | 30 | 4入力、4メーカー、番地の違い、自由割付、入力条件とタイマの応用 |
| 合計 | 216 | 324 | 108 | 各課題の定義と模範を検証 |

生成元は `packages/content/scripts/build-review-curriculum.mjs`。アプリ同梱JSONとcontentパッケージの定義の一致をテストで確認する。`workshop-curriculum.test.ts` は条件別の期待動作、故障の判別、誤答・未修復の不合格、模範の合格、盤ルールを検査する。既存216課題の試験範囲を減らしていない。

## 7. 実操作動画

| 動画 | 長さ | 内容・誤りの扱い |
|---|---:|---|
| 回路組立 | 約2分01秒 | B-001。タイムチャート確認、部品ドラッグ、自己保持配線。線の不足で不合格→不足箇所を直して合格。 |
| 部品点検 | 約2分52秒 | C1-001。4部品のコイル抵抗と励磁前後の接点を測定。コイル正常だけで正常と考えた部品を、接点点検後にa接点不良へ訂正。 |
| 回路点検・修復 | 約2分31秒 | C2-001。コイルを疑ってから抵抗/電圧で線の断線へ絞り込み、2箇所を指摘・修復し合格。 |
| PLC | 約4分58秒 | D-001。電源・I/Oの配線、自己保持ラダー入力、変換、1スキャン、押ボタンで動作確認。入力番地X9の誤入力を直して合格。 |

動画は Playwright から **実際のElectronアプリへマウス・キー入力**を送り、操作中の画面を収録した。解答状態や合格結果をストアへ直接入れて撮影する方法は使用していない。ポインター、クリック位置、ドラッグ、操作理由の日本語吹き出しを同じ画面へ表示した。音声解説は含めていない。

- 収録解像度1600×900、WebM（VP8）。ホームと各課題の「課題を解く動画」からオフライン再生できる。
- 再生/停止・シーク・0.75/1/1.25/1.5倍速・日本語字幕。動画を閉じると元のボタンへフォーカスを戻す。
- 収録時は `backgroundThrottling: false` と遮蔽時の抑制解除を設定し、対象を別の不透明ウィンドウで覆ったまま操作・合格まで完了させた。収録ログに背景状態と画面エラーの有無を保存した。
- PLC動画はタイムスタンプを1.3倍速相当へ調整し、約4分58秒にした。フレーム画像の再エンコードはしていない。字幕の時刻も同じ倍率で調整した。
- 動画の途中と合格画面の静止フレームを確認し、アプリ内で4本の再生時間・映像寸法・再生進行・シーク・字幕読み込み・速度変更を検査した。

再現用スクリプトは `apps/desktop/scripts/record-tutorials.mjs` と `finalize-tutorials.mjs`。実行手順は [動画の再収録](tutorial-recording.md)。収録記録、元動画、メタデータ、抜き出しフレームは OJT の `release/verification/review-fixes-2026-09-23/tutorials/` にある。完成動画とVTTは `apps/desktop/src/renderer/public/tutorials/`。

## 8. 検証・配布の記録

検証の恒久保存先: OJT の `release/verification/review-fixes-2026-09-23/`。

### ローカル検証

| 対象 | 確認結果 | 主な記録 |
|---|---|---|
| 型・Lint | 全workspaceで成功。 | `typecheck-thirtynine.log`、`lint-thirtynine.log` |
| ドメイン・課題の単体検査 | circuit-sim 262、ladder-core 133、plc-dialects 328、board-model 266、schematic-core 145、content 2,590件が成功。 | `verify-seventeen.log` |
| desktopの単体検査 | 全面検査3,850件のうち、図の番号が文字に重なる2件を検出・修正。修正後の説明書関連268件が成功。追加のPLC原因表示も32件・42件・25件の関連検査で確認。送信前には全範囲を再実行する。 | `desktop-thirtyfour.log`、`manual-unit-fortytwo.log`、`power-*-thirtyseven.log`、`power-reasons-thirtyeight.log` |
| 実画面操作 | 通常105件の一巡で84件成功、10件失敗、10件は前の失敗で未実行、実GPU測定1件は対象外。原因を修正して41件を成功させ、集計に残った検査手順の問題を直し4メーカーと集計5件が成功。 | `e2e-thirtythree.log`、`e2e-fortythree.log`、`ui-fortyfour.log` |
| PLC画面の集計 | はみ出し・文字切れ・重なり・不適切な折り返し等0件、操作の取りこぼし0件。以後は取りこぼしも1件で失敗にする。 | `ui-audit-fortyfour/summary.json`、`e2e-thirtythree-fixes.md` |
| 説明書の図 | 実画面撮影9件と注釈再生成1件が成功。原寸40枚・縮小40枚を更新し、全図の実測矩形を検査。 | `manual-shots-twentyseven.log`、`annotations-forty.log`、`manual-unit-fortytwo.log` |
| 説明書PDF | 159ページ、全ページの抽出文字がページ内。表紙・目次・新機能・保存/救出・更新図などの代表ページを画像で確認。 | `pdf-manual-final/`、`pdf-manual-visual-review.md` |
| 測定PDF | 実操作で記録・保存・復元・書出し。日時・測定方式・対象部品・端子・650.0Ω・目的・予測・判断を画像で確認。 | `pdf-measurement-final/`、`screenshots/review-measurement.pdf` |
| 配布物の構成 | 324課題、4動画と字幕、説明書、課題検証Worker、実行ファイルの保護設定を検査して成功。 | `dist-fortyone.log`、`v1.5.0-artifacts.md` |
| ポータブルEXEの実操作 | 3件すべて成功。EXE1個から初回案内、324課題、4動画、ASAR内の課題検証Worker、拡張課題の複製・合格、ヘルプ、PLCを確認。同時起動の独立性と、終了後13秒間使用中のEXE解放を待つ後始末も確認。 | `packaged-fortyfive.log`（2分42秒） |

途中で失敗したログ・画面・操作traceも保存した。特に画面監査は、個別テストの成功表示だけでは操作完了を証明できず、最後の集計の `notes` が空であることまで確認する。

### 公開条件と記録

公開前にGit送信ゲートで全パッケージの単体検査を再実行し、mainとv1.5.0タグの最新CIの成功を確認する。`scripts/publish-release.mjs` は、作業ツリー・リモートコミット・タグ・CI・添付した2つのEXEのバイト数とSHA256が一致しなければ公開しない。

公開先は [v1.5.0](https://github.com/oltotlo79-rgb/OJT/releases/tag/v1.5.0)。送信・CI・公開の実行IDとコミットの確定記録は `release/verification/review-fixes-2026-09-23/release-final.json` に保存し、OJT直下の `docs/review-implementation-2026-09-24.md` に出荷確認を追記する。元のレビュー原本は置き換えない。

実GPUの60fps、実PLC通信、メーカーの全命令、全ページの目視確認を行ったという主張はしない。スキャン・回路計算は本アプリの訓練モデルを検証する。

## 9. 元作業と一時資料の保全

開始前の `release/verification/review-2026-09-23-35359a8/baseline-files.json` と照合し、元の818ファイルの内容と削除状態・HEADが一致することを確認した（`root-preservation.json`）。既存のレビュー原本を更新版で置き換えない。

前のレビューで削除を拒否された `release/verification/review-2026-09-23-35359a8/temp/` は、そのまま残す。今回の検証で作った不要な作業用データは、確認済みのOJT内の対象だけを後片付けする。
