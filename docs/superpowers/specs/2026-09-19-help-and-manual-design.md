# 取扱説明書とアプリ内ヘルプ 設計仕様（Phase 6）

本書は、設計仕様 `docs/superpowers/specs/2026-09-13-ojt-electrical-trainer-design.md`（以下「本体仕様」）の §16 Phase 6 の行を実装するための詳細設計である。本体仕様の節番号は「§4.3」のように参照する。

対象アプリ名は **電気教育ツール**（本体仕様 §17.2 #18）。画面に出る文言はすべて日本語のみ（§15）。各社のロゴ・アイコン・画面キャプチャ・マニュアル本文は一切複製しない（§15、§17.1）。

---

## 1. 目的と範囲

### 1.1 目的

| # | 目的 | 満たし方 |
|---|---|---|
| 1 | 新しく入った人が、誰にも聞かずにこのアプリを使い切れるようにする | すべての機能を使用者目線・専門用語なしで解説した**取扱説明書**を同梱する |
| 2 | 操作中に「これは何をするボタンか」がその場で分かるようにする | どの画面からも `F1` と「ヘルプ」ボタンで開く**アプリ内ヘルプ**を置き、**いま開いている画面の節**を最初に見せる |
| 3 | 説明書とヘルプの食い違いを構造的に起こらなくする | **Markdown の正本1つ**から、アプリ内ヘルプ用のデータと PDF 用の HTML を**同じ工程で2つ**生成し、一致を自動検査する |
| 4 | 持ち帰って読める・印刷できる形を用意する | Markdown → HTML → **PDF** をビルド時に生成し、インストーラとポータブル版の両方に同梱する。アプリからは「説明書（PDF）を開く」で OS の既定ビューアに渡す |
| 5 | 図を見ただけで操作が分かるようにする | 図は**すべて実際の画面のスクリーンショット**（作り絵・模式図・手描きは使わない）。説明する操作要素の上に**丸数字の吹き出し（①②③）と枠**を機械で描き込み、本文はその番号で場所を指す |

### 1.2 範囲に含むもの

- アプリ内ヘルプ（`F1`／各画面の「ヘルプ」ボタン／目次／検索／現在画面の節／「説明書（PDF）を開く」）
- 取扱説明書の正本（`docs/manual/` の Markdown 13章）と、丸数字の吹き出しを描き込んだスクリーンショット
- Markdown → HTML → PDF の生成スクリプトと、electron-builder による PDF の同梱
- PDF を開くための IPC チャネル1本（`manual:open`。§4.3 の7本に対する8本目）
- 内容一致・機能網羅・文体（専門用語の不使用）・画像の自動検査

### 1.3 範囲に含まないもの

| 含まない | 理由 |
|---|---|
| 多言語化 | §15「日本語のみ」 |
| 動画・音声の教材 | §15「音声ファイルを同梱しない」。配布サイズと作成コストに見合わない |
| Web での説明書公開 | §15「実行時・起動時に外部通信を行わない」。公開は利用者の明示の指示があるまで行わない（Plan 5 決定表#22） |
| 課題エディタのGUI | §16 Phase 5 の「含まない」を引き継ぐ。課題の作り方は説明書の「指導者向け」章で JSON の書き方として説明する |
| リリースの公開（タグ付け・GitHub Release・配布） | 利用者の明示の決定（2026-09-19）。本フェーズも成果物を作るところまで |

---

## 2. 本書で使う言葉

| 言葉 | 意味 |
|---|---|
| **正本**（Markdown） | `docs/manual/*.md`。人が書いて git で管理する唯一の原稿 |
| **章**（chapter） | 正本のファイル1つ。先頭の `#` 見出しが章題 |
| **節**（section） | 章の中の `##` 見出し1つ。ヘルプが開く単位であり、検索の当たる単位 |
| **節ID** | `<章ID>/<節の見出し>`（例: `mode-c1/不良の見分け方`）。`<章ID>` はファイル名から連番と拡張子を除いたもの（`04-mode-c1.md` → `mode-c1`） |
| **生成物** | 正本から機械的に作るもの。`manual-content.ts`（アプリ内ヘルプ用）、`manual.html`（PDF用）、`manual.pdf` |
| **機能一覧表** | `docs/manual/coverage.json`。画面 × 操作要素 × 説明している節の対応表。検査の入力でもある |
| **場所別ヘルプ** | 既にある、その場に出る説明（C1の判定表、モードDのキー割当欄、設定の説明文、「このアプリについて」、ビューのヒント） |

---

## 3. 決定表（この設計で決めたことと理由）

