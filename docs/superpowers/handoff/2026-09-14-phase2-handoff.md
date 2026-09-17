# Phase 2 引き継ぎ（2026-09-14 シャットダウン時点）

`briefs/` に Task 17 ブリーフ（`brief-2a-g.md`）のほか、D2/E/F14-16/F15 の実装ブリーフ、
停滞監視スクリプト（`longproc.sh`）、待機・監視メモ（`deferred.txt`, `agents.txt`）を同梱。

## 1. 状態

### Plan 2A（`docs/superpowers/plans/2026-09-14-phase2a-fault-content-and-judge.md`）

Task 1〜16 は着地済み（SHA）。

| Task | SHA |
|---|---|
| 1–2 | 52fe00c / 78eaff9 |
| 3, 5, 6, 8 | 1586cdd / 735330e / 7b6ee19 / 936fd96 |
| 4 | 4fc3e59 |
| 7 | 6ae1a3d に混入（共有インデックス競合で巻き込まれた） |
| 9 | b54c927 |
| 10 | 48254b8 |
| 11 | bc0afd0 |
| 12 | ebeb9cb（+ 36e57aa ハザード修正、b9f57d4 ドキュメント） |
| 13 | 46e79c4 |
| 14 | 6c43b88 |
| 15 | 32025e0 |
| 16 | d204a48 |

レビュー修正: e5c9237 / 2bb24d3（テスター）、715f915 / 8635cab（C+D1 項目1・2）。

**Task 17 は未着手**（ブリーフ: `briefs/brief-2a-g.md`）。

### Plan 2B（`docs/superpowers/plans/2026-09-14-phase2b-fault-desktop.md`、rev 8812998）

- Task 2〜3 は着地済み（f8905a2, 28283e8）
- Task 1・4 は Task 17 のバレルエクスポート待ちでブロック中

### その他

- VIEW-NAV: 836942a / 6ae1a3d で着地
- Phase-1 ポリッシュ: b398d5c / 56bb96b / 45f7ae3

### テストベースライン

content 32 files / 409、desktop 28 files / 469、circuit-sim 214、board-model 155、root ≈1300、E2E 9/9。

## 2. 次にやること（順番）

**a) C+D1 レビュー修正の残り項目3〜5**（`briefs/deferred.txt` 記載どおり）
- random-faults の clone 化・fallback 検証・`fellBack`・`maxMillis` 追加
- M3〜M6
- プランドキュメントへの行追加

**b) Task 17（ブリーフ参照）を、D2+E+F+修正の Opus レビュー1本と並行実施**
- レビュー対象: Task 9, 10, 12, 14, 15, 16 ＋ 715f915 / 8635cab ＋ テスター修正
- プローブ一覧は `briefs/deferred.txt` 参照

**c) Task 17 完了後: Plan 2B Task 1→4 を直列（Opus）**
- プランの「実装者への MERGE 注意」と「推奨バッチ」に従う
- その後 Batch 2（5+6 / 9 / 13 を並行 Sonnet、7 は Opus）
- Batch 3（8→10→11）
- Batch 4（12→14→15→16）
- Batch 5（17）
- Batch 6（18 E2E + パッケージアプリ受け入れ §14.3 / §16）

## 3. 運用ルール

- サブエージェント駆動で実装する
- バッチごとに Opus レビュー1本（並行する独立グループはそれぞれ1本）
- コミットは `git commit --only -- <paths>` を使う（共有インデックス競合が2回発生: 6ae1a3d が Task 7 のファイルを巻き込んだ）
- 停滞監視は10分毎の cron + `briefs/longproc.sh`
- 実装完了率は固定の重みで報告する: 1A 8 / 1B 5 / 1C 5 / 1D 12 / P2 15 / P3 20 / P4 15 / P5 15
  （前回報告: 約40%、レビュー確定分は約33%）
- ビジュアルは適宜提示する（scratchpad `view-nav/` のスクリーンショットはユーザーに送付済み）

## 2026-09-17 追記（第2回中断）

- リモート `origin` を追加し `main` を push 済み。
- Plan 2A Task 17 は b12caed として部分着地: バレルが Phase 2A の全面を re-export、
  `mode` の typo に起因するスキーマ問題1件を修正、デスクトップ側
  `content-loader.ts` が `isAssembleProblem` を import。
- content の 409 テストおよび `pnpm -r typecheck` はグリーン。
- Task 17 の残項目、および未着手の C+D1 修正項目3〜5は `briefs/deferred.txt` に記載。
- Plan 2B の Task 1・4 はブロック解除済み。
- 次の指示: Task 17 残作業 + 修正項目3〜5 を並行実施 →
  D2+E+F+修正+Task 17 をまとめて Opus レビュー1本 → Plan 2B Task 1→4。
- 各バッチ後に `main` を push する。

## 2026-09-17 追記（第3回中断・Plan 2A 完了）

- Plan 2A 全17タスク着地、Opus レビュー確定（後半レビュー APPROVED WITH MINOR ISSUES →
  修正 f487356 / fb09e13 / cbb288a / f16717b 着地）。
- 検証: `pnpm -r test` 102 ファイル / 1345 テスト、typecheck・lint・prettier 合格、
  coverage circuit-sim 98.91/93.80/100/99.89・content 98.52/96.44/100/99.75。
- 次の作業: Plan 2B Tasks 1→4（Opus 直列、MERGE 注意を厳守、`store.ts` の
  `sessionForProblem` を `SupportedProblem` に広げる、`judgeInspectRepair` は
  0.2〜0.45秒なので Worker 内で実行）→ Batch 2〜6。
- 各バッチ着地ごとに `main` を push する。
- 詳細は `briefs/deferred.txt` 末尾を参照。

## 2026-09-18 追記（第4回中断・Plan 2B Task 1 着地）

- Plan 2B Task 1 着地 3c6a8db（課題一覧に内蔵20題をモード付きで表示、`SessionMode`・
  `ProblemSummary.mode`・`readProblem → SupportedProblem | null`、C1/C2 は一覧に出るが
  開始は未対応トーストで保護）。
- 暫定ガードは `ProblemList.tsx` と `session/work-file.ts` の2か所にあり、
  Task 4 Step 10 で両方外す。
- desktop 29 ファイル / 474 テスト、typecheck・lint・prettier 合格、E2E とビルドは未実行。
- 次の作業: Task 4「ストアを3モードへ広げる」（計画 L1427–2176、Step 1 の
  `apps/desktop/test/store-inspect.test.ts` から）→ Tasks 1–4 の Opus レビュー1本 →
  Batch 2。
- 詳細は `briefs/deferred.txt` 末尾を参照。
