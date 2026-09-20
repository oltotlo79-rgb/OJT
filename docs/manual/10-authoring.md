# 指導者向け: 課題の作り方と配り方

## 課題ファイルの置き場所

課題は1題につき1つのファイルです。設定の「利用者課題フォルダ」に指定したフォルダの下に、練習の種類ごとのフォルダ（`assemble` / `inspect-parts` / `inspect-repair` / `plc`）を作り、その中に置きます。

何も指定しないときの既定の置き場所は `%APPDATA%\電気教育ツール\content` です。この下に上の4つのフォルダを作り、練習の種類に合ったフォルダへ課題ファイルを置きます。ファイル名は自由に付けられますが、拡張子は `.json` にしてください。置いたら課題一覧の画面を開き直すと読み込まれます（アプリを再起動する必要はありません）。

## 課題ファイルの中身

課題ファイルは JSON という形式のテキストです。メモ帳でも書けますが、かっこの対応を間違えやすいので、対応を色で見せてくれる編集ソフトを使うと楽です。

どの練習の種類でも共通して持つ項目は次のとおりです。

| 項目 | 意味 |
|---|---|
| `formatVersion` | 形式のバージョン。いまは `1` にします |
| `id` | 課題ID。英小文字・数字・ハイフンだけで、フォルダの中で一意にします |
| `mode` | 練習の種類。`assemble` / `inspect-parts` / `inspect-repair` / `plc` のどれか |
| `title` | 課題一覧に出る課題名 |
| `grade` | 想定級（1・2・3のどれか）。ヒントの出し方が変わります |
| `difficulty` | 同じ級の中での難しさ。1（やさしい）〜5（難しい）。書かなければ 3 になります |
| `tags` | 学習のねらい。下の表の言葉から6つまで選んで並べます。書かなければ空になります |
| `description` | 訓練者に示す課題文 |
| `timeLimit` | 標準時間・打切時間（分）。`{ "standardMin": 30, "cutoffMin": 50 }` のように書きます |
| `board` | 使う盤とソケットの役割割当（`boardId` / `socketRoles` / `extraParts`） |
| `inventory` | 訓練者が使える部品の在庫。種別ごとの個数を並べます |

`tags` に書ける言葉は次の14です。課題一覧で「タイマの練習だけ集めたい」というときの絞り込みに使います。

| 書く言葉 | 意味 | 書く言葉 | 意味 |
|---|---|---|---|
| `self-hold` | 自己保持 | `and-or` | 接点の直列・並列 |
| `interlock` | インタロック | `alarm` | 警報・ブザー |
| `timer` | タイマ | `flicker` | 点滅 |
| `multi-timer` | 多段のタイマ | `fault-wire` | 電線の故障 |
| `counter` | カウンタ | `fault-part` | 部品の故障 |
| `priority` | 優先（先行・後行・停止） | `fault-contact` | 接触不良 |
| `sequence` | 順次の動作 | `measure` | 測って切り分ける |

級と難しさは役割が違います。級は検定の形式（回路図を見せるかどうかなど）で、難しさは**同じ級の中での出す順**です。3級の中にもやさしい題とそうでない題があるので、出す順を決めたいときは難しさで並べます。

このほかに、練習の種類ごとに `schematic`（模範回路）・`operations`（判定で再生する操作列）・`durationMs`（判定区間の長さ）・`judge`（判定の設定）・`hints`（ヒント表示）・`parts`（部品点検のトレイ）・`faults`（故障）・`plc`（PLCのメーカーと機種）・`io`（I/O割付）・`referenceLadder`（模範ラダー図）などが加わります。詳しくは次の節以降で説明します。

書き方が間違っていると、課題一覧の下にその課題の行として、理由が日本語で出ます（たとえば「級（grade）が不正です」のように、どの項目が悪いかが分かる形です）。

## モードBの課題を1つ作ってみる

次の内容をそのまま保存すると、自己保持回路の課題ができます。内蔵の `b-001` と同じ内容です。

