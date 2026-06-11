# セキュリティモデル（Phase 0）

> The default behavior must be non-mutating. Any operation that writes to the working
> tree, applies a patch, runs package scripts, or invokes external commands beyond Codex
> planning must require an explicit approval gate.

## 1. 基本原則

1. **既定は非破壊** — すべてのツールの既定動作は読み取りのみ。書き込みは Phase 3 の
   `codex_apply` に限定し、それも `approval=true` の明示がない限り常に拒否する
2. **段階の飛び越し禁止** — Phase 1 のツールが diff を返したり、Phase 2 のツールが
   適用したりする実装は仕様違反として扱う
3. **検収必須** — `codex_apply` の結果は必ず reviewer（/review-diff）の検収を経る。
   ブリッジが検収を代行・省略してはならない

## 2. Workspace guard（作業ディレクトリ制限）

- ブリッジは起動時に許可ディレクトリ（対象リポジトリのルート）を1つ受け取る
- HANDOFF 文書のパス・Codex の作業対象が許可ディレクトリ外を指す場合は即時拒否
- シンボリックリンク・`..` を含むパスは正規化してから判定する

## 3. Command policy（Codex 側に許可する操作の境界）

| Phase | Codex に許可する操作 |
|---|---|
| 1 | ファイル読み取りのみ |
| 2 | 読み取り＋diff 生成（テンポラリ領域での作業は可、対象リポジトリへの書き込み不可） |
| 3 | diff 適用＋HANDOFF 文書に記載されたテストコマンドの実行のみ |

- パッケージインストール・ブランチ操作・push・ネットワークアクセスは全 Phase で不許可
- 許可コマンドのリストはブリッジ側の設定で持ち、Codex 側の判断に委ねない

## 4. Timeout・中断・rollback

- すべての Codex 実行にタイムアウトを設定する（値は Phase 1 で実測のうえ確定）
- タイムアウト・中断時は: サブプロセス停止 → working tree の状態確認 →
  変更が検出されたら rollback → 「部分適用の可能性あり」として報告
- `codex_apply` は適用前に working tree がクリーンであることを必須条件とする
  （クリーンでなければ拒否。rollback 可能性を常に保証するため）

## 5. 失敗モード一覧

| 失敗モード | 想定される対応 |
|---|---|
| Codex CLI の出力形式が想定と異なる | パース失敗として生出力を添えて報告（推測で続行しない） |
| MCP server が Claude Code から認識されない | 設定診断手順を docs に用意（Phase 1） |
| Codex が指示範囲を超えて大きく変更する | diff 行数・対象ファイル数の上限チェックで拒否 |
| timeout・中断による部分適用 | working tree 検査と rollback（§4） |
| Windows パスの不整合 | 境界での正規化と、パスを含む入出力のログ化 |
| usage limit 到達 | 即時中断し、Markdown handoff（手動方式）へのフォールバックを案内 |

## 6. 機密情報の扱い

- ブリッジは API キー・トークンを保存しない（Codex CLI 自身の認証に委譲する）
- ログに HANDOFF 文書の内容を全文出力しない（パスとサイズのみ）
- リポジトリ内の文書・コード・例にローカル環境の絶対パスや個人情報を含めない