| # | 決めたこと | 採用した設計 | 理由・却下した案 |
|---|---|---|---|
| 1 | **正本をどこに置くか** | `docs/manual/*.md`（Markdown、日本語、git 管理）。アプリのソースには**原稿を1文字も置かない** | 原稿をアプリ側に置くと、差分レビューがコードの差分に埋もれ、訓練担当者が読めない。`docs/` は既に仕様・調査資料・リリースノートの置き場であり、`.prettierignore` で整形対象外なので日本語の行送りを崩されない |
| 2 | **アプリ内ヘルプと説明書を同じ内容にする方法** | **正本を1回だけ変換**し、`manual-content.ts`（アプリ用）と `manual.html`（PDF用）を**同じ関数の同じ呼び出し**から書き出す。生成物のうち `manual-content.ts` は git に入れ、`manual-sync.test.ts` が「いま正本から作り直した結果」と**バイト単位で一致**することを検査する | 「同じ内容を2箇所に書く」は必ずずれる。`manual-content.ts` を git に入れるのは、`pnpm build` / `typecheck` / `test` が clone 直後に通るようにするため（生成しないと型検査が落ちる）。バイト一致検査があるので、生成物を手で直しても必ず落ちる |
| 3 | **Markdown の変換に何を使うか** | **`markdown-it`** を `apps/desktop` の **devDependencies** に入れる（正確な版で固定）。`dependencies`（実行時依存）は**1つも増やさない** | 説明書には判定表・キー割当表・メーカー別表など**表**が多く、HTML の escape も要る。自前の変換器は表の桁ずれや escape の抜けを静かに作る。`markdown-it` は純 JS でビルド時にしか動かないので、asar にも実行時にも入らない（§15 のオフライン方針に影響しない）。版は lockfile で固定する |
| 4 | **PDF の作り方** | **Electron 自身の `webContents.printToPDF()`**。`electron scripts/print-manual.mjs` が隠しウィンドウで `manual.html` を開いて PDF にする | puppeteer や wkhtmltopdf は Chromium をもう1つ取りに行く（§15 のオフライン方針・配布サイズに反する）。Electron は既に devDependency にあり、配布に使っているのと同じ Chromium で組版するので「画面で見たとおり」になる。`generateDocumentOutline: true` で見出しからしおりも付く |
| 5 | **PDF をどこに置き、git に入れるか** | 生成先は `apps/desktop/resources/manual/`（`manual.html` / `images/` / `manual.pdf`）。このフォルダは **`.gitignore` に入れて git に入れない** | PDF は 5〜10MB あり、原稿を直すたびに履歴が太る。正本（Markdown と PNG）は git にあるので、失っても必ず作り直せる。`resources/content` を git に入れているのは配布課題を人がレビューするためで、PDF は中身が正本と同一であることを検査で保証できるため入れる必要がない |
| 6 | **PDF の同梱方法** | `electron-builder.yml` の `extraResources` に `resources/manual/manual.pdf → manual.pdf` を足す。NSIS・ポータブルの両方が `extraResources` を共有するので**1項目で両方に入る** | asar の中に入れると `shell.openPath()` で開けない（asar 内のパスは OS のビューアが読めない）。`extraResources` なら配布物の `resources/manual.pdf` に実体で置かれる。課題JSONと同じ流儀（§7.8） |
| 7 | **PDF を開く手段** | **IPC を1本足す**（`manual:open`。§4.3 の7本に対する8本目）。main 側が `shell.openPath()` を呼ぶ。**引数を1つも取らない**（パスは main が決める） | renderer からはシェルを呼べない（`contextIsolation`）。引数を取らせると「renderer から任意のパスを開かせる」穴になるので、チャネルの形そのもので塞ぐ。`file:saveText`（Phase 4 の7本目）と同じ考え方 |
| 8 | **PDF が無いときの振る舞い** | 開発中は `resources/manual/manual.pdf` が無いことがある。ボタンは**常に出す**が、無ければ「説明書（PDF）が見つかりません。この画面のもくじから同じ内容を読めます。」と伝える | ボタンを隠すと「配布版にはあるのに開発中は無い」差が画面に出て、E2E も分岐する。§13 の「黙って失敗しない」に従い、代わりの読み方まで1文で示す |
| 9 | **アプリ内ヘルプに図（スクリーンショット）を出すか** | **出す**（利用者の決定 2026-09-20）。引き出しには**幅400pxの縮小版**を出し、押す（またはキーボードで `Enter`）と**原寸**が覆いで開く。`Esc` と「閉じる」で戻る。縮小版は `docs/manual/images/small/` に作り、原寸と**同じファイル名**にする | 当初は「PDF を開いてください」の1行に置き換える設計にしていたが、利用者が「縮小版の図をヘルプにも出す」を選んだ。**説明書とヘルプが一致していること**（利用者要求1）は本文だけでなく図にも及ぶべきで、1行の案内では「ヘルプを読んでも図が見られない」状態が残る。幅400pxなら引き出し（420px）にそのまま収まり、細かい字を読みたいときだけ原寸を覆いで開けばよい。取り込みで asar は **実測 2〜3MB**（上限でも 6.4MB）増えるが、図が読めないほうの損のほうが大きい。一致検査は**本文の素の文（図の行を除く）に加えて、図のファイル名の並び**も比べる（決定表#12） |
| 10 | **場所別ヘルプをどうするか** | **残す。移さない。**そのうえで「コードが持っている表」（C1の判定表 `DIAGNOSIS_TABLE`、モードDのキー割当 `DialectProfile.shortcuts`、設定の説明文 `JA.settings.*Help`、商標注記 `JA.settings.trademarkNotice`）は、**説明書が同じ内容を載せ、テストが1行ずつ一致を検査する** | 場所別ヘルプは「作業の手を止めずに読める」ことが値打ちで、引き出しに集めると手が止まる。表の実体をコード側に残すのは、判定表もキー割当も**アプリの動作そのもの**が使っているデータだから（説明書に移すと動作が原稿に依存する）。一致はテストで縛れば、どちらを直しても必ず気付く |
| 11 | **コードの表を説明書へ「生成」で埋め込まないのはなぜか** | 埋め込まず、**手書きの表 ＋ 一致検査**にする | 変換スクリプトは素の Node（`.mjs`）で動く。ワークスペースの `@ojt/*` は**生の TypeScript を `.js` 付きの import で**公開しているので、Node からは読み込めない（`./profile.js` の実体が無い）。Vitest なら読めるので、**検査をテスト側に置く**のが唯一の筋の通る置き場所である。生成にこだわると変換工程に TS ローダを増やすことになり、§15 のビルド再現性を下げる |
| 12 | **一致検査で何を比べるか** | ①`manual-content.ts` が「いま正本から作り直した結果」と**バイト一致** ②`manual-content.ts` と `manual.html` の両方から取り出した**節ID・見出し・本文の素の文**（図の行を除く）が**完全一致** ③同じく両方から取り出した**図のファイル名の並び**が節ごとに**完全一致** | ①だけだと「片方だけ古い」は防げるが「変換の道が2本に分かれた」ことは見えない。②を足すと、生成の経路が2つあっても人が読む内容は同じだと言い切れる。③は利用者の決定（2026-09-20）で図もヘルプに出すようになったため——**どの節にどの図が何番目に出るか**まで一致していないと「同じ説明書」と言えない |
| 13 | **節IDの付け方** | `<章ID>/<節の見出し>`。章IDはファイル名の連番と拡張子を除いたもの | 数字の連番だけだと節を1つ増やすたびに全部ずれる。日本語の見出しをそのまま使うのは、`coverage.json` を人が読んで直せるようにするため（URL にはしないので符号化は不要）。同じ章の中で見出しが重複したらテストで落とす |
| 14 | **ヘルプの状態をどこに置くか** | `renderer/help/help-store.ts` に**専用の小さな zustand ストア**を作る。`app/store.ts` には1行も足さない | ヘルプは課題・セッションと無関係で、`openProblem()` / `resetSession()` / `restartSession()` / `abandonSession()` の4箇所すべてに初期値を入れて回る必要がない（Plan 5 MERGE 注意#2 が挙げた罠）。共有ファイルを触らないので並行作業の衝突も減る |
| 15 | **ヘルプの見た目（引き出しか、覆いか）** | **右からの引き出し（drawer）**。幅は 420px（画面が 1100px 未満のときは全幅）。背面は薄く覆い、外側を押すと閉じる。`role="dialog"` ＋ `aria-modal="true"` ＋ フォーカストラップ | 覆い（全画面モーダル）にすると、盤やラダーを見ながら読めない。引き出しなら「この端子は何か」を見ながら読める。ただしキーボードの行き来を単純にするため、開いている間は**モーダル1枚として積む**（`pushModalLayer()`）。既存の拡大表示（`ChartModal` / `SchematicModal` / `NotationDialog`）と同じ作法に揃える |
| 16 | **`F1` と既存のモードD の `F1` の調停** | ラダー編集の `help` 動作（`GX_STYLE_SHORTCUTS` の `F1`）を**トーストからヘルプを開く動作に変える**。ラダー側が処理したら `preventDefault()` し、窓口側の `F1` は `defaultPrevented` を見て**何もしない** | いまの `F1` は「キー割当は右側の欄に出ています」というトーストを出すだけで、§10.6 が言う「`F1` ヘルプ」に足りていない。両方が動くと引き出しが開いた直後にトーストが重なる。`defaultPrevented` で見るのは、ラダー編集の `onKeyDown` が窓口の listener より**先に**走る（React のルートは window より内側）ため確実に効くからである。OMRON のスキンは `F1` を持たないが、窓口側の `F1` が拾うので**4スキンとも同じように開く** |
| 17 | **`F1` を窓口（window）で拾う範囲** | `HelpRoot` が `window` の `keydown` で `F1` を拾う。**入力欄で打鍵中・IME変換中でも開く**（`shouldIgnoreShortcut()` を通さない）。ただしヘルプが既に開いていれば閉じる（トグル） | `F1` は文字入力に使わないキーなので、盤の `1`/`2`/`3` や `Delete` と違って取り違えが起きない。むしろ「デバイス名を打ち込んでいる最中に書き方が分からない」ときこそヘルプが要る。`Esc` は既存の作法どおりモーダル最上段だけが受ける |
| 18 | **どの画面の節を最初に開くか** | `currentHelpScreen(route, mode, assembleView)` という純関数が画面IDを返し、`HELP_SECTION_BY_SCREEN` が節IDに写す。9種（`home` / `list` / `settings` / `assemble` / `schematic` / `inspect-parts` / `inspect-repair` / `plc` / `result`） | 「どの画面か」は `route` だけでは決まらない（`session` は4モードある。モードBは回路図ビューに切り替わる）。純関数にすれば 3D もストアも無しで単体テストできる（§12.2 の「純粋関数化」と同じ趣旨） |
| 19 | **検索の仕方** | 見出しと本文の**素の文**に対する部分一致。比較前に NFKC 正規化＋小文字化＋空白除去。当たった節を一覧に出し、押すとその節へ跳ぶ。上限20件 | 形態素解析器も索引も持ち込まない（実行時依存を増やさない。§15）。全13章で本文はおよそ6万字なので、打鍵ごとの全文走査でも 1ms 程度で終わる。「自己保持」「レアショート」のような**語の断片で探す**用途には部分一致で足りる |
| 20 | **説明書の章立て** | 13章（§6.1 の表）。1章＝1ファイル＝1つの話題 | 章を細かく切ると目次が長くなり、まとめると節の粒度が粗くなってヘルプが「いまの画面の説明」を出せない。モードごとに1章にすると、ヘルプの初期表示（決定表#18）と章が1対1になる |
| 21 | **文体の縛り方** | ①**禁止語リスト**（`store` / `IPC` / `zustand` / `Worker` / `props` / `React` / `testid` / `frameloop` / `asar` / `ネットリスト` など）を0件にする ②**初出の印**: `terms.json` に挙げた専門用語は、本文で最初に出るところを `**用語**（やさしい説明）` の形で書く ③用語集に必ず載せる | 「専門用語を使わない」は読むだけでは検査できない。禁止語は機械で数えられる。避けられない専門用語（自己保持・a接点・レアショート・母線・方言…）は**消すのではなく初出で噛み砕く**しかないので、初出の書き方を形で決めて正規表現で検査する |
| 22 | **機能網羅の縛り方** | `scripts/feature-inventory.mjs` が `src/renderer/**/*.tsx` から `data-testid` を全部拾う。`docs/manual/coverage.json` が**その全部**について「どの節で説明しているか」または「画面に出ない内部用である理由」を持つ。テストは**両者の集合が完全一致**することを要求する | 「全機能を説明した」は主観なので、機械で数えられる代理を置く。`data-testid` は画面の操作要素にほぼ1対1で付いており（Phase 1〜5 の E2E がそうしてきた）、**新しいボタンを足すとテストが落ちて説明書を直すまで通らない**という圧力になる。キー操作とマウス操作には `data-testid` が無いので、`coverage.json` に手書きの配列（`keys` / `gestures`）を別に持ち、そちらは「節が実在し、そのキー文字列が本文に出ること」を検査する |
| 23 | **メッセージの網羅** | `coverage.json` の `messages` が、`JA.error` / `JA.hazard` / `JA.staticCheck` / `JA.disabledReason` / `JA.routeReason` / `JA.mismatchReason` / `MSG` の全キーを並べる。テストは「実物のキー集合と一致」かつ「その文言がトラブル対処の章に出る」ことを要求する | 「こう表示されたら」を読者が引けるのは、**アプリが出す文言そのもの**で引けるときだけである。要約を載せると引けない |
| 24 | **スクリーンショットの撮り方** | Playwright の E2E 1本（`e2e/manual-shots.spec.ts`）がアプリをその画面まで動かし、`BrowserWindow.capturePage()` で**素のPNG**を撮る。ウィンドウは `setContentSize(1280, 800)`、`--force-device-scale-factor=1`。素のPNGは git に入れない | 手で撮ると版ごとに大きさも視点もばらつき、撮り直しが人の仕事になる。`capturePage()` は既存6本の E2E が使っている方法で、ウィンドウが隠れていても WebGL の中身ごと撮れる。`setBounds` ではなく `setContentSize` を使うのは、枠を除いた**中身**を 1280×800 にするため |
| 24b | **図はすべて実際の画面であること** | 作り絵・模式図・手描き・他社ツールの画面は**1枚も使わない**。`docs/manual/images/` に置けるのは `e2e/manual-shots.spec.ts` が撮って `scripts/annotate-shots.mjs` が仕上げた PNG だけで、`docs/manual/shots.json` に定義の無いファイルがあるとテストが落ちる | 利用者の決定（2026-09-19）。実物と違う絵を載せると、読み手は画面の中でそれを探して見つからない。ファイル名の集合を定義ファイルと完全一致で縛れば、手で置いた画像が紛れ込めない |
| 24c | **吹き出しの描き方** | `docs/manual/shots.json` が図ごとに `{ crop?, callouts: [{ n, x, y, w, h, label }] }` を持つ。`scripts/annotate-shots.mjs` の `overlayHtml()` が「素のPNGを背景にし、枠と丸数字を絶対位置で重ねた HTML」を組み、**Playwright の Chromium がその HTML を開いて撮り直す**ことで仕上げの PNG になる | 依存を1つも増やさない方法のうち、**文字がきちんと描ける**のはこれだけである。純 JS の PNG 描画で丸数字と日本語ラベルを出すにはフォントのラスタライザが要り、重い依存になる。Chromium は既に Playwright として devDependency にあり、OS のフォント（Yu Gothic UI）でアプリと同じ字が出る。`overlayHtml()` を別ファイルの純関数にしてあるので、Playwright を起動せずに Vitest で中身を検査できる |
| 25 | **画像の大きさと寸法** | **すべて 300KB 以下**。寸法は 1280×800、ただし `shots.json` に `crop` を書いた図はその切り出し寸法。`manual-images.test.ts` が PNG のヘッダから寸法を読み、`shots.json` の指定と照らす | 図を1つの基準（300KB）で縛れると、重い図が紛れ込まない。3D盤の写る図は素のままでは 300KB を超えるが、**切り出し（crop）を狭める**と収まる。縮小（解像度を落とす）はしない——端子の番号が読めなくなって図の意味が消えるからである。つまり超えたときの直し方は「crop を狭める」の一手に決まっている |
| 26 | **PDF の組版** | A4 縦、余白 上下 18mm・左右 16mm（`printToPDF` はインチ指定）、背景色を印刷する、しおりを生成する。表紙に製品名・版・生成日 | 印刷して配る場面（新人教育）を想定する。背景色を印刷しないと表のヘッダ行が白飛びして読めない |
| 27 | **配布物の検査** | Plan 5 Task 14 の `scripts/check-dist.mjs` に**3点だけ足す**: ①`release/win-unpacked/resources/manual.pdf` があること ②その大きさが 0 バイトでないこと ③`release/artifacts.md` の表に PDF の行（バイト数と SHA256）が載ること | 検査の置き場所を増やさない。Plan 5 が作る仕組みにぶら下げる（本フェーズは Plan 5 Task 14 が landed していることを前提にする） |
| 28 | **`ja.ts` に説明の本文を書かないこと** | `JA.help` は**画面の部品名だけ**（見出し・ボタン名・入力欄の説明・見つからないときの1文）。値は**40文字以下**で、テストがそれを検査する | 本文が `ja.ts` に入った瞬間に「正本が2つ」になる。40文字という機械的な線を引けば、うっかり段落を書き足せない |

