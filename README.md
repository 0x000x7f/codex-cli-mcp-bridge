# codex-cli-mcp-bridge

> **Status**: experimental — Phases 1–4 implemented and verified.  
> **Project type**: MCP server / agentic software development safety layer.  
> **Note**: This is not an official Anthropic / OpenAI project.

---

## EN — What this is

`codex-cli-mcp-bridge` is an experimental MCP server that bridges Claude Code to Codex CLI for agentic software development.

However, its main goal is **not** to replace OpenAI's official [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc). If you simply want a polished Claude Code integration for Codex, the official plugin is likely the better default.

This project explores a different question:

> How can an AI agent hand off implementation work to another coding agent while keeping dangerous execution rights outside the model?

The bridge exposes the workflow as staged MCP tools:

- `codex_plan`: read-only planning
- `codex_propose_patch`: patch proposal without touching the real workspace
- `codex_review_patch`: optional read-only third-party review
- `codex_apply`: deterministic application only after human approval

The key idea is:

> **The LLM is a proposer. The MCP server is a gatekeeper. The human remains the approver.**

Dangerous actions are not trusted to the model's self-control. They are guarded outside the model by explicit approval, diff hash binding, base HEAD checks, clean-tree checks, path guards, and `git apply --check`.

Because this is implemented as an MCP server rather than a Claude Code-only plugin, the control layer can potentially be reused from other MCP-compatible clients or adapted to other coding CLIs/models in the future.

---

## JP — これは何か

`codex-cli-mcp-bridge` は、Claude Code から Codex CLI を呼び出すための実験的 MCP server です。

ただし、このプロジェクトの主目的は OpenAI 公式の [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) を置き換えることではありません。単に Claude Code から Codex を便利に使いたいだけなら、公式プラグインの方が実用的なデフォルトです。

このプロジェクトが検証したい問いは別にあります。

> AIエージェントが別のコーディングエージェントへ実装作業を渡すとき、危険な実行権限をモデルの外側に置いたまま、どこまで安全に自動化できるか？

このブリッジは、作業を段階的な MCP tool として公開します。

- `codex_plan`: 読み取り専用の計画生成
- `codex_propose_patch`: 実workspaceを触らないpatch提案
- `codex_review_patch`: 任意の読み取り専用第三者レビュー
- `codex_apply`: 人間承認後のみ行う決定論的な適用

中心となる考え方は次の通りです。

> **LLMは提案者、MCP serverは門番、人間は承認者。**

危険な操作は、モデルの自己制御に任せません。明示的な承認、diff hash、base HEAD、clean tree、path guard、`git apply --check` など、モデル外部の決定論的なゲートで制御します。

また、Claude Code専用プラグインではなく MCP server として実装することで、将来的には他のMCP対応クライアントや、別のコーディングCLI・モデルへ制御層を再利用しやすくすることを狙っています。

---

## Why MCP?

OpenAI's `codex-plugin-cc` is the practical default if the goal is simply to use Codex from Claude Code.

This project intentionally uses MCP because the goal is different: to separate the **agent handoff control layer** from any single host application or coding model.

MCP gives this project three advantages:

1. **Host separation**  
   The bridge is not tied to a Claude Code slash-command UX. It is exposed as tool calls that can potentially be reused by other MCP-compatible clients or custom agent runners.

2. **Model / CLI replaceability**  
   Today the backend is Codex CLI. In the future, the same staged control layer could be adapted to another coding CLI, another model, or a local patch generator.

3. **Explicit permission boundaries**  
   Planning, patch proposal, review, and application are separate tools. This makes it easier to decide what the model may do, what the MCP server must verify, and what still requires human approval.

In short:

> The official plugin is a convenient integration.  
> This project is a model-agnostic safety and handoff layer.

## なぜMCPか

Claude Code から Codex を呼び出すこと自体が目的なら、OpenAI公式の `codex-plugin-cc` が実用上の第一候補です。

このプロジェクトでMCPを使う理由は、目的が違うからです。特定のホストアプリや特定のコーディングモデルから、**AIエージェント間handoffの制御層**を分離したいという意図があります。

