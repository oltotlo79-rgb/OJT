# CONTRIBUTING（開発の作法）

このリポジトリで散らばりがちな規約を1枚にまとめたものである（QA-22）。個別の詳しい話は
各ファイルのコメントに譲り、ここでは**どこに何があるか**と**守るべき手順**だけを記す。

## 1. 始める前に

```bash
pnpm install --frozen-lockfile   # lockfile が package.json と同期していることを確認する
pnpm verify                    # typecheck / lint / 全テスト。リリース前に実行する
```

`.npmrc` の `engine-strict=true` と `package.json` の `engines.node`（`>=22 <26`）により、
対応外の Node.js では `pnpm install` 自体が失敗する。CI（`.github/workflows/ci.yml`）は
`push`/`pull_request` のたびに `pnpm install --frozen-lockfile && pnpm verify` を走らせる
（`verify` ジョブ）。続くビルド＋E2E（`build-e2e` ジョブ）も毎回実行し、画面変更に伴う
古い文言・操作手順の取り残しを検出する。`v*` タグと手動起動でも両ジョブを実行する。

## 2. push 前の自動ゲート

`pnpm install` の `prepare` で追跡済みの `.githooks/pre-push` を設定する。既存の独自フックがあれば上書きせず停止する。CIではローカルフックを設定しない。

通常の `git push` は送信する全コミットの差分を読み、Vitest の import 依存関係から関連テストを自動選択する。未定義のCSS変数、操作要素の一覧、画面文言と説明書、原稿と生成済みヘルプ、用語、課題データ、翻訳キーの検査は毎回実行する。依存関係やテスト設定を変えた場合は全テストに広げる。

1件でも失敗したら push を中止する。未コミット変更や未追跡の実装・テスト・説明書がある場合も、検査した内容と送信する内容が食い違うため中止する。生成物を自動で直したり、失敗を無視したりする経路は設けない。`--no-verify` でこのゲートを迂回しないこと。

ゲート自体の「差分漏れ・検査漏れ・失敗の握りつぶし」は `pnpm test:push-gate` で検証し、CIでも実行する。通常の作業中は関連テスト、リリース前は `pnpm verify` と必要なE2E・配布物検査を行う。コミットメッセージは変更内容が分かる日本語で書く。

## 3. 生成物の扱い（手で直さない）

以下は**生成物**であり、元ファイルを直してからスクリプトで作り直す。手で直接編集しない。

| 生成物                                                  | 作るスクリプト                                            | 元ファイル                        |
| ------------------------------------------------------- | --------------------------------------------------------- | --------------------------------- |
| `apps/desktop/src/renderer/help/manual-content.ts`      | `node apps/desktop/scripts/build-manual.mjs`              | `docs/manual/*.md`                |
| `apps/desktop/resources/content/**`（内蔵課題の複写）   | `node apps/desktop/scripts/copy-content.mjs`              | `packages/content/src/builtin/**` |
| `docs/manual/coverage.json`                             | `node apps/desktop/scripts/feature-inventory.mjs`         | ソースの機能一覧（唯一の源）      |
| `apps/desktop/resources/manual/images/**`、`manual.pdf` | `pnpm --filter @ojt/desktop dist` 内の `print-manual.mjs` | `docs/manual/images/**`           |

`docs/manual/*.md` や `packages/content/src/builtin/**` を触ったタスクは、**コミットの前に
必ず上記スクリプトを走らせ、生成物の差分も同じコミットに含める**（MERGE 注意 #6・#7）。

## 4. E2E の文言書き写し

`apps/desktop/e2e/*.spec.ts` は配布物（ビルド成果物）を外から操作するテストであり、
`src/renderer/i18n/ja.ts` を直接 import できない。そのため画面文言はテストコード側に
**そのまま書き写している**（`inspect.spec.ts` 冒頭の注記、`ui-quality.spec.ts:52` などに同じ
方針が書かれている）。`ja.ts` の文言を変えたら、対応する E2E の書き写しも同じコミットで
直すこと。ズレたままだとテストは「文言が変わった」ことを検知して落ちる（意図した動作）。

## 5. `ui-quality.spec.ts` の `BASELINE` の下げ方

`apps/desktop/e2e/ui-quality.spec.ts` は画面品質（はみ出し・文字切れ・重なり・小さすぎる
文字など）を機械的に数え、`severity: 'blocking'` は0件を assert し、それ以外は `BASELINE`
（実測の上限値）以下であることだけを見る「新規の悪化を止める網」である。

**UI を直して件数が減ったら、`BASELINE` を実測値まで必ず下げる。** 下げ方:

```bash
OJT_SHOT_DIR=<出力先> pnpm --filter @ojt/desktop exec playwright test e2e/ui-quality.spec.ts
```

を通し、最後の「集計」テストが出す表（`check=... total=...`）か
`%TEMP%\ui-audit\summary.json` の `byCheck` を `BASELINE` の該当行へそのまま書き写す
（`ui-quality.spec.ts:97-104` のコメント参照）。下げ忘れを防ぐため、実測が基準より20%以上
少ないと集計テストが警告を出す。

## 6. `dist` の前に作業ツリーを清浄にする（QA-02。最重要）

既定の `pnpm --filter @ojt/desktop e2e` は動作検証だけを行い、取扱説明書の図を書き換えない。
`pnpm --filter @ojt/desktop e2e:shots` は `manual-shots` プロジェクトを実行し、追跡対象の
`docs/manual/images/` と `docs/manual/shot-geometry.json` を更新する。

1. 専用 worktree でソースを確定する。
2. `e2e` で動作を検証する。既定では撮影は走らない。
3. `e2e:shots` を行った場合は、画像を確認して意図した差分を明示的にコミットする。
   撮影を配布に含めない場合は、元の作業を消さず清浄な別 worktree から配布する。
