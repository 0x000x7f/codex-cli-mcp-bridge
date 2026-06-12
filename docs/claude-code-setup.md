# Claude Code への登録手順（Phase 1）

## 前提

- Codex CLI がインストールされ、`codex login status` でログイン済みであること
  （bridge は認証情報を保持せず、Codex CLI 自身の認証に委譲する）
- Node.js 20+ / `npm install` と `npm run build` が完了していること

## 方法1: プロジェクトスコープ（推奨・自動）

このリポジトリ直下の `.mcp.json` により、**このリポジトリを開いた Claude Code セッション**では
`codex-bridge` サーバーが自動的に利用可能になる。追加設定は不要。

ワークスペースは既定でサーバープロセスのカレントディレクトリ（= このリポジトリ）になる。

## 方法2: グローバル登録（手動・任意）

他のプロジェクトからも使う場合は、ユーザー自身が `claude mcp add` で登録する
（`~/.claude.json` への変更になるため、このリポジトリでは自動化しない）:

```text
claude mcp add codex-bridge -- node <このリポジトリの絶対パス>/dist/src/server.js
```

対象プロジェクトをワークスペースにする場合は環境変数で指定する:

```text
CODEX_BRIDGE_WORKSPACE=<対象リポジトリのルート>
```

## 環境変数

| 変数 | 既定値 | 意味 |
|---|---|---|
| `CODEX_BRIDGE_WORKSPACE` | サーバーの cwd | 許可ワークスペースのルート（1つ） |
| `CODEX_BRIDGE_TIMEOUT_MS` | `300000` | Codex 実行のタイムアウト（超過時はプロセスツリーを強制終了） |
| `CODEX_BRIDGE_CODEX_JS` | 自動探索 | `@openai/codex/bin/codex.js` の絶対パス（Windows の npm グローバル以外に置いた場合） |

## 動作確認（Claude Code を使わないスタンドアロン検証）

```text
npm run build
node tests/manual/jsonrpc-smoke.mjs                              # initialize + tools/list
node tests/manual/jsonrpc-smoke.mjs tests/fixtures/HANDOFF-test.md   # codex_plan 実走
```

実走の前後で `git status --porcelain` が変化しないことが Phase 1 の合格条件。
