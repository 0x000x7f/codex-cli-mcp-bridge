# Phase 1 運用検証ログ — codex_plan read-only field test

Phase 2（diff を扱う段階）へ進む前に、`codex_plan` を実作業で5〜10回使い、
**安全性（working tree 不変）・計画品質・運用上の癖**を記録する。

## 方法

- 各実走の直前・直後に対象 workspace で `git status --porcelain` を取得し、完全一致を確認する
- 実行は `node tests/manual/jsonrpc-smoke.mjs <handoff_path>`（MCP stdio 経由、elapsed_ms 表示）
- 対象 workspace の切り替えは `CODEX_BRIDGE_WORKSPACE` で行う
- 計画品質はレビュー観点（指示逸脱・diff/コード生成の有無・具体性・誤読）で人間/PM が評価する

## 評価基準

| 評価 | 意味 |
|---|---|
| A | そのまま実装計画として使える |
| B | 一部修正すれば使える |
| C | 抽象的すぎる |
| D | 誤読・文字化け・危険な提案あり |
| E | 失敗 |

## 検証ログ

| No | Date | Target repo | Handoff | JA? | Result | elapsed | Tree clean? | Rating | Issues |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

## 観察事項

（実走後に記入）

## 復旧手順（運用 runbook）

### 認証切れ（401 / refresh_token_reused）

```text
codex logout
codex login   # ブラウザで再認証
codex login status
```

bridge は認証情報を保持しないため、bridge 側の操作は不要。

### 全モデルが 400 "model is not supported when using Codex with a ChatGPT account"

プランの問題に見えるが、**古いクライアントがバックエンドに拒否されている**ことがある（0.118.0 で実証）。

```text
npm install -g @openai/codex@latest
codex --version
```

それでも解消しない場合のみ、プラン（Codex 利用権の有無）と `CODEX_BRIDGE_MODEL` を疑う。

### タイムアウト

`CODEX_BRIDGE_TIMEOUT_MS`（既定 300000）を調整。タイムアウト時はプロセスツリーが
強制終了され、working tree は変更されない（検証済み）。

## Phase 2 着手ゲート（チェックリスト）

- [ ] codex_plan 実走 5件以上
- [ ] すべての実走で working tree 変更ゼロ
- [ ] tools/list に codex_plan 以外が出ていない
- [ ] 日本語 HANDOFF の問題が許容範囲か、英語推奨などの運用方針が決まっている
- [ ] エラー時に原因が読める
- [ ] 認証切れ・古いクライアント問題の復旧手順が docs に書かれている（本書）
- [ ] A/B 評価が概ね7割以上、D/E が重大でない