---

## 4. 正本と生成物

### 4.1 ファイル構成

| パス | 中身 | git |
|---|---|---|
| `docs/manual/00-intro.md` 〜 `12-troubleshooting.md` | 正本（13章） | 入れる |
| `docs/manual/images/*.png` | 吹き出しを描き込んだスクリーンショット17枚（原寸） | 入れる |
| `docs/manual/images/small/*.png` | 同じ17枚の**縮小版**（幅400px。アプリ内ヘルプが出す。決定表#9） | 入れる |
| `docs/manual/shots.json` | 図の意味（説明文と吹き出しの番号・ラベル） | 入れる |
| `docs/manual/shot-geometry.json` | 図の場所（吹き出しの矩形と切り出し） | 入れる |
| `apps/desktop/scripts/annotate-shots.mjs` | 吹き出しを重ねた HTML を組む純関数 | 入れる |
| `apps/desktop/.manual-raw/*.png` | 撮ったままの素のPNG | 入れない |
| `docs/manual/coverage.json` | 機能一覧表（`controls` / `keys` / `gestures` / `messages`） | 入れる |
| `docs/manual/terms.json` | 初出で噛み砕く専門用語の一覧 | 入れる |
| `docs/manual/style.json` | 禁止語リストと、禁止語を免除する章 | 入れる |
| `apps/desktop/scripts/manual-build.mjs` | 変換の本体（純関数 `buildManual()`） | 入れる |
| `apps/desktop/scripts/build-manual.mjs` | 変換を走らせて生成物を書く | 入れる |
| `apps/desktop/scripts/print-manual.mjs` | Electron で HTML → PDF | 入れる |
| `apps/desktop/scripts/feature-inventory.mjs` | `data-testid` の収集 | 入れる |
| `apps/desktop/src/renderer/help/manual-content.ts` | **生成物**（アプリ内ヘルプ用のデータ） | 入れる（決定表#2） |
| `apps/desktop/resources/manual/manual.html` | **生成物**（PDF用） | 入れない（決定表#5） |
| `apps/desktop/resources/manual/images/*.png` | **生成物**（`docs/manual/images` の複写） | 入れない |
| `apps/desktop/resources/manual/manual.pdf` | **生成物** | 入れない |