MCPにする利点は主に3つです。

1. **ホストからの分離**  
   Claude Code の slash command UX に閉じず、MCP tool call として公開できます。将来的に、他のMCP対応クライアントや自作エージェントランナーから再利用できる可能性があります。

2. **モデル / CLI の差し替えやすさ**  
   現在のbackendは Codex CLI ですが、同じ段階制御層を別のコーディングCLI、別モデル、ローカルpatch generatorへ適用できる余地があります。

3. **明示的な権限境界**  
   計画、patch提案、レビュー、適用を別toolに分けることで、モデルに許す範囲、MCP server側で検証する範囲、人間承認が必要な範囲を分離できます。

要するに、

> 公式プラグインは便利な統合。  
> このプロジェクトはモデル非依存の安全・handoff制御層。

---

## Comparison with `codex-plugin-cc`

| Aspect | `codex-plugin-cc` | `codex-cli-mcp-bridge` |
|---|---|---|
| Primary goal | Convenient Codex integration inside Claude Code | Experimental MCP handoff and safety-control layer |
| Interface | Claude Code plugin / slash commands | MCP tools |
| Best for | Normal Claude Code users who want Codex help quickly | Developers exploring agent handoff, safety gates, and model/CLI replaceability |
| Safety model | Integrated product workflow | Explicit staged gates: plan → propose → review → approve → apply |
| Mutating path | Managed by the plugin workflow | Only `codex_apply`; requires approval, hash match, HEAD match, clean tree, and apply-check |
| Portability | Claude Code-oriented | Potentially reusable from other MCP clients |
| Positioning | Practical default | Experimental safety architecture |

## `codex-plugin-cc` との比較

| 観点 | `codex-plugin-cc` | `codex-cli-mcp-bridge` |
|---|---|---|
| 主目的 | Claude Code内でCodexを便利に使う | MCP上でhandoffと安全境界を実験・検証する |
| インターフェース | Claude Code plugin / slash command | MCP tools |
| 向いている人 | Claude CodeからすぐCodexを使いたい通常ユーザー | agent handoff、安全ゲート、モデル/CLI差し替え可能性を検証したい開発者 |
| 安全モデル | 統合プロダクト内のworkflow | plan → propose → review → approve → apply の明示的な段階ゲート |
| 変更経路 | plugin workflow側で管理 | `codex_apply` のみ。approval、hash一致、HEAD一致、clean tree、apply-check必須 |
| 可搬性 | Claude Code寄り | 他MCP clientから再利用できる可能性 |
| 位置づけ | 実用的なデフォルト | 実験的な安全アーキテクチャ |

---

## Tool design

| Tool | Phase | What it can do | What it cannot do |
|---|---|---|---|
| `codex_plan(handoff_path)` | 1 | Ask Codex to read a handoff document and return a summary / implementation plan | Any file modification |
| `codex_propose_patch(handoff_path)` | 2 / 2B′ | Return a validated Git unified diff plus `diff_sha256`, `base_head`, and review hints; verified with Git-format validation, path guards, limits, and `git apply --check` | Apply changes to the real working tree |
| `codex_review_patch(diff, expected_sha256, base_head, review_focus?)` | 4 | Ask another Codex run to review a diff in read-only mode and return a written verdict | File modification, apply, or replacing human approval |
| `codex_apply(diff, approval, expected_sha256, base_head)` | 3 | Apply an exact reviewed diff to the working tree after explicit approval, hash binding, HEAD binding, clean-tree check, and apply-check | Calling Codex, applying without approval, staging, committing |

## ツール設計

| Tool | Phase | できること | できないこと |
|---|---|---|---|
| `codex_plan(handoff_path)` | 1 | HANDOFF文書をCodexに読ませ、要約と実装計画を返す | ファイル変更の一切 |
| `codex_propose_patch(handoff_path)` | 2 / 2B′ | 検証済みunified diff、`diff_sha256`、`base_head`、レビューヒントを返す。Git形式検証、path guard、上限、`git apply --check` を通す | 実working treeへの適用 |
| `codex_review_patch(diff, expected_sha256, base_head, review_focus?)` | 4 | 別Codexにread-onlyでdiffをレビューさせ、written verdictを返す | ファイル変更、apply、人間承認の代替 |
| `codex_apply(diff, approval, expected_sha256, base_head)` | 3 | 明示承認、hash束縛、HEAD束縛、clean tree確認、apply-check後に、レビュー済みexact diffをworking treeへ適用 | Codex呼び出し、承認なし適用、stage、commit |

