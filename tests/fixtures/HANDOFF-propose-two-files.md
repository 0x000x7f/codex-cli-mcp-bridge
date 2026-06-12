# HANDOFF: propose-two-files（複数ファイル変更の field test）

> 2ファイルにまたがる diff の field test。提案のみで適用されない。

## 1. 目的

運用検証ログ（docs/ops/ 配下）への導線を2箇所に追加する:

1. `README.md` の「## ドキュメント」セクションに、
   `docs/ops/phase1-validation-log.md` と `docs/ops/phase2-validation-log.md` への
   リンク行を追加する（既存のリスト形式に合わせる）
2. `docs/claude-code-setup.md` の「## 動作確認」セクション末尾に、
   実走結果は `docs/ops/` の検証ログへ記録する旨の1行を追加する

## 2. 変更要件

- 変更ファイルは `README.md` と `docs/claude-code-setup.md` の2つのみ
- どちらも追加のみ（既存行の書き換え・再整形禁止）

## 3. 制約

- Git 形式 unified diff・単一 ```diff フェンス（2ファイル分のセクションを1つの diff に含める）

## 4. 完了条件

- [ ] 2ファイルへの追加のみの diff
