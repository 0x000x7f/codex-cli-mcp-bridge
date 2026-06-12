# HANDOFF: phase2-propose-patch-planning（実課題ハンドオフ）

> 実際に控えている Phase 2（codex_propose_patch）実装の**計画立案のみ**を依頼する実課題テスト。
> このハンドオフの成果物は計画であり、実装・stub 作成は一切行われない。

## 1. 目的

docs/design.md §3.2 に定義された `codex_propose_patch(handoff_path)` ツールの実装計画を立てる。
diff 案を返すだけで working tree への適用は行わない、という境界の実装方法が論点。

## 2. 背景・調査結果

- Phase 1 で `codex_plan`（読み取り専用）は実装・検証済み（src/ 配下）
- spawn 層は `--sandbox read-only` 固定で実装されている（src/codex/spawn.ts）
- Phase 2 では Codex に diff を**生成**させる必要があるが、**適用**はさせない
- docs/security.md の command policy では Phase 2 は「読み取り＋diff 生成
  （テンポラリ領域での作業は可、対象リポジトリへの書き込み不可）」と定義されている

## 3. 設計・方針（計画側で検討してほしい論点）

- sandbox モードの選択: read-only のままで diff をテキスト生成させるか、
  workspace-write + テンポラリ作業ディレクトリの組み合わせが必要か
- 返却 diff の検証: `git apply --check` をブリッジ側で実行するべきか（実行するなら read-only 性をどう守るか）
- diff サイズ・対象ファイル数の上限チェック（security.md 失敗モード表「過大変更」への対策）の入れ方
- codex_plan と共通化できる部分（guard / spawn / parse）と分岐する部分の整理

## 4. 対象ファイル

- 読むだけ: docs/design.md, docs/security.md, src/ 配下すべて, tests/ 配下すべて

## 5. 制約・禁止事項

- 計画立案のみ。ファイル変更・stub 追加は後続の明示指示があるまで行われない
- patch / unified diff / 貼り付け用コードの生成は禁止
- security.md の「既定は非破壊」「段階の飛び越し禁止」を弱める提案は禁止

## 6. テストコマンド

- なし（計画のみ）

## 7. 完了条件

- [ ] sandbox モード選択の比較（選択肢・利害・推奨）が示されている
- [ ] diff 検証方法の案が示されている
- [ ] 過大変更ガードの設計案が示されている
- [ ] 既存コードの再利用方針が示されている
- [ ] 実装の段階分け（PR 粒度）が示されている

## 8. レビュー方法

人間（PM）が計画を読み、Phase 2 着手判断の材料にする。
