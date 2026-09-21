# 配布ツールの補修

`app-builder-lib@26.15.3.patch` は、固定している26.15.3のポータブル版の生成だけを補修する。

- `unpackDirName: false` が、[公式の説明](https://www.electron.build/docs/api/app-builder-lib.interface.portableoptions/#unpackdirname)どおり起動ごとの `$PLUGINSDIR/app` を使うようにする。元の条件式はfalseでもビルド単位の固定名を定義していた。
- Electronの終了直後にGPU等のプロセスが実行ファイルやDLLを解放するまで、NSISが自分の展開先の削除を250ms間隔・最大40回だけ再試行する。ほかの起動や利用者のファイルには触れない。

pnpmのpatchedDependenciesとlockfileで適用を固定する。依存を更新するときは、補修を黙って捨てず、`e2e:packaged` で起動ごとの展開先の違い・同時起動・片方を閉じた後の課題表示・全展開物の削除を実際のEXEで確認する。
