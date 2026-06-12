# 設計ドキュメント（Phase 0）

> This repository intentionally starts without a `src/` directory in Phase 0.
> Source code will be introduced only after the design, security model, and tool
> boundaries are reviewed.

## 1. 目的

[claude-code-agent-workflow](https://github.com/0x000x7f/claude-code-agent-workflow) の
クロスツール分業では、`/handoff` が生成する自己完結 Markdown（HANDOFF 文書）を
**人間が Codex / Cursor へコピーして運搬**している。本プロジェクトはこの運搬部分を
MCP（Model Context Protocol）ツール呼び出しに置き換え、次のフローを1セッションで完結させる:

```text
Claude Code（PM）
  → /handoff で HANDOFF 文書を生成
  → MCP ツールで Codex CLI に処理させる
  → 返ってきた計画 / diff / 適用結果を /review-diff で検収
```

## 2. アーキテクチャ

```text
Claude Code ──(MCP / JSON-RPC over stdio)── codex-cli-mcp-bridge (TypeScript)
                                                  │ spawn / parse
                                                  ▼
                                             Codex CLI（非対話実行モード）
                                                  │ reads
                                                  ▼
                                          docs/handoff/HANDOFF-*.md
```

- ブリッジは TypeScript 製の MCP server（stdio transport）として実装する
- Codex CLI はサブプロセスとして起動し、非対話実行モードを利用する
  （使用する具体的なフラグ・出力形式は Phase 1 の実機検証で確定する）
- HANDOFF 文書のパスをツール引数として受け取り、Codex への入力に変換する

## 3. ツール仕様（3段階）

破壊的操作（ファイル変更）を最後の Phase まで隔離する段階設計。

### 3.1 `codex_plan(handoff_path)` — Phase 1

| 項目 | 内容 |
|---|---|
| 入力 | HANDOFF 文書の相対パス |
| 出力 | Codex による要約・実装計画・想定リスク（テキスト） |
| 許可 | HANDOFF 文書と対象リポジトリの読み取り |
| 禁止 | あらゆるファイル変更・コマンド実行 |
| 完了条件 | 実機の Codex CLI で計画が安定して返り、ファイル変更が一切発生しないこと |

### 3.2 `codex_propose_patch(handoff_path)` — Phase 2

| 項目 | 内容 |
|---|---|
| 入力 | HANDOFF 文書の相対パス |
| 出力 | unified diff（提案のみ） |
| 許可 | 読み取り＋diff の生成 |
| 禁止 | working tree への適用・コミット |
| 完了条件 | 返却 diff が `git apply --check` を通る形式であること |

### 3.3 `codex_apply(handoff_path, approval)` — Phase 3

| 項目 | 内容 |
|---|---|
| 入力 | HANDOFF 文書の相対パス＋明示の `approval` フラグ |
| 出力 | 適用結果・変更ファイル一覧・テスト結果 |
| 許可 | `approval=true` のときのみ diff 適用 |
| 禁止 | 承認なしの適用（既定値は常に拒否） |
| 完了条件 | 適用・rollback・検収（/review-diff）の一連が安定すること |

## 4. セッション管理

- 1 ツール呼び出し = 1 Codex 実行を基本とし、状態はブリッジ側で持たない（ステートレス優先）
- 継続が必要な場合（計画→diff の文脈引き継ぎ）は、HANDOFF 文書と前回出力を再入力する
  「ファイルベース文脈共有」で対応する — チャットセッションの内部状態には依存しない
- これは claude-code-agent-workflow の設計原則（context is shared through files）の踏襲

## 5. Phase ロードマップと完了条件

| Phase | 内容 | 完了条件 |
|---|---|---|
| 0 | 設計・セキュリティモデル・比較文書 | 3文書のレビュー完了 |
| 1 | `codex_plan` 実装 | 読み取り専用性の実機確認・ファイル変更ゼロ |
| 2 | `codex_propose_patch` 実装 | diff が `git apply --check` を通る・適用は発生しない |
| 3 | `codex_apply` 実装 | 承認ゲート・rollback・検収フローの動作確認 |

## 6. 未解決の設計論点

以下は Phase 0 時点で**未解決**であり、Phase 1 以降の実機検証で確定する:

- ~~Codex CLI の非対話モードの正確な呼び出し方法・出力形式・終了コード~~ → §7 で確定
- ~~タイムアウト値と、タイムアウト時に Codex サブプロセスを安全に停止する方法~~ → §7 で確定
- 部分適用された diff の検出と rollback の自動化（`git stash` ベース案 vs worktree 分離案）— Phase 2/3
- Claude 側と Codex 側の usage limit を相互監視する仕組み（どちらに作業を寄せるかの判断材料）
- ~~Windows パス（バックスラッシュ・ドライブレター）と POSIX パスの変換境界~~ → §7 で確定

## 7. Phase 1 実機確定事項（codex-cli 0.139.0 で実走検証）

### 非対話モードの呼び出し（確定）

```text
codex exec --sandbox read-only --ephemeral --color never --json --skip-git-repo-check -C <workspaceRoot> -
```

- `--sandbox read-only` — モデル生成コマンドの実行を読み取り専用サンドボックスに制限（CLI レベルの強制）
- `--ephemeral` — セッションファイルをディスクに残さない（ステートレス設計と一致）
- `--json` — イベントを JSONL で stdout に出力。最終 agent message を抽出して返す。
  パース失敗時は生出力を添えてエラーにする（推測で続行しない）
- `-`（プロンプトは stdin から）— shell 文字列結合を排除。spawn は `shell: false` の argv 配列のみ
- `--output-last-message` は**使わない**（ファイル書き込みが発生するため）
- approval 系: `exec` は非対話設計で承認プロンプト自体が発生しない。
  `--dangerously-bypass-approvals-and-sandbox` は全 Phase で使用禁止

### Windows 固有の確定事項

- npm グローバルの `codex` は `codex.cmd` ラッパーであり、Node は `shell: false` での
  `.cmd` spawn を拒否する（CVE-2024-27980 対策）。そのため **`node` 実行ファイルで
  `@openai/codex/bin/codex.js` を直接起動**する（`CODEX_BRIDGE_CODEX_JS` で上書き可能）
- タイムアウト時の停止は `taskkill /PID <pid> /T /F` でプロセスツリーごと強制終了
  （codex.js の子に native バイナリがいるため `/T` が必須）。POSIX は `SIGKILL`

### 認証（確定）

- `codex login status` で確認。bridge は認証情報を一切保持・転送しない（設計どおり）

### 実走検証の結果と運用知見（2026-06-12）

- **成功経路**: fixture HANDOFF を入力に codex_plan を実走し、4セクション構成の計画のみが返却され
  （diff・コードなし）、実行前後の `git status --porcelain` が完全一致（ファイル変更ゼロ）
- **JSONL 形式の実測**: `{"type":"item.completed","item":{"type":"agent_message","text":...}}` と
  `turn.completed`（usage 付き）。エラーは `{"type":"error","message":...}` / `turn.failed` として
  **stdout** に出る（stderr は空のことが多い）— bridge はこれをエラーメッセージに伝搬する
- **exec のバナーで `approval: never` を確認** — 非対話モードでは承認プロンプト自体が発生しない
- **クライアントバージョンの罠**: 古いクライアント（0.118.0）はバックエンドに拒否され、
  全モデルで `The '<model>' model is not supported when using Codex with a ChatGPT account` (400)
  が返る。**プランの問題に見えるが実態はクライアントが古い**ことがある。
  このエラーを見たらまず `npm install -g @openai/codex@latest` を試すこと
- 既知の注意点: Codex がリポジトリ内の日本語ドキュメントを mojibake と認識する場合がある
  （Codex 側のエンコーディング解釈。bridge の責任範囲外だが、日本語 HANDOFF の精度に影響しうる）