### 4.2 変換（`buildManual()`）

入力は「ファイル名 → 中身」の並び（ファイル名の昇順）。出力は次の4つ。

```
buildManual(files) => { chapters, sections, helpModule, printHtml }
```

| 出力 | 中身 |
|---|---|
| `chapters` | `{ id, title, sectionIds }` の並び。`title` は章の先頭の `#` 見出し |
| `sections` | `{ id, chapterId, chapterTitle, title, html, text, hasFigure }` の並び |
| `helpModule` | `manual-content.ts` の全文（`MANUAL_CHAPTERS` / `MANUAL_SECTIONS` / `MANUAL_SOURCES` / `MANUAL_IMAGES` を輸出する TypeScript） |
| `printHtml` | `manual.html` の全文（表紙 ＋ 目次 ＋ 全章。図は `<img>` のまま） |

規則:

1. 章の先頭行は `# <章題>` でなければならない（そうでなければ変換が例外を投げる）。
2. `##` 見出しが節の区切り。`###` 以下は節の中身。
3. 節の `html` には `##` 見出しそのものを**含めない**（見出しは画面側が `<h2>` として描く）。
4. `text` は `html` からタグを取り除き、連続する空白を1つにした素の文。**図の行は `text` に入れない**。
5. 図は**両方に出す**（決定表#9）。PDF 側は `<figure><img src="images/<名前>.png" alt="…"><figcaption>…</figcaption></figure>`。アプリ内ヘルプ側は `<figure class="manual-figure"><button type="button" data-manual-image="<名前>"><img data-manual-image="<名前>" alt="…" loading="lazy" width="400"></button><figcaption>…</figcaption></figure>` とし、**`src` は書かない**——実際のURLは束ね方（Vite）が決めるので、画面側が `MANUAL_IMAGES` から差し込む（§5.3）。
6. `markdown-it` は `{ html: false, linkify: false, typographer: false }` で使う。原稿に書かれた生の HTML は escape される（原稿は HTML を書かない）。
7. 見出しの重複（同じ章に同じ `##` 見出しが2つ）は例外にする。

### 4.3 一致検査（`manual-sync.test.ts`）

| # | 検査 |
|---|---|
| 1 | `docs/manual/*.md` を読んで `buildManual()` を呼び、`helpModule` が `src/renderer/help/manual-content.ts` の中身と**完全一致**する |
| 2 | `MANUAL_SOURCES`（生成物が覚えている入力ファイル名の並び）が、いまの `docs/manual/*.md` の並びと一致する |
| 3 | `printHtml` から取り出した節ID・見出し・素の文の一覧が、`MANUAL_SECTIONS` の同じ3つと**完全一致**する |
| 4 | すべての節IDが一意である |
| 5 | `printHtml` と `MANUAL_SECTIONS` の**図のファイル名の並び**が節ごとに一致する（決定表#12 ③） |

`JA.help` のすべての値が40文字以下であること（決定表#28）は `help-drawer.test.tsx` が見る（`JA.help` は引き出しと一緒に作られるので、変換のテストからは見えない）。

検査1は `resources/manual/manual.html`（git に入れない）を見に行かない。`printHtml` を**その場で作って**比べるので、ビルドしていない clone でも走る。

---

## 5. アプリ内ヘルプ

### 5.1 開き方

| 開き方 | 置き場所 |
|---|---|
| `F1`（どの画面でも） | `HelpRoot`（`App.tsx` に1つだけ置く）が `window` の `keydown` で拾う。開いていれば閉じる |
| 「ヘルプ」ボタン | ホーム（`homeHeader`）／課題一覧（新しい `screenHeader`）／設定（同）／セッション4画面（共有の `Toolbar`）／結果（`Result.tsx` の共通ヘッダ） |
| モードDのラダー編集での `F1` | スキンのキー割当表の `help` 動作。ヘルプをモードDの節で開き、`preventDefault()` する（決定表#16） |

ボタンはどれも `renderer/help/HelpButton.tsx` の1つの部品で、`data-testid="open-help"` を持つ。同時に描かれるのは常に1つである。

### 5.2 画面と節の対応

```
currentHelpScreen(route, mode, assembleView) => HelpScreenId
```

| route | mode | assembleView | 画面ID | 最初に開く節 |
|---|---|---|---|---|
| `home` | — | — | `home` | `intro/このアプリでできること` |
| `list` | — | — | `list` | `screens/課題をえらぶ` |
| `settings` | — | — | `settings` | `settings/設定の画面` |
| `session` | `assemble` | `board` / `split` | `assemble` | `mode-b/回路を組み立てる` |
| `session` | `assemble` | `schematic` | `schematic` | `schematic/回路図を描く` |
| `session` | `inspect-parts` | — | `inspect-parts` | `mode-c1/部品を点検する` |
| `session` | `inspect-repair` | — | `inspect-repair` | `mode-c2/回路を点検して直す` |
| `session` | `plc` | — | `plc` | `mode-d/PLCの課題を進める` |
| `result` | — | — | `result` | `screens/結果の画面` |

