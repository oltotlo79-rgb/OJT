# ラダースキンの出典（Plan 4B §17.1）

`apps/desktop/src/renderer/ladder/skins/*.ts` が各メーカーの編集画面の**形と配置**を決める
ときに調べた資料の一覧（2026-09-20 に確認）。

- **画像・図記号ビットマップ・画面キャプチャは一切複製していない。** 取ったのは
  「接点は縦棒2本」「命令はボックス」のような**記述**だけである。
- 各スキンのコメントは、この表の番号を `出典: docs/reference/ladder-skin-sources.md #n`
  の形で指す。URL をソースコードに書かないのは、アプリが完全オフライン（外部へ1件も通信
  しない）であることを grep で確かめられるようにするため（Plan 4B の grep ゲート）。
- 資料と食い違うところは各スキンのコメントに `△` を付けて残してある。

| # | メーカー | 資料 | URL |
|---:|---|---|---|
| 1 | ジェイテクト | 公式 PCwin カタログ CAT-M2067-1 | `https://www.jtekt.co.jp/data/Tp/Catalog/CAT-M2067-1_PCwin.pdf` |
| 2 | 三菱電機 | e-sysnet「PLC入門」第6回（利用者が指定した参照元） | `https://e-sysnet.com/plc-6/` |
| 3 | 三菱電機 | e-sysnet「PLC入門」第7回 | `https://e-sysnet.com/plc-7/` |
| 4 | 三菱電機 | control-career「ラダー命令」 | `https://control-career.com/ladder-command/` |
| 5 | オムロン | 公式 CX-Programmer 操作マニュアル W446 | `https://files.omron.eu/downloads/manual/en/v2/w446_cx-programmer_operation_manual_en.pdf` |
| 6 | オムロン | plckouza「ST2-8」 | `https://plckouza.com/st2/st2_8.html` |
| 7 | シャープ | 公式 JW300 ラダー命令マニュアル | `https://jp.sharp/sms/pdf/plc/jw300/m_jw300l_5.pdf` |

## 各資料から取った内容

1. **ジェイテクト PCwin カタログ（#1）** — 接点は縦棒2本・b接点は斜線1本／**コイルは丸
   「○」**（括弧ではない。利用者の「出力は丸」と一致）／OR分岐は主ラインの**下の行**に
   置いて縦棒で合流／デバイス名は記号の**左上**／ステップ番号は左バスバーのすぐ左
   （例 `00049`）。
2. **e-sysnet 第6回（#2）** — 左右の母線・接点は縦棒2本・b接点は斜線1本・上から下への
   スキャン順。
3. **e-sysnet 第7回（#3）** — `END` はプログラム末尾に必須、コイルの後ろに接点を置けない。
4. **control-career（#4）** — タイマ・カウンタは `OUT T0` ＋ `T0 K300`。
5. **OMRON W446（#5）** — 左バスバーの**左側**にラング番号とステップ番号／各セルの接続点に
   グリッド／`TIM`・`CNT`・`MOV` は**オペランドボックス**（命令枠）に入る／コイルは右
   バスバーに整列／シンボル名とコメントは記号の上または下（設定）／通電中の要素は**太線**
   （色は原文に明記なし）／`END` は末尾に固定のセクション。
6. **plckouza（#6）** — 薄い罫線でセルに区切られた編集画面。
7. **シャープ JW300（#7）** — `F-40` ＝ `END` で各プログラムブロックの最終アドレスに入る／
   デバイス番号は6桁（8進表記、0〜7）／タイマ `T00000`〜`T17777`・カウンタ `C00000`〜
   `C17777`／基本命令は `STR` `STR NOT` `AND` `AND NOT` `OR` `OR NOT` `OUT`、追加命令に
   `STR POS` `STR NEG` など。