```
{
  "formatVersion": 1,
  "id": "b-001",
  "mode": "assemble",
  "title": "自己保持回路",
  "grade": 3,
  "description": "黒押ボタン（PB1）で白ランプ（PL1）を点灯させ、離しても点灯を保持しなさい。黄押ボタン（PB2）で消灯すること。タイムチャートの始まりと終わりは論理0とする。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S5": "T1", "S6": "T2", "S7": "CHK" }
  },
  "inventory": [
    { "kind": "relay-my4n", "count": 2 },
    { "kind": "timer-h3y4", "count": 2 }
  ],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-b-001",
    "title": "自己保持回路",
    "orientation": "horizontal",
    "rungs": [
      {
        "id": "r1",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c01", "device": "PB2" },
          { "kind": "pb-a", "id": "c02", "device": "PB1" },
          { "kind": "coil", "id": "c03", "device": "CR1" }
        ]
      },
      {
        "id": "r1h",
        "from": { "rung": "r1", "node": 1 },
        "to": { "rung": "r1", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c04", "device": "CR1" }]
      },
      {
        "id": "r2",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c05", "device": "CR1" },
          { "kind": "lamp", "id": "c06", "device": "PL1" }
        ]
      }
    ]
  },
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 3000, "target": "PB2", "action": "press" },
    { "t": 3300, "target": "PB2", "action": "release" }
  ],
  "durationMs": 5000,
  "judge": {
    "tolerance": { "edgeMs": 200, "ratio": 0.1 },
    "staticChecks": {
      "wireColorRule": true,
      "terminalLimit": true,
      "unusedParts": true,
      "forbiddenCircuit": true,
      "coilPolarity": true,
      "powerSequence": true
    }
  },
  "hints": { "schematicVisible": true }
}
```

上から順に、共通の項目に続いて次のものがあります。`schematic` はお手本の回路図です。段（`rungs`）を1本ずつ並べ、それぞれの段に置く記号（`cells`）を書きます。このお手本の回路図が正解の基準になり、モードBの回路図ヒント（2級・3級）にもそのまま使われます。`operations` は「判定のときに自動で押す順番」で、`t` は判定開始からのミリ秒、`target` はどの押しボタンか、`action` は押す（`press`）か離す（`release`）かです。`durationMs` は判定区間の長さ（ミリ秒）、`judge` は比較する信号や許容差・自動チェックの設定、`hints.schematicVisible` は回路図を最初から見せるかどうかです（3級は `true`、2級・1級は `false`）。

## ほかのモードの課題

**部品点検（`inspect-parts`）**: トレイに並べる部品を `parts` に書きます。1個ごとに `id`・`kind`（`relay-my4n` か `timer-h3y4`）・`truth`（本当のこわれ方）を書き、正常（`normal`）と6種類の不良（コイル断線・レアショート・a接点の開き・a接点の溶着・b接点の開き・b接点の溶着）を混ぜます。タイマにレアショート（`coil-layer-short`）は指定できません（リレーだけに出題できます）。内蔵の `c1-001` は次のとおりです。

```
{
  "formatVersion": 1,
  "id": "c1-001",
  "mode": "inspect-parts",
  "title": "リレーの点検①（コイルと接点）",
  "grade": 2,
  "description": "トレイのリレー4個を1個ずつチェック用ソケットに挿し、赤押ボタン（PB4）で励磁して良否を判定しなさい。手順は ①励磁して吸引するか ②励磁ON/OFFでのa接点・b接点の導通 ③コイル抵抗の測定（正常は約650Ω）の3つである。判定できたらマークシートに原因を1つだけ選ぶこと。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": { "boardId": "board-jipm-std", "socketRoles": { "S7": "CHK" } },
  "inventory": [],
  "parts": [
    { "id": "p1", "kind": "relay-my4n", "truth": "normal" },
    { "id": "p2", "kind": "relay-my4n", "truth": "coil-open" },
    { "id": "p3", "kind": "relay-my4n", "truth": "a-open", "group": 2 },
    { "id": "p4", "kind": "relay-my4n", "truth": "normal" }
  ],
  "seed": 20260101
}
```

**回路点検・修復（`inspect-repair`）**: 形はモードBと同じ（`schematic` ＋ `operations` ＋ `judge`）で、`faults`（どこをどうこわすか）が加わります。`faults` は、故障を1件ずつ並べる書き方（電線の断線・未配線・誤配線、部品の接点の開き・溶着・抵抗増加、コイル断線・レアショート、ランプ切れ）と、数だけ決めて毎回変える書き方（`{ "random": { "count": ..., "types": [...] } }`）のどちらかで書けます。1級・2級だけの練習で、3級形式はありません。内蔵の `c2-001` は次のとおりです。