### 5.3 引き出しの構成

```
+-------------- 取扱説明書 ---------- [説明書（PDF）を開く] [閉じる] +
| [検索欄: 言葉で探す（例: 自己保持）]                                |
| +-- 目次 ------------+ +-- 本文 ----------------------------------+ |
| | はじめに           | | いまの画面の説明                         | |
| |  ・このアプリで…  | |                                          | |
| | 画面の見方         | | 本文（見出し・段落・箇条書き・表）       | |
| |  ・課題をえらぶ    | |                                          | |
| |  …                | | [縮小版の図 400px]（押すと原寸）         | |
| +--------------------+ +------------------------------------------+ |
+---------------------------------------------------------------------+
```

| 部分 | 仕様 |
|---|---|
| もくじ | 章ごとの `<details>`。いま開いている節を含む章は開いた状態。節は `<button>`（押すと本文が切り替わる）。いまの節は `aria-current="true"` |
| 本文 | 選んだ節の見出し ＋ `html`。生成物の HTML をそのまま差し込む。差し込む文字列は**ビルド時にこのリポジトリの Markdown から作ったもの**しかなく、外部入力は一切混ざらない |
| 図 | 本文を差し込んだあと、`img[data-manual-image]` を走査して `MANUAL_IMAGES[<名前>].small`（幅400pxの縮小版）を `src` に入れる。`loading="lazy"` なので、いま読んでいる節の図だけが読み込まれる |
| 図の拡大 | 図は `<button>` で包む。押す・`Enter`・`Space` で**原寸**（`MANUAL_IMAGES[<名前>].full`）が覆いで開く。覆いは `role="dialog"` ＋ `aria-modal="true"`、焦点は「閉じる」に入り、`Esc`・「閉じる」・背面で戻って**元の図のボタンに焦点が戻る**。`pushModalLayer()` で引き出しの上にもう1枚積む（既存の `ChartModal` と同じ作法） |
| 検索欄 | 1文字以上で走る。結果は「章題 / 節題 / 当たった前後30字」の一覧。0件なら「見つかりませんでした。別の言葉で探してください。」 |
| PDF ボタン | `window.ojt.openManual()`。失敗したら理由をトーストで出す（§9） |
| 閉じる | ボタン／`Esc`／背面を押す／`F1` をもう一度 |

### 5.4 キーボードとアクセシビリティ（§15）

| 項目 | 仕様 |
|---|---|
| 開いた直後の焦点 | 「閉じる」ボタン |
| `Tab` | 引き出しの中だけを回る（フォーカストラップ）。既存の `ChartModal` と同じ `trapFocus()` の作法 |
| `Esc` | 自分が最上段（`depth === topModalLayer()`）のときだけ閉じる |
| 閉じたあとの焦点 | 開く前に焦点のあった要素へ戻す（`NotationDialog` と同じ） |
| 焦点の見え方 | すべての操作要素に `:focus-visible` の枠 |
| 余白 | 8px 格子（`padding` / `gap` / `margin` は4の倍数） |
| 幅 | 420px。ウィンドウ幅 1100px 未満では全幅 |
| 読み上げ | `role="dialog"` ＋ `aria-modal="true"` ＋ `aria-label="取扱説明書"` |

### 5.5 場所別ヘルプとの関係（決定表#10）

| 場所別ヘルプ | 扱い | ずれない仕組み |
|---|---|---|
| C1 の判定表（`panels/DiagnosisHelp.tsx`、`@ojt/content` の `DIAGNOSIS_TABLE` 7行） | そのまま残す | 説明書 `mode-c1/不良の見分け方` に同じ7行の表を書き、`manual-appdata.test.ts` が `DIAGNOSIS_TABLE` の1行ずつが表に出ていることを検査 |
| モードD のキー割当欄（`ladder/ShortcutHelp.tsx`、`DialectProfile.shortcuts`） | そのまま残す | 説明書 `mode-d/キーの割り当て` にメーカー別4表を書き、同テストが `shortcuts` の `keys` と `label` の全組を検査 |
| 設定の説明文（`JA.settings.*Help`） | そのまま残す | 説明書 `settings/設定の画面` に同じ文を載せ、同テストが文字列一致を検査 |
| 「このアプリについて」（`JA.settings.trademarkNotice` / `assumptionNotice`） | そのまま残す | 説明書 `intro/商標と表記について` に同じ文を載せ、同テストが文字列一致を検査 |
| ビューのヒント（`panels/ViewHint.tsx`） | そのまま残す | 説明書 `screens/3Dの見かたと動かしかた` が同じ操作を詳しく書く。ヒントは1行の要約なので文字列一致は要求せず、`coverage.json` の `gestures` で網羅を検査 |

---

## 6. 取扱説明書

### 6.1 章立て

| ファイル | 章ID | 章題 | 節（`##`） |
|---|---|---|---|
| `00-intro.md` | `intro` | はじめに | このアプリでできること／4つの練習の選び方／画面の呼び名／商標と表記について |
| `01-setup.md` | `setup` | パソコンに入れる | 動かすのに必要なもの／インストーラで入れる／持ち運び版を使う／初回に出る青い画面／インターネットにつながなくても使えます／消すとき |
| `02-screens.md` | `screens` | 画面の見方 | ホームの画面／課題をえらぶ／練習中の画面の並び／画面の上の帯／3Dの見かたと動かしかた／端子にさわると出る札／部品を入れかえる／結果の画面／タイムチャートの読み方 |
| `03-mode-b.md` | `mode-b` | 回路を組み立てる（モードB） | このモードでやること／回路を組み立てる／電線をつなぐ・外す／部品をのせる／タイマの時間を決める／電気を流す／押しボタンを押す／「判定」を押す／うまくいかないとき |
| `04-mode-c1.md` | `mode-c1` | 部品を点検する（モードC1） | このモードでやること／部品を点検する／テスターの使い方／不良の見分け方／答えを書き込む／「判定」を押す |
| `05-mode-c2.md` | `mode-c2` | 回路を点検して直す（モードC2） | このモードでやること／回路を点検して直す／回路図と盤を行き来する／あやしい電線の見つけ方／見つけたところを書き出す／直す／「判定」を押す |
| `06-mode-d.md` | `mode-d` | PLCでプログラムを作る（モードD） | このモードでやること／PLCの課題を進める／ラダー図を描く／キーの割り当て／入出力の割り付け／変換する／PLCに書き込む／動きを見る／別のメーカーの書き方に変える／命令の一覧を書き出す／機種を変える |
| `07-schematic.md` | `schematic` | 回路図を描いて確かめる | この機能でやること／回路図を描く／分岐を作る／設定時間を決める／「検算」で確かめる／図のとおりに盤へつなぐ |
| `08-workfile.md` | `workfile` | 作業を保存する・続きからやる | 作業ファイルに保存する／保存した作業を読み込む／前回の作業を復元する |
| `09-settings.md` | `settings` | 設定 | 設定の画面／自分で作った課題を読み込む／音／PLCの既定のメーカー／ラダーの見た目 |
| `10-authoring.md` | `authoring` | 指導者向け: 課題の作り方と配り方 | 課題ファイルの置き場所／課題ファイルの中身／モードBの課題を1つ作ってみる／ほかのモードの課題／採点のしくみ／配り方と更新のしかた |
| `11-glossary.md` | `glossary` | 用語集 | この章の使い方／用語集 |
| `12-troubleshooting.md` | `troubleshooting` | 困ったときは | こう表示されたら／画面が真っ黒になった／3Dが出なくなった／作業ファイルが読めない／説明書（PDF）が開かない／命令名やキーの割り当てについてのお断り |

