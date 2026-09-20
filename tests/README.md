# テスト

```bash
npm run dev          # 別のターミナルで動かしたまま
npm test             # 全部
npm test shelf lanes # 名前を指定して一部だけ
```

`tests/fixtures/*.pdf` は最初の実行時に Chrome で刷ります（リポジトリには入れません）。
作り直したいときは `node tests/fixtures/make.mjs --force`。

## 構成

| | |
|---|---|
| `unit/` | DOM を必要としない部分。esbuild で束ねて node で走らせます |
| `browser/` | 実際の Chrome を Playwright で動かします |

各スイートは `PASS` / `FAIL` の行を吐き、`tests/run.mjs` がそれを集計します。
コンソールエラーが1つでも出たスイートは、チェックが全部通っていても失敗扱いです。

## 注意

- **`channel: 'chrome'` を使います。** Chromium ではなく実際の Chrome です。
- **pdf.js の速度をここで測らないこと。** Playwright（CDP）は pdf.js の worker に
  接続するため、メッセージ往復が 20〜100 倍に膨らみます。描画が遅い・白紙のままに
  見えても、それは計測装置の影響です。素の Chrome で確かめてください。
- スイートは冒頭で IndexedDB を消します。前の実行が残したタグやパレットが
  次の実行の前提を狂わせるためです。
- **固定したページの上のボタンは `page.evaluate(() => el.click())` で押します。**
  Playwright はクリック前に要素を「見えるように」スクロールしますが、その要素が
  `position: sticky` のページに乗っていると、スクロール位置がレーンの先頭まで
  戻されてから押されます。読者のマウスはそんなことをしません。
- **日本語変換は CDP で作ります**（`browser/ime.mjs`）。`Input.imeSetComposition` で
  未確定の読みを置き、確定の Enter は `Input.dispatchKeyEvent` を `text` なしで
  送ります（文字は IME が食べたあとなので、`text` を付けると改行まで入ります）。
  `nativeVirtualKeyCode` は**渡さないでください**。macOS で値が合わないと
  キーリピート扱いになり、1秒で数千件の keydown が降ってきます。
  このスイートは素の textarea を対照に測ってから本体を見ます。CDP の変換は
  本物の IME と完全に同じではないので、ブラウザ自身の挙動を先に押さえておかないと、
  装置のくせをアプリの不具合と読み違えます。
- 待つときは時間ではなく条件を待ってください。固定の切り替えとリサイズは
  数フレームかけて落ち着くので、固定時間だと連続実行の負荷で落ちます。
