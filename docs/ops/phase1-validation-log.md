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
| 1 | 2026-06-13 | codex-cli-mcp-bridge | HANDOFF-test.md（glossary 計画） | yes | success | 未計測 | yes | A | mojibake 指摘（後述） |
| 2 | 2026-06-13 | codex-cli-mcp-bridge | HANDOFF-test-en.md（同・英語版） | no | success | 38.7s | yes | A | mojibake 指摘は英語 HANDOFF でも出る（対象は repo 内 JA docs） |
| 3 | 2026-06-13 | claude-code-agent-workflow | HANDOFF-install-docs-update.md（実課題） | yes | success | 39.2s | yes | A | 日本語見出しを正確に引用。環境依存への文言緩和提案など質の高いリスク指摘 |
| 4 | 2026-06-13 | claude-code-agent-workflow | HANDOFF-english-overview-consistency.md（実課題） | no | success | 57.5s | yes | A | 「safety-oriented defaults はプロンプトレベル制約の過大表現の恐れ」という本質的指摘 |
| 5 | 2026-06-13 | codex-cli-mcp-bridge | HANDOFF-test-long.md（長文・9セクション） | yes | success | 57.2s | yes | A | 長文でも劣化なし。guard ログの絶対パス漏えいリスク等、セキュリティ指摘2件 |
| 6 | 2026-06-13 | codex-cli-mcp-bridge | 存在しないパス | - | guard 拒否（期待どおり） | 2ms | yes | A | 「handoff_path not found: <path>」で原因即読 |
| 7 | 2026-06-13 | codex-cli-mcp-bridge | workspace 外（`../`）＋絶対パス | - | guard 拒否（期待どおり） | 2ms | yes | A | 拒否理由が2種で出し分けられる。Codex は起動されない |
| 8 | 2026-06-13 | codex-cli-mcp-bridge | HANDOFF-phase2-plan.md（実課題: Phase 2 設計計画） | yes | success | 44.8s | yes | A | Phase 2 の核心論点（read-only での diff 生成可否・temp 分離・apply --check の非破壊性）を正確に特定 |

集計: 実走8件（Codex 実行6件＋異常系2件）。**A: 8 / B: 0 / C: 0 / D: 0 / E: 0**。
全件で working tree 変更ゼロ。全件で tools/list は `codex_plan` のみ。diff・コード生成の混入ゼロ。

## 観察事項

1. **mojibake（文字化け）認識**: Codex は本リポジトリ・対象リポジトリの日本語ドキュメントを
   「mojibake に見える」と毎回リスク欄で報告する。ただし**理解への実害は観察されなかった** —
   Run 3 では日本語見出しを正確に引用し、全実走で制約・識別子・構造を正しく抽出した。
   Codex 自身は「exact Japanese prose の復元は保証できない」と述べている
2. **運用方針（決定）**: 計画立案タスクでは**日本語 HANDOFF をそのまま許容**する（品質 A を確認）。
   ただし「日本語の文言そのものを Codex に生成・転記させる」タスク（後続 Phase で発生しうる）では
   英語 HANDOFF を推奨、または出力の日本語文言を必ず人間が検証する
3. **実行時間**: Codex 実行は 39〜58 秒（既定 timeout 300s に対し十分な余裕）。長文 HANDOFF でも
   時間・品質ともに劣化なし
4. **計画品質の傾向**: 指示（4項目構成・diff 禁止）への遵守率 100%。こちらが見落としかけた
   セキュリティ指摘（guard ログの絶対パス漏えい、raw output のエラーテキスト混入の再考）を
   複数回返しており、reviewer 的価値もある
5. **エラー品質**: guard 3種（not found / outside / absolute）はすべて 2ms で即時拒否、
   メッセージから原因が一読で分かる。認証・モデル系の失敗は error イベント伝搬（01026e9）で可読

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

- [x] codex_plan 実走 5件以上（8件: Codex 実行6＋異常系2）
- [x] すべての実走で working tree 変更ゼロ
- [x] tools/list に codex_plan 以外が出ていない（全実走で確認）
- [x] 日本語 HANDOFF の問題が許容範囲か、英語推奨などの運用方針が決まっている（観察事項2）
- [x] エラー時に原因が読める（観察事項5）
- [x] 認証切れ・古いクライアント問題の復旧手順が docs に書かれている（本書）
- [x] A/B 評価が概ね7割以上、D/E が重大でない（A 100%・D/E ゼロ）

**判定（2026-06-13）: 全ゲート通過。Phase 2 着手可。**（着手自体はユーザーの明示指示を待つ）
