# codex-cli-mcp-bridge

> **Status**: experimental — Phases 1–2 implemented and verified (`codex_plan` read-only,
> `codex_propose_patch` diff-proposal-only; working tree unchanged before/after real runs).
> Not an official Anthropic / OpenAI project.

> **EN** — An experimental MCP server bridging Codex CLI into Claude Code,
> automating the manual Markdown-handoff workflow of
> [claude-code-agent-workflow](https://github.com/0x000x7f/claude-code-agent-workflow).
> Three staged tools isolate mutation behind an explicit approval gate:
> `codex_plan` (read-only, implemented) → `codex_propose_patch` (returns a validated Git
> unified diff, verified with `git apply --check`, never applied — implemented)
> → `codex_apply` (explicit approval required, planned).

Claude Code から Codex CLI を MCP ツールとして呼び出し、
[claude-code-agent-workflow](https://github.com/0x000x7f/claude-code-agent-workflow) の
`/handoff`（Markdown 手動運搬）を自動化するブリッジの**設計フェーズ**リポジトリ。

## なぜ作るか

- 現状: HANDOFF 文書を人間が Codex / Cursor へコピーして運搬し、戻り差分を `/review-diff` で検収している
- 目標: この運搬を MCP ツール呼び出しに置き換え、「ハンドオフ生成 → Codex 実行 → 差分検収」を1フローにする
- ただし、MCP ツール化で最も危険な**自動ファイル変更は最終 Phase まで隔離**する

## 3段階のツール設計

| ツール | Phase | できること | できないこと |
|---|---|---|---|
| `codex_plan(handoff_path)` | 1 | HANDOFF 文書を Codex に読ませ、要約と実装計画を返す | ファイル変更の一切 |
| `codex_propose_patch(handoff_path)` | 2 | 検証済み unified diff 案を返す（フェンス抽出 → Git 形式・パス guard・上限 → `git apply --check`） | working tree への適用 |
| `codex_apply(diff, approval, expected_sha256, base_head)` | 3 | レビュー済み exact diff を working tree に適用（Codex は呼ばない・hash/HEAD 束縛・clean tree 必須） | 承認なしの適用・stage・commit |

## Roadmap

- [x] Phase 0: 設計・セキュリティモデル・既存方式との比較
- [x] Phase 1: `codex_plan`（読み取り専用ツール）の実装と検証 — 実走前後で working tree 不変を確認済み
- [x] Phase 2: `codex_propose_patch`（diff 提案のみ）— 当初 Strategy A（手書き diff）で実装
- [x] Phase 2B′: Strategy B′（temp worktree ＋ bridge-applied writes）へ移行 — 既存ファイル変更の `apply --check` 通過率を 29% → 100% に改善（[field test](docs/ops/phase2-validation-log.md)）。native Windows の codex-exec 書き込みブロックを迂回
- [x] Phase 3: `codex_apply`（review-first の承認ゲート）— Codex を呼ばず、人間がレビューした exact diff のみを適用。`approval=true` ＋ diff の SHA-256 ＋ base HEAD で束縛し、clean tree 必須・適用直前に再検証・working tree のみ（stage/commit しない）。非ASCII記号の文字化けは propose の review ヒント表示＋人間レビューで吸収
- [ ] Phase 3 運用検証（propose→apply 往復の field test）
- [ ] クロスエージェント自動レビューループ
- [ ] クロスエージェント自動レビューループ

## ドキュメント

- [docs/design.md](docs/design.md) — アーキテクチャとツール仕様
- [docs/security.md](docs/security.md) — 安全境界と失敗モード
- [docs/comparison-with-markdown-handoff.md](docs/comparison-with-markdown-handoff.md) — 手動 handoff 方式との比較

## 前提環境（Phase 1 以降で使用）

- Codex CLI installed locally
- Node.js 24+ / npm 11+（MCP server は TypeScript を想定）

## Related project

- [claude-code-agent-workflow](https://github.com/0x000x7f/claude-code-agent-workflow) —
  安定版のワークフローテンプレート。本ブリッジが不調でも Markdown handoff 方式で運用が成立する（フォールバック関係）

## License

[MIT](LICENSE)
