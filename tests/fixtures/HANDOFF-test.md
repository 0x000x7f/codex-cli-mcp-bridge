# HANDOFF: glossary-section（検証用フィクスチャ）

> codex_plan の読み取り専用動作を検証するための架空タスク。実装は行われない。

## 1. 目的

docs/design.md に用語集（Glossary）セクションを追加するための実装計画を立てる。

## 2. 背景・調査結果

- docs/design.md には codex_plan / codex_propose_patch / codex_apply の3ツールが定義されている
- MCP・handoff・workspace guard・approval gate などの用語の定義がまとまった場所がない

## 3. 設計・方針

- design.md 末尾に "## Glossary" を追加する案を検討する
- 用語の選定基準: 本リポジトリの docs で2回以上使われている専門用語

## 4. 対象ファイル

- 読むだけ: docs/design.md, docs/security.md, README.md

## 5. 制約・禁止事項

- これは計画立案のみのタスク。ファイル変更は後続フェーズで行う
- patch / diff / 貼り付け用コードを生成しない

## 6. テストコマンド

- なし（ドキュメントのみ）

## 7. 完了条件

- [ ] 追加すべき用語の一覧と配置案が示されている
- [ ] リスク・未解決点が列挙されている

## 8. レビュー方法

- 人間が計画を読みレビューする