### 6.2 書き方の規則

| # | 規則 | 検査 |
|---|---|---|
| 1 | 読み手は**入ったばかりの人**。「〜します」「〜してください」で、短く書く | — |
| 2 | **禁止語を書かない**。`docs/manual/style.json` の `banned` に挙げた語（`store` / `zustand` / `IPC` / `Worker` / `props` / `React` / `TypeScript` / `Vitest` / `Playwright` / `testid` / `frameloop` / `asar` / `renderer` / `ネットリスト` / `コンポーネント` / `レンダラ` / `シリアライズ` など）が本文に0件 | `manual-style.test.ts` |
| 3 | 禁止語の免除は `10-authoring.md` だけ。そこでも免除するのは `JSON` と課題ファイルの項目名（`formatVersion` など）に限る | 同上（`style.json` の `allow`） |
| 4 | **専門用語の初出**（`terms.json` に挙げた語）は `**用語**（やさしい説明）` の形で書き、説明は15文字以上 | 同上 |
| 5 | `terms.json` の語はすべて用語集の表に載せ、説明は20文字以上 | 同上 |
| 6 | 操作は**画面に出ている言葉をそのまま**書く（「『判定』を押します」。内部の呼び名では書かない） | `manual-coverage.test.ts`（`coverage.json` の `label` が節の本文に出ること） |
| 7 | 各モードは**番号付きの手順**で最初から最後まで通す。画面が変わるところに図を1枚入れる | `manual-coverage.test.ts`（手順の節が番号付きリストを持つこと） |
| 8 | アプリが出すメッセージは**そのままの文言**で「こう表示されたら」に載せ、どうすればよいかを書く | `manual-coverage.test.ts`（`messages` の全キー） |
| 9 | 図は `![説明](images/xxx.png)` で入れる。説明（alt）は図の中身を文で書き、**画面に出ている言葉をそのまま**含める | `manual-images.test.ts`（参照した画像が実在すること／alt に `shots.json` の `caption` が含まれること） |
| 10 | 吹き出しのある図は、**本文がその番号で場所を指す**（「①の『判定』を押します」）。`shots.json` の `callouts` の番号と `label` が、その図を載せた節の本文に出ていなければならない | `manual-images.test.ts` |
| 11 | 画面を直したら**図を撮り直す**。リリース手順チェックリストの1項目にする | `docs/releases/v1.0.0.md` のチェックリスト |

### 6.3 機能一覧表（`coverage.json`）

```
{
  "controls": [
    { "testid": "judge-button", "screen": "練習中", "label": "判定", "section": "mode-b/「判定」を押す" },
    { "testid": "camera-readout", "internal": "視点の数値。試験だけが読む" }
  ],
  "keys":     [ { "key": "F1", "screen": "全画面", "action": "ヘルプを開く", "section": "screens/画面の上の帯" } ],
  "gestures": [ { "name": "ビューキューブをドラッグする", "screen": "3Dビュー", "action": "盤を回す", "section": "screens/3Dの見かたと動かしかた" } ],
  "messages": [ { "key": "JA.error.banner", "section": "troubleshooting/こう表示されたら" } ]
}
```

検査（`manual-coverage.test.ts`）:

| # | 検査 |
|---|---|
| 1 | `feature-inventory.mjs` が集めた `data-testid` の集合と、`controls[].testid` の集合が**完全一致**（不足＝説明していない、余分＝消えた要素が残っている） |
| 2 | `internal` でない `controls` は `section` が実在する節を指し、その節の素の文に `label` が含まれる |
| 3 | `keys` / `gestures` は `section` が実在し、その節の素の文に `key` / `name` が含まれる |
| 4 | `messages[].key` の集合が、実物の `JA.error` / `JA.hazard` / `JA.staticCheck` / `JA.disabledReason` / `JA.routeReason` / `JA.mismatchReason` / `MSG` を辿って作った集合と**完全一致** |
| 5 | `messages` の文言（関数ならば代表の引数で呼んだ結果）が、指定した節の素の文に含まれる |

### 6.4 スクリーンショット

図は「①アプリを動かして素のPNGを撮る → ②吹き出しを描き込む → ③`docs/manual/images/` に置く」の3段で作る。①は Playwright、②は `overlayHtml()` ＋ Chromium、③が git に入る唯一の成果物である（決定表#24・#24b・#24c）。

定義は**2つのファイルに分ける**。図が何を指すか（言葉）は原稿と同時に決められるが、どこを指すか（画素の位置）は実際に撮ってみないと決められないためである。

`docs/manual/shots.json`（**意味**。原稿を書く段階で決まる）:

```
{
  "home": {
    "caption": "ホームの画面",
    "callouts": [
      { "n": 1, "label": "回路組立" },
      { "n": 2, "label": "設定" },
      { "n": 3, "label": "ヘルプ" }
    ]
  }
}
```

`docs/manual/shot-geometry.json`（**場所**。実際に撮ってから決める）:

```
{
  "home": {
    "callouts": { "1": { "x": 328, "y": 176, "w": 300, "h": 120 },
                  "2": { "x": 1084, "y": 24, "w": 120, "h": 40 },
                  "3": { "x": 948, "y": 24, "w": 120, "h": 40 } }
  },
  "session-board": {
    "crop": { "x": 0, "y": 0, "w": 1024, "h": 640 },
    "callouts": { "1": { "x": 8, "y": 8, "w": 1008, "h": 44 } }
  }
}
```

`crop` を書いた図は、その範囲だけを切り出して仕上げる。位置は**切り出す前の**画面の座標で書き、切り出しは最後に効く。