4. `git status --short` が空であることを確かめてから `dist` を実行する。

`dist` はコミットされた図からPDFを作る。ソースと図の版が異なる配布物を作らないこと。

## 7. git の作法（**違反すると他タスクの作業が消える**）

作業場所は元のOJTフォルダ内に限定する（`AGENTS.md`）。worktreeが必要な場合も
`OJT/.worktrees/phase7` を再利用し、親のgit-projectsに兄弟フォルダを増やさない。
不要になった作業フォルダは未反映の変更と未保存ファイルを確認して片付ける。

2026-09-19 に `git stash` で並行作業中の変更が失われた事故があった。このリポジトリは複数の
自動化エージェントが同時に同じ作業ツリーを触ることがあるため、以下は**常に禁止**である。

- `git stash` / `git stash pop`
- `git reset --hard` / `git checkout -- <path>`（自分が触っていないパスに対して） / `git clean`
- `git commit --amend` / `git rebase -i` / `git rebase --autostash`
- 自分が触っていないファイルの `git add` / `git restore --staged`
- `git pull --rebase`（作業ツリーに他者の未コミット変更があるとき）

**代わりにすること**:

- 並行して進む作業は**worktree**で行う（`git worktree add --detach <path> origin/main`）。
  共有ツリーが必要なとき以外は共有ツリーで長時間の作業をしない。
- 共有ツリーでコミットするときは**対象パスを明示**する
  （`git commit --only -- <paths>`）。ステージ前に `git diff origin/main -- <file>` で
  自分の差分だけかを確認する。
- 共有ツリーが fast-forward できない（他が同じファイルを書き換え中）ときは
  `git format-patch` でパッチを作り、使い捨ての worktree で `origin/main` を取得して
  `git am`（または `git apply --index --3way`）してからコミットし、`push origin HEAD:main`
  したのち worktree を `git worktree remove --force` で片付ける。
- ビルド・E2E・`dist`（§6）は必ず worktree で行う。
- push は `git push origin main` に頼らず、`git fetch origin` で最新化してから
  `git status -sb` を見て `ahead N, behind 0` のときだけ直接 push し、それ以外は上記の
  patch 経由で land させる。

## 8. パッケージ構成

`packages/*` の各パッケージには短い README がある（目的とエントリポイントの要約）。
詳しい設計は `docs/superpowers/specs/2026-09-13-ojt-electrical-trainer-design.md` を見ること。

- `packages/board-model` — 盤・部品カタログ・配線経路
- `packages/circuit-sim` — 回路シミュレーションエンジン
- `packages/content` — 内蔵課題データとスキーマ
- `packages/ladder-core` — PLCラダーのIRとランタイム
- `packages/plc-dialects` — 4メーカーの方言プロファイル
- `packages/schematic-core` — 回路図エディタの中核ロジック

## 9. リリース手順（`apps/desktop/package.json` の `version` を上げるとき）

1. `git fetch origin` して `main` を最新化する。
2. `pnpm install --frozen-lockfile` → `pnpm verify` が無警告で通ること。
3. `pnpm --filter @ojt/content validate src/builtin` が0件の問題であること。
4. **使い捨ての worktree**で `pnpm --filter @ojt/desktop build` → `pnpm --filter @ojt/desktop e2e`
   を2回連続グリーンで確認する（既定のE2Eは図を撮り直さない。§6）。
5. **`git status --short` が空であることを確認してから**、同じ worktree で
   `pnpm --filter @ojt/desktop dist` を実行する（§6。空でなければ `git checkout -- docs/manual`
   で戻してから実行する）。`release/artifacts.md` が生成されることを確認する。
   続けて `pnpm --filter @ojt/desktop e2e:packaged` を実行する。配布EXEを1つだけ別フォルダへ置き、
   一時userDataとCDPで課題・3D判定・ヘルプ・PLC・終了時の展開物削除を確認する。
   `check-dist` は旧版混入・内蔵課題の内容違い・asarの欠損や不要依存・PDF形式・保護設定を拒否する。
   PDFの発行日は `OJT_MANUAL_DATE`（YYYY-MM-DD）→最新コミットの日→Gitがない場合だけ当日の順。
6. `docs/releases/<version>.md` にリリースノートを書き、「やっていないこと」を明記する。
7. 利用者の明示の指示がある場合に限り `git tag` と GitHub Release を行う（タグ付け・公開は
   明示の指示があるタスクのみが行う）。

## 10. 商標・画像の扱い

各社製品名・ロゴ・画面キャプチャは同梱・複製しない（README「ライセンスと商標」、設計仕様
`docs/superpowers/specs/2026-09-13-ojt-electrical-trainer-design.md` §17参照）。純正ツールの
外観はカタログの寸法・一般に知られた特徴から再現し、写真やスクリーンショットの複製はしない。

### Git 名義の保護

- `pre-commit` は実際に使われる author / committer の両方を調べ、`Gate test` や `.invalid` などのテスト用名義を拒否する。
- `pre-push` は今回送信する**全コミット**の author / committer を検査する。現在の設定だけを直しても、送信範囲に誤名義が残っていれば送信できない。
- テスト用リポジトリには `user.name` / `user.email` を永続設定しない。`git -c` により1回のプロセス内だけで指定し、子プロセスへ渡す環境から `GIT_*` を除く。
- 親リポジトリを指す環境変数を意図的に与えても、親の設定・HEAD・インデックスが変わらないことを回帰テストで確認する。実際の commit / push の拒否と送信先 HEAD の不変も確認する。
- 正しい個人名義は利用者の既存設定を使う。自動で書き換えない。フックを `--no-verify` で省略しない。
