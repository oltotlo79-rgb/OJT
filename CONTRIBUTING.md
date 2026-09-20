# CONTRIBUTING（開発の作法）

このリポジトリで散らばりがちな規約を1枚にまとめたものである（QA-22）。個別の詳しい話は
各ファイルのコメントに譲り、ここでは**どこに何があるか**と**守るべき手順**だけを記す。

## 1. 始める前に

```bash
pnpm install --frozen-lockfile   # lockfile が package.json と同期していることを確認する
pnpm verify                      # typecheck / lint / -r test。コミット前に必ず1回通す
```

`.npmrc` の `engine-strict=true` と `package.json` の `engines.node`（`>=22 <26`）により、
対応外の Node.js では `pnpm install` 自体が失敗する。CI（`.github/workflows/ci.yml`）は
`push`/`pull_request` のたびに `pnpm install --frozen-lockfile && pnpm verify` を走らせる
（`verify` ジョブ）。ビルド＋E2E（`build-e2e` ジョブ）はタグ付けか手動起動のときだけ走る。

## 2. コミット前に `pnpm verify`

`pnpm verify` は `pnpm typecheck && pnpm lint && pnpm -r test` の別名である。個々のパッケージ
だけを直したときは `pnpm --filter <pkg> test` で当該分だけ先に確かめてよいが、**コミット前には
必ず一度 `pnpm verify` をルートで実行**すること。カバレッジ実測が要るときは
`pnpm --filter @ojt/desktop test:coverage`（`vitest run --coverage`）を使う。

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

`pnpm --filter @ojt/desktop e2e` は `manual-shots.spec.ts` で取扱説明書の図を**追跡下の
`docs/manual/images/` に上書きして撮り直す**（SwiftShader の実描画なのでバイト列は毎回
変わりうる）。`node apps/desktop/scripts/build-manual.mjs` がそのフォルダを
`resources/manual/images/` へ複写し、`print-manual.mjs` がそこから `manual.pdf` を焼く。

**したがって、`e2e` を先に走らせてから `dist` を走らせると、タグ付けしたツリーではなく
撮り直した図で配布物が作られる。** 規則:

- `pnpm --filter @ojt/desktop e2e` と `pnpm --filter @ojt/desktop dist` は**必ず使い捨ての
  worktree**（`git worktree add --detach <path> origin/main`）で行う。共有ツリーでは走らせない
  （前提D）。
- `dist` を走らせる直前は必ず `git status --short` が**空**であることを確認する。空でなければ、
  `e2e` の撮り直しが残っている可能性がある。`git checkout -- docs/manual` で戻してから
  `dist` する。
- 手順の順番は「①ソース確定 → ② `e2e` で検証（撮り直しが出ても構わない） → ③ 作業ツリーを
  戻す（`git status --short` が空になるまで） → ④ `dist`」。逆順（`e2e` の直後にそのまま
  `dist`）にしない。

この節が**正本**である（旧・`docs/superpowers/handoff/2026-09-14-phase2-handoff.md` の
最終行にしかなかった注意を移した。QA-21）。README「開発者向け」にも同じ要旨を短く載せている。

## 7. git の作法（**違反すると他タスクの作業が消える**）

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
   を2回連続グリーンで確認する（§6のとおり、この時点で `docs/manual/images/` が撮り直される
   ことがある）。
5. **`git status --short` が空であることを確認してから**、同じ worktree で
   `pnpm --filter @ojt/desktop dist` を実行する（§6。空でなければ `git checkout -- docs/manual`
   で戻してから実行する）。`release/artifacts.md` が生成されることを確認する。
6. `docs/releases/<version>.md` にリリースノートを書き、「やっていないこと」を明記する。
7. 利用者の明示の指示がある場合に限り `git tag` と GitHub Release を行う（タグ付け・公開は
   明示の指示があるタスクのみが行う）。

## 10. 商標・画像の扱い

各社製品名・ロゴ・画面キャプチャは同梱・複製しない（README「ライセンスと商標」、設計仕様
`docs/superpowers/specs/2026-09-13-ojt-electrical-trainer-design.md` §17参照）。純正ツールの
外観はカタログの寸法・一般に知られた特徴から再現し、写真やスクリーンショットの複製はしない。
