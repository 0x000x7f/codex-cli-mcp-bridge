# codex-cli-mcp-bridge

> **Status**: design phase (Phase 0) — documentation only, no implementation yet.
> Experimental. Not an official Anthropic / OpenAI project.

> **EN** — A design-phase concept for bridging Codex CLI into Claude Code as an MCP server,
> automating the manual Markdown-handoff workflow of
> [claude-code-agent-workflow](https://github.com/0x000x7f/claude-code-agent-workflow).
> Three staged tools isolate mutation behind an explicit approval gate:
> `codex_plan` (read-only) → `codex_propose_patch` (diff proposal only) → `codex_apply`
> (explicit approval required). Source code will be introduced only after the design,
> security model, and tool boundaries are reviewed.

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
| `codex_propose_patch(handoff_path)` | 2 | unified diff 案を返す | working tree への適用 |
| `codex_apply(handoff_path, approval)` | 3 | `approval=true` 明示時のみ diff を適用 | 承認なしの適用 |

## Roadmap

- [x] Phase 0: 設計・セキュリティモデル・既存方式との比較（このリポジトリの現状）
- [ ] Phase 1: `codex_plan`（読み取り専用ツール）の実装と検証
- [ ] Phase 2: `codex_propose_patch`（diff 提案のみ）
- [ ] Phase 3: `codex_apply`（承認ゲート付き適用）
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