```
{
  "formatVersion": 1,
  "id": "c2-001",
  "mode": "inspect-repair",
  "title": "自己保持回路の点検・修復①",
  "grade": 2,
  "description": "黒押ボタン（PB1）で白ランプ（PL1）が点灯し自己保持、黄押ボタン（PB2）で消灯する回路である。現在は正しく動作しない。回路図とタイムチャートを手がかりに故障箇所を2つ指摘し、白線で修復しなさい。故障箇所でない青線を外してはならない。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S5": "T1", "S6": "T2", "S7": "CHK" }
  },
  "inventory": [
    { "kind": "relay-my4n", "count": 2 },
    { "kind": "timer-h3y4", "count": 2 }
  ],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-c2-001",
    "title": "自己保持回路",
    "orientation": "horizontal",
    "rungs": [
      {
        "id": "r1",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c01", "device": "PB2" },
          { "kind": "pb-a", "id": "c02", "device": "PB1" },
          { "kind": "coil", "id": "c03", "device": "CR1" }
        ]
      },
      {
        "id": "r1h",
        "from": { "rung": "r1", "node": 1 },
        "to": { "rung": "r1", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c04", "device": "CR1" }]
      },
      {
        "id": "r2",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c05", "device": "CR1" },
          { "kind": "lamp", "id": "c06", "device": "PL1" }
        ]
      }
    ]
  },
  "faults": [
    { "target": { "wireId": "sw-005" }, "kind": "wire-open" },
    { "target": { "wireId": "sw-009" }, "kind": "wire-missing" }
  ],
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 3000, "target": "PB2", "action": "press" },
    { "t": 3300, "target": "PB2", "action": "release" }
  ],
  "durationMs": 5000,
  "judge": {
    "tolerance": { "edgeMs": 200, "ratio": 0.1 },
    "staticChecks": {
      "wireColorRule": true,
      "terminalLimit": true,
      "unusedParts": true,
      "forbiddenCircuit": true,
      "coilPolarity": true,
      "powerSequence": true
    }
  },
  "hints": { "schematicVisible": true }
}
```

**PLC（`plc`）**: `plc` にメーカー（`vendor`）と機種（`model`）を組で書きます（三菱なら `FX5U`、オムロンなら `CP1E`、ジェイテクトなら `PC10G-1SP`、シャープなら `JW-300`）。`io` に入出力の割り付け（決まっている課題は `"mode": "fixed"` で `inputs` / `outputs` も書く、自由な課題は `"mode": "free"`）を、`referenceLadder` にお手本のラダー図を書きます。3級の課題はありません。内蔵の `d-001` は次のとおりです。

```
{
  "formatVersion": 1,
  "id": "d-001",
  "mode": "plc",
  "title": "PLC 自己保持回路（2級形式）",
  "grade": 2,
  "description": "黒（X0）で運転を開始し、黄（X1）で停止する自己保持回路をPLCで組みます。運転中は白ランプ（PL1）が点灯します。黄（X1）を押している間、運転していなければ黄ランプ（PL2）が点灯し（停止確認）、緑（X2）を押している間だけ緑ランプ（PL3）が点灯します。PLCの出力は必ず盤のリレーを介し、PLCの電源は壁コンセントから取ってください。",
  "timeLimit": { "standardMin": 50, "cutoffMin": 60 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S3": "CR3", "S4": "CR4", "S7": "CHK" }
  },
  "inventory": [{ "kind": "relay-my4n", "count": 4 }],
  "plc": { "vendor": "mitsubishi", "model": "FX5U" },
  "io": {
    "mode": "fixed",
    "wiring": "sink",
    "inputs": [
      { "x": 0, "pb": "PB1" },
      { "x": 1, "pb": "PB2" },
      { "x": 2, "pb": "PB3" }
    ],
    "outputs": [
      { "y": 0, "cr": "CR1", "pl": "PL1" },
      { "y": 1, "cr": "CR2", "pl": "PL2" },
      { "y": 2, "cr": "CR3", "pl": "PL3" }
    ]
  },
  "referenceLadder": {
    "networks": [
      {
        "id": "n1",
        "comment": "自己保持（X0で入り、X1で切れる）",
        "cells": [
          [
            { "kind": "contact", "type": "NO", "device": { "kind": "input", "index": 0 } },
            { "kind": "vline" },
            { "kind": "contact", "type": "NC", "device": { "kind": "input", "index": 1 } },
            { "kind": "coil", "type": "OUT", "device": { "kind": "output", "index": 0 } }
          ],
          [{ "kind": "contact", "type": "NO", "device": { "kind": "output", "index": 0 } }]
        ]
      },
      {
        "id": "n2",
        "comment": "停止確認表示（停止ボタンを押していて運転中でないとき）",
        "cells": [
          [
            { "kind": "contact", "type": "NC", "device": { "kind": "output", "index": 0 } },
            { "kind": "contact", "type": "NO", "device": { "kind": "input", "index": 1 } },
            { "kind": "coil", "type": "OUT", "device": { "kind": "output", "index": 1 } }
          ]
        ]
      },
      {
        "id": "n3",
        "comment": "点検灯（押している間だけ）",
        "cells": [
          [
            { "kind": "contact", "type": "NO", "device": { "kind": "input", "index": 2 } },
            { "kind": "coil", "type": "OUT", "device": { "kind": "output", "index": 2 } }
          ]
        ]
      },
      { "id": "end", "cells": [[{ "kind": "end" }]] }
    ],
    "comments": {
      "X0": "運転押ボタン（黒）",
      "X1": "停止押ボタン（黄）",
      "X2": "点検押ボタン（緑）",
      "Y0": "運転表示灯 PL1",
      "Y1": "停止確認灯 PL2",
      "Y2": "点検表示灯 PL3"
    }
  },
  "wiringRequired": true,
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 2000, "target": "PB3", "action": "press" },
    { "t": 2300, "target": "PB3", "action": "release" },
    { "t": 4000, "target": "PB2", "action": "press" },
    { "t": 4300, "target": "PB2", "action": "release" }
  ],
  "durationMs": 6000,
  "judge": { "compareSignals": ["PL1", "PL2", "PL3"] }
}
```

