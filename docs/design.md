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

## 8. Phase 2 実装記録（codex_propose_patch — Strategy A）

### 採用判断: read-only のままテキスト diff 生成（Strategy A）

unified diff はテキストであり、**生成**に書き込み権限は不要。Codex は Phase 1 と同一の
`--sandbox read-only` 構成（spawn 層を無改修で再利用）で diff を agent message として返す。

fallback（設計記録のみ・未実装）: 運用検証で `git apply --check` の失敗率が高い場合、
temp に `git worktree` を切って `--sandbox workspace-write` + `-C <temp>` で実編集 →
`git diff` 採取 → worktree 破棄（Strategy B）へ移行する。security.md の command policy
（Phase 2: temp 作業可・対象リポジトリ書き込み不可）はこの移行を既に許容している。

### 検証パイプライン（すべて bridge 側・適用は一切しない）

```text
agent message
  → ```diff フェンス抽出（単一必須。0個・2個以上はエラー。フェンス外の説明文は無視）
  → Git 形式検証（diff --git 必須。non-git unified diff は拒否）
  → パス guard（絶対パス・`..`・`\`・`.git/`・バイナリ patch を拒否。/dev/null は許可し
    diff --git / --- / +++ の3者整合を検証。rename/copy の両側パスも検証）
  → 上限チェック → git -C <root> apply --check -（stdin・argv 配列・shell:false）
  → サマリ（ファイル一覧・+/-行数・check passed）＋ diff 本体を返却
```

### 上限（env で変更可）

| 項目 | 既定値 | env |
|---|---|---|
| 対象ファイル数 | 10 | `CODEX_BRIDGE_MAX_PATCH_FILES` |
| 変更行数（+ と - の合計） | 500 | `CODEX_BRIDGE_MAX_PATCH_LINES` |
| diff バイト数 | 200,000 | `CODEX_BRIDGE_MAX_PATCH_BYTES` |

### エラー方針

check 失敗・フェンス数違反・検証違反は、生出力/git 出力（上限付き）を添えた
`isError: true` で返す。**自動再試行・自動適用はしない**（判断は呼び出し側 = PM）。

## 9. Phase 2B 実装記録（Strategy B′ — temp worktree ＋ bridge-applied writes・既定化）

Phase 2 field test で Strategy A の `apply --check` 通過率が 29%（既存ファイル変更 0/4）に
留まったため（docs/ops/phase2-validation-log.md）、temp worktree 方式へ移行した。
ただし実機検証の結果、**native Windows では codex exec のエージェント書き込みが
あらゆる構成でブロックされる**ことが判明し（下記）、「Codex が直接編集する」Strategy B から
「**Codex は read-only で完全ファイル内容を出力し、bridge が worktree に書き込む**」
Strategy B′ にピボットした。diff は Git が生成するため context/hunk は原理的に正確になる。

### native Windows での実機調査結果（codex-cli 0.139.0、2026-06-13）

| 構成 | 結果 |
|---|---|
| `--sandbox workspace-write`（旧式） | バナーごと **read-only に黙って降格**（openai/codex Issue #6374 と同症状） |
| `--full-auto` | 同上 |
| 新 permission profiles `-c default_permissions=":workspace"`（0.138+） | バナーは workspace-write になるが、apply_patch は「outside of the project」・shell 書き込みは「rejected by policy」で**全拒否** |
| trust 注入・temp/ホーム/worktree/通常 repo の全組合せ | すべて同じ |
| `codex sandbox -P :workspace -- <直接コマンド>` | **書き込み成功**（restricted token sandbox 自体は機能） |

**運用上の罠**: `--sandbox` フラグを渡すと新 permission profiles（`default_permissions`）は
無効化される（公式仕様: 両系は併用不可、旧系が優先）。

### 方式（B′）

```text
本体 clean tree 確認（dirty は拒否）
→ os.tmpdir() 配下に git worktree add --detach <temp> HEAD
→ handoff を worktree 内へコピー（gitignored/未コミット handoff は worktree に存在しないため）
→ codex exec --sandbox read-only -C <temp>（Windows で実証済みの構成のまま）
  Codex は変更を strict block format で出力する:
    ===FILE: relative/path===
    <complete file contents>
    ===END===
    ===DELETE: relative/path===
→ bridge が parse（block 外本文・重複/不正パス・.git・handoff 自身・バイナリ・上限超過を拒否）
→ bridge が worktree に write/delete（ログは path と bytes のみ）
→ HEAD 不変＋detached 維持を機械確認 → handoff コピーの後始末（tracked=checkout・untracked=削除）
→ git add -A → git diff --cached --no-color --no-ext-diff で採取
→ worktree を必ず破棄（remove --force → fs.rm → prune の段階フォールバック）
→ 破棄の成否にかかわらず本体 porcelain を確認（変化は最優先の重大エラー）
→ 採取 diff を Strategy A と同一の validate ＋ 本体への git apply --check に通して返却（二重防御）
```

### 上限（B′ 固有・env で変更可）

