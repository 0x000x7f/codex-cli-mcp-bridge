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
| | | | | | | | | | | |

## Phase 3 着手ゲート（チェックリスト・骨子）

- [ ] codex_propose_patch 実走 5件以上（日本語ファイルへの diff を含む）
- [ ] すべての実走で working tree 変更ゼロ
- [ ] apply --check 通過率が運用に耐える水準（目安 7割以上。下回るなら Strategy B を検討）
- [ ] 拒否系（フェンス違反・パス違反・上限超過）のエラーが読める
- [ ] tools/list が codex_plan / codex_propose_patch の2つのみ
- [ ] Phase 3 の承認ゲート設計（approval 厳密判定・適用前 clean tree 必須・rollback）が
      docs/security.md と整合した形でレビュー済み