どのモードでも、アプリを入れたところの `resources/content/` の中に同梱課題の実体があります（`assemble` に20題、`inspect-parts` に12題、`inspect-repair` に8題、`plc` に8題）。似た課題を作りたいときは、その中の1つを設定の「利用者課題フォルダ」にコピーして書き換えるのが早道です。

## 作った課題を確かめる

課題ファイルを置いて課題一覧を開き直せば、書き方の間違いはその場で日本語で出ます。ただし「書き方は合っているのに、お手本の回路が課題文どおりに動かない」という間違いは、実際に解いてみるまで分かりません。作った課題をまとめて確かめたいときは、確認の道具を使います。

アプリを作るための一式（配布物ではなく、開発用のファイル一式）を置いたフォルダで、次のように打ちます。渡すのは課題ファイル1つでも、課題ファイルの入ったフォルダでもかまいません。フォルダを渡すと、その下の階層まで全部見ます。

```
pnpm --filter @ojt/content validate "C:\Users\（利用者名）\AppData\Roaming\電気教育ツール\content"
```

確認の道具は、課題1件につき次の3つを見ます。

1. 書き方（項目の過不足・値の範囲）が正しいか。
2. お手本の回路を、その課題自身の操作の並びで動かしたときに合格になるか。タイマの設定時間が実物のタイマで出せる値かどうかもここで見ます。部品点検の課題では、トレイの各部品が判定表どおりの読みになるかを見ます。
3. タイムチャートの始まりと終わりがどちらも消えている状態か。

出るのは課題1件につき1行です。問題がなければ行の頭が「合格」になり、級・難しさ・ねらいが続きます。問題があれば行の頭が「問題」になり、そのあとに理由が日本語で並びます。最後の行に「0 件の問題」と出れば全部よし、「3 件の問題」と出れば3題に直すところがあるという意味です。

```
合格  b-001.json（b-001）  3級・難しさ1・self-hold
問題  b-009.json（b-009）  課題の形式が正しくありません / difficulty: 5以下にします
0 件の問題
```

## 採点のしくみ

合格になるのは、お手本と同じ動きになっていて、なおかつ自動で見つかる間違いが1つも無いときです。かかった時間とあぶない操作の回数は、点数には入れず、参考として出します。

自動で見つかる間違いは9種類あります。線色ルール・1端子の本数・未使用部品・禁則回路・コイル極性・電源操作手順の6つはどのモードでも見られ、二段構成・PLC電源の独立・I/O割付の3つはPLC（モードD）だけで見られます。それぞれ課題ごとに `judge.staticChecks` で入り切りできます。

時間のずれをどこまで許すかは `judge.tolerance` で決めます。`edgeMs` は信号が変わるタイミングのずれの許容（ミリ秒）、`ratio` は割合での許容です。

部分点は出ません。合格か不合格かの2つだけです。部品点検（モードC1）だけは「2 / 6 正解」のように、当てた部品の数が結果の画面に出ます。

## 配り方と更新のしかた

課題ファイルだけを配ればよく、アプリを入れ直す必要はありません。

共有フォルダを全員の「利用者課題フォルダ」に指定すれば、同じ課題を全員に配れます。共有フォルダの中の課題ファイルを書き換えれば、次に課題一覧を開いたときから新しい内容になります。

アプリそのものの更新は、新しいインストーラで入れ替えます。自動更新はありません。
