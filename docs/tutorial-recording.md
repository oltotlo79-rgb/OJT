# 解答操作動画の再収録

ホームと各課題の動画は、実際のElectron画面を操作して収録する。解答をストアへ注入して合格画面だけを作る方法は使わない。

## 収録する内容

| シナリオ名 | 課題 | 確認する内容 |
|---|---|---|
| assembly | B-001 | タイムチャート、部品のドラッグ、自己保持配線、不合格からの修正と合格 |
| parts | C1-001 | コイル抵抗、励磁前後の接点、早すぎる正常判断の訂正、4部品の解答と合格 |
| repair | C2-001 | 抵抗と電圧による切り分け（3D図のプローブと端子名の札）、断線を3D図の電線から指摘し、電線一覧からも同じ小窓が開くことを確認、未配線を端子から指摘、修復と合格 |
| plc | D-001（三菱 FX5U / GX Works3風） | 仕様のタイムチャートの拡大、ラダー入力（F5〜F7・8進の誤入力の訂正・F4変換）、電源とI/Oの配線、実動作、合格 |
| plc-jtekt | D-001（JTEKT PC10G / PCwin風） | デバイス表記（1X000・1Y010）、記号ボタンでの入力、ICOM0・COM0を含む配線、合格 |
| plc-omron | D-001（OMRON CP1E / CX-Programmer風） | デバイス表記（0.00・100.00）、C・/・W・O・Rキーとコメント欄、L1・L2/N・COMを含む配線、合格 |
| plc-sharp | D-001（シャープ JW300 / JW-300SP風） | 8進6桁の番号（000000・000020）、記号を先に置いてEnterで番号を入れる操作、COM.A・COM.Cを含む配線、合格 |

PLCはメーカーごとに1本ずつ収録する（2026-09-26 利用者指示「他メーカーのPLCでも同様にチュートリアルの動画を作成して（他メーカーのシーケンサーでは配線も変わるため）」）。`plc-<メーカー>` は既定メーカーを設定に入れて起動するので、課題はそのメーカーの機種で開く。端子名は `plcWiringPlan()`、デバイスの綴りは方言の `formatDevice()` から取り、台本に書き写さない。アプリの動画画面は、いま使っているメーカーの動画を開き、画面の上でほかのメーカーへ切り替えられる。

マウスポインター、クリック位置の円、操作理由の吹き出しを同じ画面に表示する。マウス移動は補間し、クリック・ドラッグ・説明を読む時間を含める。音声は収録しない。

## 実行

リポジトリのルートで、依存関係を導入したNode 22〜25環境を使う。TypeScriptを直接実行できるNodeの版が必要。

```powershell
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop exec jiti scripts/record-tutorials.mjs assembly
pnpm --filter @ojt/desktop exec jiti scripts/record-tutorials.mjs parts
pnpm --filter @ojt/desktop exec jiti scripts/record-tutorials.mjs repair
pnpm --filter @ojt/desktop exec jiti scripts/record-tutorials.mjs plc
pnpm --filter @ojt/desktop exec jiti scripts/record-tutorials.mjs plc-jtekt
pnpm --filter @ojt/desktop exec jiti scripts/record-tutorials.mjs plc-omron
pnpm --filter @ojt/desktop exec jiti scripts/record-tutorials.mjs plc-sharp
```

7本を順番に実行する（同時に走らせない）。スクリプトは `e2e/projection.ts` を読み込むので、TypeScriptをそのまま読める `jiti` で実行する。収録先はGitの共通管理ディレクトリから決めた `OJT/release/verification/v1.7.0/tutorials/`。worktreeで実行してもOJTの外へ作業フォルダを作らない。

`OJT_TUTORIAL_DRY=1` は、動画を作らず操作手順だけを短時間で確認する設定。通常収録の前に解除する。通常収録が成功すると `apps/desktop/src/renderer/public/tutorials/<シナリオ名>.webm` を更新する。

## ウィンドウが隠れている間の収録

収録スクリプトが `OJT_RECORDING=1` を渡す。mainは、この起動だけ `backgroundThrottling: false` と背景・遮蔽時の抑制解除を設定する。スクリプトは別の不透明なウィンドウを前面に置き、その下の対象画面を最後まで操作する。

デスクトップ全体の画面録画ではなく、対象ページの映像を収録する。ほかのウィンドウの内容は動画に入らない。収録中にPCをスリープさせないこと。スリープ中も収録できるという検証は行っていない。

## 字幕・メタデータと検査

FFmpegを利用できるようにし、必要なら `OJT_FFMPEG` に実行ファイルの絶対パスを設定する。

```powershell
pnpm --filter @ojt/desktop exec node scripts/finalize-tutorials.mjs
# 一部だけ撮り直したとき（ほかの動画の目録の行は残る）
pnpm --filter @ojt/desktop exec node scripts/finalize-tutorials.mjs <収録先> plc-omron
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop exec playwright test --project=default review-tools.spec.ts
```

finalizeは合格・画面エラーなし・遮蔽状態・背景抑制解除を収録ログで確認し、VTT、catalog、各動画の途中と合格画面の検証用フレームを生成する。動画本体の速度やフレームは変更しない。

動画1本の長さは5分（305秒）未満にする（`e2e/tutorial-checks.ts`）。超えた動画は、元動画を保管したうえで、FFmpegの `-itsscale <1/倍率> -c copy` で速め、対応する `<シナリオ名>-notes.json` の `playbackSpeed` に倍率を書いてからfinalizeを実行する（v1.5.0のPLC動画は約1.3倍速）。再収録直後はこの値がなく、通常速度として扱われる。再調整する場合は字幕も必ず再生成する。

最後に、7本の内容・吹き出しの可読性・合格画面を目視し、配布EXEでも再生、シーク、速度、字幕、PLCのメーカー切替を確認する。収録の成功だけで配布動画の検証を完了としない。
