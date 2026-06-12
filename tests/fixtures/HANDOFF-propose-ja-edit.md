# HANDOFF: propose-ja-edit（日本語ファイル変更の field test）

> 日本語ドキュメントの**既存行を context に含む diff** が `git apply --check` を
> 通過できるか（mojibake の影響）を測る実課題。提案のみで適用されない。

## 1. 目的

`docs/claude-code-setup.md` の「方法1: プロジェクトスコープ（推奨・自動）」セクションに、
`.mcp.json` 経由の起動には事前に `npm run build` が完了している必要がある旨の注記を1〜2行追加する。

## 2. 背景

- `.mcp.json` は `node dist/src/server.js` を起動するため、`dist/` が未ビルドだと失敗する
- 現在の方法1の説明にはビルド済みであることの明記がない（前提セクションにはあるが、方法1単体では読み落としやすい）

## 3. 変更要件

- 変更ファイルは `docs/claude-code-setup.md` のみ
- 方法1セクション内に日本語で1〜2行の注記を追加（既存の文体に合わせる）
- 既存行の書き換え・再整形はしない（追加のみが望ましい）

## 4. 制約

- Git 形式 unified diff・単一 ```diff フェンスで返す
- 他ファイルへの変更禁止

## 5. 完了条件

- [ ] docs/claude-code-setup.md への追加のみの diff