| ファイル | 中身 | 吹き出しが指すもの |
|---|---|---|
| `home.png` | ホーム | ①練習のカード ②「設定」 ③「ヘルプ」 |
| `list.png` | 課題一覧 | ①級で絞る欄 ②課題の行 ③「もどる」 |
| `session-board.png` | モードB の練習画面 | ①上の帯 ②手順 ③3Dの画面 ④右の欄 ⑤下の欄 |
| `session-terminal.png` | 端子にさわったときの札 | ①札 ②端子の番号 |
| `view-cube.png` | ビューキューブ | ①「ビューキューブ」 ②「全体表示」 ③「傾きを戻す」 ④「視点操作の早見表」 |
| `socket-card.png` | ソケットの部品カード | ①「装着」 ②「取り外す」 ③「交換…」 |
| `judge-result.png` | 結果の画面 | ①「差分一覧」 ②「静的チェック」 ③「危険操作」 ④「所要時間」 ⑤合否 |
| `timechart.png` | タイムチャートの拡大 | ①信号の名前 ②縦の合わせ線 ③「期待（模範）」 |
| `c1-tester.png` | C1 のテスターとチェック用ソケット | ①測定モード ②レンジ ③黒プローブ ④赤プローブ |
| `c1-marksheet.png` | C1 のマークシート | ①マークシート ②不良原因の列 ③解答済み |
| `c2-repair.png` | C2 の指摘欄と連動ハイライト | ①「指摘」 ②故障の種別を選ぶ窓 ③指摘一覧 ④光っている端子 |
| `plc-ladder.png` | モードD のラダー編集 | ①手順 ②「変換」 ③「書込み」 ④「モニタ開始」 ⑤「判定」 |
| `plc-monitor.png` | モードD のモニタ | ①「モニタ開始」 ②「RUN」 ③「デバイス初期化」 ④「スキャン回数」 ⑤通電の色 |
| `plc-notation.png` | 表記の切替 | ①「表記切替」 ②デバイスの書き方の一覧 ③「この表記に切り替える」 |
| `schematic-editor.png` | 回路図エディタと検算 | ①パレット ②「段を追加」 ③「段を削除」 ④「全部消す」 ⑤検算の結果 |
| `settings.png` | 設定 | ①利用者課題フォルダ ②効果音 ③既定メーカー |
| `help-drawer.png` | ヘルプの引き出し | ①言葉で探す ②もくじ ③「説明書（PDF）を開く」 ④「閉じる」 |

すべて PNG、**原寸は1枚 300KB 以下**、寸法は 1280×800（`shots.json` に `crop` のある図はその寸法）、`docs/manual/images/` 直下の合計 6MB 以下。

縮小版（`docs/manual/images/small/`）は**同じファイル名**で、**幅400px**（高さは原寸の比に合わせて切り上げ）、**1枚 80KB 以下**、フォルダ合計 1.5MB 以下。アプリ内ヘルプはこちらを出し、押されたときだけ原寸に差し替える（決定表#9）。

**すべてこのアプリの実際の画面**であり、作り絵・模式図・他社ツールの画面は1枚も含まない（§15、§17.1、決定表#24b）。

---

## 7. PDF の生成と同梱

### 7.1 HTML から PDF へ

`apps/desktop/scripts/print-manual.mjs` を `electron` で起動する。

| 項目 | 値 |
|---|---|
| ウィンドウ | `show: false`、`webPreferences: { nodeIntegration: false, contextIsolation: true, javascript: false }` |
| 読み込み | `loadFile('resources/manual/manual.html')`（図は同じフォルダの `images/` を相対参照） |
| `pageSize` | `A4` |
| `margins` | `{ marginType: 'custom', top: 0.71, bottom: 0.71, left: 0.63, right: 0.63 }`（インチ。上下18mm・左右16mm） |
| `printBackground` | `true` |
| `generateDocumentOutline` | `true`（見出しからしおり） |
| 出力 | `resources/manual/manual.pdf` |

### 7.2 ビルドの順番

```
pnpm --filter @ojt/desktop dist
  1. node scripts/copy-content.mjs        課題JSONの複写（既存）
  2. node scripts/build-manual.mjs        正本から manual-content.ts / manual.html / images の複写
  3. electron scripts/print-manual.mjs    manual.html から manual.pdf
  4. node scripts/build.mjs               electron-vite のビルド
  5. electron-builder --config …          NSIS ＋ ポータブル
  6. node scripts/check-dist.mjs          配布物の検査（Plan 5 Task 14 ＋ 本フェーズの3点）
```

`build` の前にも 2 を走らせる（`prebuild`）。3 は `dist` のときだけ走らせる（開発中に毎回 Electron を起動して PDF を焼くのは重い）。

### 7.2b 図を画面に取り込む（決定表#9）

アプリ内ヘルプが図を出すので、**図は renderer の束ねに入る**。`docs/manual/images/` は `apps/desktop` の外にあるため、`electron.vite.config.ts` の renderer に別名と読み取り許可を1つずつ足す。

```ts
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve(import.meta.dirname, 'src/shared'),
        // 取扱説明書の図（`manual-content.ts` が読み込む）。取扱説明書 設計 §7.2b
        '@manual-images': resolve(import.meta.dirname, '../../docs/manual/images'),
      },
    },
    // 開発サーバがリポジトリの外を読まない設定になっているので、根を明示する
    server: { fs: { allow: [resolve(import.meta.dirname, '../..')] } },
    …
  },
```

`manual-content.ts`（生成物）が `import small_home from '@manual-images/small/home.png'` の形で読み込み、`MANUAL_IMAGES` にまとめる。束ねた結果の URL は Vite が決めるので、原稿にも生成物の HTML にも `src` は書かない（§4.2 の規則5）。

配布サイズへの影響: 縮小版17枚（1枚 80KB 以下 ≒ 1.3MB）と原寸17枚（1枚 300KB 以下 ≒ 5.1MB）の両方が asar に入る。**実測では 2〜3MB、上限でも 6.4MB** の増加である。§15 の配布方針（自動更新なし・オフライン）には影響しない。

### 7.3 同梱と検査

`electron-builder.yml`:

```yaml
extraResources:
  - from: resources/content
    to: content
  - from: resources/manual/manual.pdf
    to: manual.pdf
```

`check-dist.mjs` に足す3点は決定表#27 のとおり。

---

## 8. IPC の8本目（§4.3 からの意図的な差分）

| 項目 | 内容 |
|---|---|
| チャネル | `manual:open`（`IPC_CHANNELS.manualOpen`） |
| 引数 | **無し** |
| 戻り | `{ ok: true; path: string }` または `{ ok: false; message: string }` |
| main 側 | `src/main/manual.ts` の `openManual()`。`manualPdfPath()` が配布版なら `join(process.resourcesPath, 'manual.pdf')`、開発中なら `resolve(app.getAppPath(), 'resources', 'manual', 'manual.pdf')` を返す。無ければ `{ ok: false }`、あれば `shell.openPath()`（戻りの文字列が空なら成功） |
| preload | `openManual: () => ipcRenderer.invoke(IPC_CHANNELS.manualOpen)` |

§4.3 は「6本のみ」と書き、Phase 4 で `file:saveText` を足して7本になった（Plan 4B の意図的な差分#1）。本フェーズは**8本目**を足す。理由と安全性:

1. renderer からは OS のビューアを起動できない（`contextIsolation: true`、`shell` は main にしかない）。
2. 既存の7本のどれにも意味の上で載せられない。`file:saveText` は保存ダイアログを開いて**書く**チャネルで、**読んで開く**とは逆向きである。`settings:get` の戻りに載せる（`AppSettingsResponse.warning` の前例）ことも考えたが、「設定を読む」副作用としてビューアが起動するのは説明がつかない。
3. **引数を1つも取らない**ので、renderer から任意のパスを開かせる余地が型の上で無い。開く対象は main が組み立てた固定の1ファイルだけである。

---

## 9. エラー処理（§13）