| 項目 | 既定値 | env |
|---|---|---|
| FILE/DELETE block 数 | 10 | `CODEX_BRIDGE_MAX_REWRITE_FILES` |
| FILE block 1件のバイト数 | 65,536 | `CODEX_BRIDGE_MAX_REWRITE_FILE_BYTES` |
| FILE block 合計バイト数 | 200,000 | `CODEX_BRIDGE_MAX_REWRITE_TOTAL_BYTES` |

### 安全設計の要点

- **bridge 内の codex 呼び出しはすべて read-only**（workspace-write は一切使わない）。
  書き込みは bridge 自身のコードが行い、worktree 境界とパス guard を OS サンドボックスに
  依存せず強制する
- 完全ファイル内容方式の弱点（大きいファイルの転記ミス）は、①per-file 64KB 上限と
  ②**ミスが必ず diff に現れる**（HEAD との差分として可視化される）ことで管理する
- handoff が採取 diff に混入していないことを機械チェック（parse 段階の拒否＋採取後の照合）で保証
- temp worktree の絶対パスは MCP 応答ではマスク（`<temp worktree>`）。詳細は stderr ログのみ
- `--binary` は採取時に付けない（バイナリ変更は "Binary files" 行になり validate が拒否）

### Strategy A の扱い

`CODEX_BRIDGE_PATCH_STRATEGY=readonly` で温存（既定は `worktree` = B′）。
新規ファイル作成・小さな削除では A も有効（軽量）と field test で実証済み。
自動ルーティング・A→B′ フォールバックは将来課題。

## 10. Phase 3 実装記録（codex_apply — review-first の承認ゲート）

Phase 2B′ field test で、B′ の diff は構造的に正しい（apply --check 100%）が、Codex の
ファイル全文再生成が非ASCII記号を確率的に文字化けさせ、その行も apply --check を通って
しまうことが判明した（content fidelity の限界）。deep-research レポートにより、根本原因は
PowerShell 5.1 の `Get-Content` が BOM なし UTF-8 を ANSI（ja-JP=CP932）で読む read-path
問題（OpenAI issue #23044 / #15422）であり、プロンプトでは直せないと確定した。

→ Phase 3 は「自動で内容の正しさを判定する」のではなく、**人間がレビューした exact diff
だけに適用を許す review-first の承認ゲート**として実装した。

### 中核設計: codex_apply は Codex を呼ばない

`codex_apply(diff, approval, expected_sha256, base_head)` は決定的な適用ツール。
codex_propose_patch が返した（人間レビュー済みの）diff をそのまま受け取り適用する。
内部で Codex を再実行しない（非決定性により「人間が見た diff」と「適用される diff」が
乖離し承認が無効化されるため）。**本体 workspace を変更する唯一のツール**。

review-first フロー:

```text
codex_propose_patch → diff ＋ diff_sha256 ＋ base_head ＋ 非ASCII review ヒント を返す
→ メイン会話の Claude がユーザーに diff を提示
→ ユーザーが内容（文字化け含む）を確認して承認
→ codex_apply(diff, approval=true, expected_sha256, base_head)
```

### fail-closed チェック（この順・1つでも失敗で中断・tree 不変）

1. `approval === true` のみ（`"true"`/`"yes"`/`1`/truthy・オブジェクトは全拒否）
2. `expected_sha256` / `base_head` の存在確認（**両者とも必須**。空なら拒否）
3. diff の SHA-256 が `expected_sha256` と一致（人間が見た diff と適用 diff の束縛）
4. 現在 HEAD が `base_head` と一致（review 後に HEAD が動いたら無効）
5. clean tree（`git status --porcelain` が空。review 時状態の保証＋rollback 可能性）
6. `validateGitPatch`（Git形式・path guard・上限）＋ `git apply --check` 再実行
7. `git apply -`（working tree のみ・`--3way` なし・**stage も commit もしない**）
8. 適用結果（変更ファイル・行数）を報告。人間が `git diff` 確認後に自分で add/commit

### rollback（`git checkout -- .` 一発に依存しない）

`git apply` は原子的＋clean tree 前提なので通常は失敗時 tree 不変。万一 dirty が残ったら
**diff から抽出した touched files に限定**して復旧（tracked は `git checkout -- <path>`、
新規予定ファイルは削除）。`git checkout -- .` は無関係な untracked を消すため使わない。
復旧不能時は重大エラーとして status と手動復旧手順を返す。

### 非ASCII変更の可視化（判定でなく提示）

codex_propose_patch の返却に「非ASCII を含む変更行数」「near-full rewrite ファイル」を
review ヒントとして出す。`窶` 等は合法な日本語文字でもあり自動 mojibake 判定は誤検知が
多いため、**safe を言い切らず人間レビューの注意を高リスク箇所へ向ける**支援に徹する。

### Windows / Unicode fidelity

native Windows の read-path 問題を避けたい contributor 向けに、claude-code-setup.md で
WSL2 運用（Linux サンドボックス実装が使われる）を回避策として案内する。

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
