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

### Approval input validation

`approval` must be a strict boolean value. String-like values such as `"true"`,
`"yes"`, `"1"`, or non-empty objects must not be treated as approval.

MCP ツール引数として `approval` を受け取る際、truthy な文字列・オブジェクトを
誤って承認扱いする事故を防ぐため、JSON Schema で `"type": "boolean"` を強制し、
ブリッジ実装側でも `approval === true` の厳密比較のみを承認と見なす。

### codex_apply（唯一の mutating tool・Phase 3）

`codex_apply` は本体 workspace を変更する唯一のツール。次を厳守する（実装は fail-closed）:

- **Codex を呼ばない**: codex_propose_patch が返した（人間レビュー済みの）exact diff を
  適用するだけ。再生成しない（承認した diff と適用 diff の一致を保証）
- `approval === true` 必須（上記 strict boolean）
- `expected_sha256`（diff の SHA-256）と `base_head`（review 時の HEAD）を**必須引数**とし、
  diff hash 不一致・HEAD 移動を拒否（人間が承認した exact diff/状態に束縛）
- clean tree 必須（review 時状態の保証＋rollback 可能性）
- 適用直前に `validateGitPatch` ＋ `git apply --check` を再実行
- working tree のみに適用し、**stage も commit もしない**（`--3way` も使わない）
- 失敗時は touched files 限定で rollback。`git checkout -- .` は使わない

### codex_review_patch（第三者レビュー・Phase 4・助言のみ）

`codex_review_patch` は read-only の任意レビューツール。**安全の中核ではなく補助**:

- ファイル変更しない・`codex_apply` を呼ばない・apply 用 approval/sha256 を生成しない・
  stage/commit しない・verdict による自動 apply をしない
- verdict は**助言**であり、人間 approval（codex_apply の `approval=true`）の代替にしない。
  apply ゲート（approval=true ＋ diff_sha256 ＋ base_head ＋ clean tree）は不変
- レビュー対象 diff は `validateGitPatch` ＋ diff_sha256 ＋ base_head で propose の exact diff に束縛
- **mojibake 判定は低信頼**: native Windows では reviewer も同じ PowerShell CP932 read-path を
  共有しうる相関故障のため。非ASCII の文字化け検出は人間レビュー＋WSL2 が本丸

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

Phase 2 の「テンポラリ領域での作業」の実装形態（Phase 2B / Strategy B′）:
HEAD から作成し終了後に必ず破棄する**一時 git worktree** に限定する。
**Codex の実行はすべて read-only であり、書き込みは bridge 自身が行う**
（native Windows では codex exec のエージェント書き込みが全構成でブロックされるため —
design.md §9）。bridge の書き込みは strict block format の parse を通過した
repo 相対パスのみが対象で、worktree 外・`.git/`・handoff 自身・バイナリ・上限超過は拒否する。
実行後に bridge が機械確認する: ①本体の `git status --porcelain` 不変（変化は最優先の重大エラー）
②worktree の HEAD 不変（commit されていない）③detached HEAD 維持（branch checkout なし）
④handoff コピーが採取 diff に混入していない。

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