| 事象 | 振る舞い |
|---|---|
| `manual.pdf` が無い | 「説明書（PDF）が見つかりません。この画面のもくじから同じ内容を読めます。」をトーストで出す。ヘルプは開いたまま（決定表#8） |
| `shell.openPath()` が失敗した（関連付けが無い等） | 「説明書（PDF）を開けませんでした: <理由>」をトーストで出す |
| preload が無い（素のブラウザ・設定ミス） | ボタンは出すが、押すと上と同じ「見つかりません」を出す。既存の `tryOjtApi()` と同じ流儀で例外にしない |
| 検索が0件 | 「見つかりませんでした。別の言葉で探してください。」を一覧の代わりに出す |
| 節IDが見つからない（`coverage.json` の指し先が消えた等） | ヘルプは目次の最初の節を開き、テストが落ちるので配布前に必ず直る |

---

## 10. テスト戦略

| 種類 | ファイル | 何を縛るか |
|---|---|---|
| 単体 | `test/manual-build.test.ts` | 変換（見出し・節の切り出し・素の文・図の置換・重複見出しの例外） |
| 単体 | `test/manual-sync.test.ts` | 正本と生成物の一致（§4.3） |
| 単体 | `test/manual-style.test.ts` | 禁止語0件・初出の書き方・用語集の網羅 |
| 単体 | `test/manual-coverage.test.ts` | 機能一覧表の網羅（§6.3） |
| 単体 | `test/manual-appdata.test.ts` | コードが持つ表（判定表・キー割当・設定の説明文・商標注記）と説明書の一致 |
| 単体 | `test/manual-shots.test.ts` | 図の意味（`shots.json`）と原稿の対応: 原稿が参照する図が `shots.json` にあり、吹き出しの番号と `label` がその節の本文に出ていること。**画像そのものは見ない**ので、撮影より前に走る |
| 単体 | `test/annotate-shots.test.ts` | `overlayHtml()` が素のPNG・枠・丸数字・切り出しを正しく組むこと（Playwright を起動しない） |
| 単体 | `test/manual-images.test.ts` | 画像の実在・寸法（`shot-geometry.json` の `crop` と照合）・原寸 300KB 以下・**縮小版が同じ名前で揃い、幅400pxで 80KB 以下**であること・フォルダ合計・`shots.json` に無いファイルが紛れていないこと。**撮影の最後のタスクで入れる** |
| 単体 | `test/help-model.test.ts` | 画面と節の対応、検索 |
| 結合 | `test/help-drawer.test.tsx` | 引き出しの開閉・目次・検索・`Esc`・フォーカストラップ・PDFボタン |
| 結合 | `test/help-entry.test.tsx` | `F1` と各画面のボタン、モードDの `F1` の調停 |
| 結合 | `test/release-manual.test.ts` | `electron-builder.yml` の `extraResources`、`dist` の順番、`check-dist.mjs` の検査項目 |
| E2E | `e2e/help.spec.ts` | 受入基準①〜③・⑥ |
| E2E | `e2e/manual-shots.spec.ts` | スクリーンショット17枚の撮影 |

---

## 11. §16 Phase 6 の受入基準

| # | 文 |
|---|---|
| ① | どの画面でも `F1` を押すと「ヘルプ」が開き、**その画面の節**が最初に表示される（モードDのラダー編集で押しても同じ引き出しが開き、トーストは出ない） |
| ② | ヘルプの検索欄に「自己保持」と入れると該当節が一覧に出て、押すとその節へ跳ぶ |
| ③ | 「説明書（PDF）を開く」で同梱の PDF が OS の既定ビューアで開く |
| ④ | NSIS とポータブルの両方に `manual.pdf` が含まれ、`check-dist.mjs` がその存在と大きさを検査して `release/artifacts.md` に行を載せる |
| ⑤ | 取扱説明書の見出し一覧が機能一覧表（`docs/manual/coverage.json`）のすべての行を覆い、専門用語チェック（禁止語リスト）が **0件**である |
| ⑥ | アプリ内ヘルプの見出しと本文が、同梱 PDF のそれと**一字一句一致**する（`manual-sync.test.ts` が正本から作り直して比べる） |
| ⑦ | `docs/manual/images` の画像が**すべて本アプリの実際の画面**であり（`shots.json` に定義の無いファイルが1枚も無い）、説明する操作要素の上に**丸数字の吹き出しと枠**が描かれ、本文がその番号で場所を指している。原寸は1枚 **300KB 以下**で寸法が `shot-geometry.json` の指定どおり、縮小版は同じ名前で**幅400px・80KB 以下**である |
| ⑧ | アプリ内ヘルプの図が**同梱 PDF と同じ図**であり（どの節にどの図が何番目に出るかまで一致）、縮小版が本文中に出て、押す・`Enter` で**原寸**が覆いで開き、`Esc` で戻って元の図に焦点が返る |

---

## 12. 仕様からの意図的な差分

| # | 仕様の記述 | 本設計 | 理由 |
|---|---|---|---|
| 1 | §4.3「チャネルは6本のみ」（Phase 4 で7本） | **8本**にする（`manual:open`） | §8 のとおり。引数を取らない読み取り専用の1本で、代替手段が無い |
| 2 | §15「フォント・音声ファイルを同梱しない」 | PDF を1つ同梱し（5〜10MB）、図17枚の原寸と縮小版を renderer に取り込む（asar が実測 2〜3MB 増える） | §16 Phase 6 が求める成果物そのもの。図をヘルプにも出すのは利用者の決定（2026-09-20）。フォントは埋め込まず OS 標準（Yu Gothic UI / Meiryo）で組む |
| 3 | §10.6「GX Works3風 `F1` ヘルプ」 | `F1` は**このアプリのヘルプ**を開く（純正ツールのヘルプを模さない） | 純正ツールのヘルプ内容は複製できない（§17.1）。§10.6 が求めるのは「`F1` でヘルプが出ること」であり、中身は本アプリのものでよい |
| 4 | §12.1 の画面遷移（5画面） | 画面は増やさない。ヘルプは**どの画面にも重なる引き出し** | 画面を増やすと「ヘルプを見たら課題から抜けた」が起きる |
| 5 | Plan 5 決定表#18「`electron-builder.yml` と `copy-content.mjs` は触らない」 | `electron-builder.yml` に `extraResources` を**1項目だけ**足す（`copy-content.mjs` は触らない） | PDF を配布物に入れる方法が他に無い。既存の `win` / `nsis` / `files` / `asar` / `publish` は1文字も変えない |
| 6 | Plan 5 の完了条件「`apps/desktop/package.json` の依存が1つも増えていない」 | **devDependencies に `markdown-it` を1つ足す**（`dependencies` は増やさない） | 決定表#3。実行時依存・asar の中身・オフライン方針には影響しない |

---

## 13. 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-20 | 利用者の決定により、**アプリ内ヘルプにも図を出す**ことにした（決定表#9 を「出さない」から「幅400pxの縮小版を出し、押すと原寸を覆いで開く」へ）。§4.2 の規則5・§4.3 の検査5・§5.3・§6.4・§7.2b・§10・§11 の⑦⑧・§12 の差分#2 を直した。図のファイル名の並びも一致検査の対象に加え（決定表#12 ③）、説明書とヘルプの一致が本文だけでなく図にも及ぶようにした |
| 2026-09-19 | 初版。利用者の決定（アプリ内ヘルプと取扱説明書を Phase 6 として実装する／説明書は PDF でインストーラとポータブル版に同梱する／説明書とヘルプの内容は一致していること／すべての機能を使用者目線で専門用語なく詳細に解説すること）を、Markdown の正本1つから2つの生成物を作る設計と、一致・網羅・文体の自動検査に落とした |