---

## Roadmap

- [x] Phase 0: Design, security model, and comparison with the manual Markdown handoff workflow
- [x] Phase 1: `codex_plan` read-only tool; verified that the working tree remains unchanged before/after real runs
- [x] Phase 2: `codex_propose_patch` as diff proposal only; initially implemented with Strategy A, where Codex hand-writes diffs
- [x] Phase 2B′: Pivoted to Strategy B′ — temp worktree + bridge-applied writes; improved existing-file `apply --check` pass rate from 29% to 100% in field testing; avoided native Windows codex-exec write blocking
- [x] Phase 3: `codex_apply` review-first approval gate; does not call Codex; applies only exact reviewed diffs with `approval=true`, SHA-256 binding, base HEAD binding, clean tree, final revalidation, and working-tree-only writes
- [x] Phase 4: `codex_review_patch` read-only third-party review layer; advisory only and never part of the apply gate
- [ ] Additional Phase 3/4 operational validation for propose → review → apply round trips
- [ ] Cross-agent automatic review loop experiments
- [ ] Non-ASCII / mojibake fidelity hardening tracked in [#2](https://github.com/0x000x7f/codex-cli-mcp-bridge/issues/2)

## ロードマップ

- [x] Phase 0: 設計・セキュリティモデル・手動Markdown handoff方式との比較
- [x] Phase 1: `codex_plan` 読み取り専用tool。実走前後でworking tree不変を確認済み
- [x] Phase 2: `codex_propose_patch` diff提案のみ。当初はCodexがdiffを手書きするStrategy Aで実装
- [x] Phase 2B′: Strategy B′へ移行。temp worktree + bridge-applied writesにより、既存ファイル変更の `apply --check` 通過率をfield testで29%から100%へ改善。native Windowsのcodex-exec書き込みブロックを迂回
- [x] Phase 3: `codex_apply` review-first承認ゲート。Codexを呼ばず、`approval=true`、SHA-256束縛、base HEAD束縛、clean tree、適用直前再検証、working-tree-only writesを満たすexact diffのみ適用
- [x] Phase 4: `codex_review_patch` 読み取り専用第三者レビュー層。助言のみで、apply gateには関与しない
- [ ] Phase 3/4の運用検証積み増し。propose → review → apply 往復を複数回検証
- [ ] クロスエージェント自動レビューループ実験
- [ ] 非ASCII / mojibake fidelity hardening は [#2](https://github.com/0x000x7f/codex-cli-mcp-bridge/issues/2) で追跡

---

## Documentation / ドキュメント

- [docs/design.md](docs/design.md) — architecture and tool specification / アーキテクチャとtool仕様
- [docs/security.md](docs/security.md) — safety boundaries and failure modes / 安全境界と失敗モード
- [docs/comparison-with-markdown-handoff.md](docs/comparison-with-markdown-handoff.md) — comparison with manual handoff / 手動handoff方式との比較
- [docs/ops/phase2-validation-log.md](docs/ops/phase2-validation-log.md) — Phase 2 / 2B′ field test log

---

## Requirements / 前提環境

- Codex CLI installed locally
- Node.js 24+ / npm 11+
- A local Git repository workspace
- Claude Code or another MCP-compatible client

---

## Related project / 関連プロジェクト

- [claude-code-agent-workflow](https://github.com/0x000x7f/claude-code-agent-workflow) — the stable workflow template. If this bridge fails, the manual Markdown handoff workflow still works as a fallback.  
  安定版のワークフローテンプレート。本ブリッジが不調でも、手動Markdown handoff方式で運用が成立するフォールバック関係。

---

## License

[MIT](LICENSE)
