# Phase 2 運用検証ログ — codex_propose_patch field test

Phase 3（適用を伴う段階）へ進む前に、`codex_propose_patch` を実作業で使い、
**安全性（working tree 不変）・diff 品質（apply --check 通過率）・運用上の癖**を記録する。

## 方法

- Phase 1 と同じ規律: 各実走の直前・直後に対象 workspace で `git status --porcelain` を
  取得し、完全一致を確認する（**dirty tree の場合は中断して報告**）
- 実行は `node tests/manual/jsonrpc-smoke.mjs <handoff_path> propose`
- 特に記録する項目: `git apply --check` の通過/失敗（**失敗率が高ければ Strategy B
  = temp worktree 方式への移行を検討** — docs/design.md §8 の fallback）

## 評価基準

| 評価 | 意味 |
|---|---|
| A | check passed・最小差分・そのまま人間レビューに回せる |
| B | check passed・一部修正すれば使える |
| C | check passed だが差分が過剰・的外れ |
| D | 検証ゲートで拒否（フェンス違反・パス違反・上限超過・check 失敗） |
| E | 失敗（ツールエラー） |

※ D はゲートが機能した証拠でもあるため、原因（モデル起因か指示起因か）を Issues 欄に書く。

## 検証ログ

| No | Date | Target repo | Handoff | JA? | Result | elapsed | Tree clean? | apply --check | Rating | Issues |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-06-13 | bridge | HANDOFF-propose-glossary（新規ファイル作成） | no | success | 40.7s | yes | passed | A | 実装時の初回検証。context 再現が不要な新規ファイル形式 |
| 1 | 2026-06-13 | bridge | HANDOFF-propose-ja-edit（日本語ファイルの既存行変更） | yes | gate 拒否 | 44.6s | yes | **failed**（patch does not apply） | D | mojibake により日本語 context 行を再現できない（仮説どおり） |
| 2 | 2026-06-13 | bridge | HANDOFF-propose-agents-note（英語ファイルの既存行変更） | no | gate 拒否 | 29.0s | yes | **failed**（patch does not apply） | D | **英語でも失敗** — 原因は mojibake ではなく context 行の不正確な再現 |
| 3 | 2026-06-13 | bridge | HANDOFF-propose-two-files（2ファイル変更） | 混在 | gate 拒否 | 57.4s | yes | **failed**（corrupt patch） | D | hunk 構造自体が不正。複数ファイルでさらに悪化 |
| 4 | 2026-06-13 | bridge | HANDOFF-propose-delete（2行ファイルの削除） | no | success | 22.2s | yes | passed | A | 削除形式（+++ /dev/null）。2行の完全再現は可能 |
| 5 | 2026-06-13 | claude-code-agent-workflow | HANDOFF-propose-usage-gitignore-note（別repo×日本語変更） | yes | gate 拒否 | 39.5s | yes | **failed**（corrupt patch） | D | 別リポジトリでも同傾向 |
| 6 | 2026-06-13 | bridge | HANDOFF-propose-oversize（全文書英訳の過大要求） | no | gate 拒否 | 96.7s | yes | **failed**（corrupt patch） | D | サイズ上限に達する前に構造不正で拒否 |

集計: 実走7件（実装時1＋field 6）。**A: 2 / D: 5 / E: 0**。`apply --check` 通過率 **2/7 ≈ 29%**。
全件で working tree 変更ゼロ（対象が別リポジトリの場合も両側で確認）。エラーは全件原因が読める。

## 観察事項と判定

1. **成否を分けるのは「既存内容の正確な再現量」**: 新規ファイル（context 0行）と極小ファイル削除（2行）は
   成功。既存ファイルの変更（context 行＋行番号の正確な再現が必要）は**言語を問わず全滅**（4/4 失敗）
2. **mojibake は悪化要因であって主因ではない**: 英語ファイル（AGENTS.md）の変更も `patch does not apply`。
   主因は「モデルが手書きする diff の context・hunk 構造の不正確さ」という Strategy A の本質的限界
3. **安全網は完璧に機能**: 不正 diff は 7件中5件すべて `git apply --check` が捕捉し、全件 working tree
   変更ゼロ・エラー可読。「悪い diff が黙って通る」事故はゼロ
4. **判定: Phase 3 着手ゲートは不通過**（通過率 29% < 目安 70%）。
   **Strategy B（temp worktree 方式）への移行を推奨** — temp に worktree を切って Codex に実編集させ、
   bridge が `git diff` で diff を採取する方式なら context は定義上正確になる。
   設計は docs/design.md §8 の fallback として記録済み・security.md の command policy も許容済み
5. Strategy A の存続価値: 新規ファイル作成・ファイル削除の提案には引き続き有効（軽量・書き込み面ゼロ）。
   Strategy B 導入時もタスク種別による使い分け（または A 失敗時の B フォールバック）が候補

## Phase 3 着手ゲート（チェックリスト）

- [x] codex_propose_patch 実走 5件以上（日本語ファイルへの diff を含む）— 7件実施
- [x] すべての実走で working tree 変更ゼロ
- [ ] **apply --check 通過率が運用に耐える水準 — 不通過（29% < 70%）。Strategy B への移行が必要**
- [x] 拒否系のエラーが読める（patch does not apply / corrupt patch とも原因特定可能）
- [x] tools/list が codex_plan / codex_propose_patch の2つのみ
- [ ] Phase 3 の承認ゲート設計レビュー（Strategy B 導入後に実施）

**判定（2026-06-13）: Phase 3 はブロック。次のステップは Strategy B（temp worktree 方式）の
設計・実装による diff 品質の改善**（既存ファイル変更で check 通過率 70% 以上が再開条件）。
