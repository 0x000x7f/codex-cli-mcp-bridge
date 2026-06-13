# Phase 3 検証ログ — codex_apply（review-first 承認ゲート）

codex_apply は本体 workspace を変更する唯一のツール。Codex を呼ばず、codex_propose_patch が
返した（人間レビュー済みの）exact diff を適用する。検証は「往復が成立すること」と
「fail-closed ゲートが実 workspace で機能し、拒否時に何も変更しないこと」の2点。

## ユニットテスト（temp git repo・Codex 不要）

`npm test` 65/65 合格。codex_apply は次を網羅:
approval が `true` 以外（`false`/`"true"`/`1`/未指定）の全拒否・hash 不一致拒否・
HEAD 移動拒否・dirty tree 拒否・空 sha/head 拒否・適用不能 diff 拒否（いずれも tree 不変）・
正常適用（working tree のみ・stage されない）。diff-summary は hash 安定性・非ASCII行カウント。

## ライブ field test（実 workspace = bridge repo、v0.5.0）

### 往復（propose → 人間レビュー想定 → apply）

| 項目 | 結果 |
|---|---|
| codex_propose_patch | diff ＋ `diff_sha256` ＋ `base_head` ＋ review ヒントを返却（27s） |
| codex_apply（reviewed diff・approval=true・sha256・base_head） | **成功**: `docs/glossary.md` を作成 |
| 適用後の状態 | working tree に出現（`?? docs/glossary.md`）・**stage されていない**（`git diff --cached` 空）・commit もなし |
| 生成内容 | 文字化けなし・設計文書に忠実（codex_apply は approval/sha256/HEAD 必須等を正しく記述） |
| 後始末 | untracked のため `rm` で復元（clean tree） |

→ review-first の往復が実 workspace で成立。適用は working tree のみで stage/commit しないことを確認。

### fail-closed ゲート（実 workspace に対するライブ拒否）

`tests/manual/apply-reject-check.mjs` で実 repo に対し実行:

| ケース | 結果 |
|---|---|
| approval=false | ApplyRejected |
| approval="true"（文字列） | ApplyRejected |
| hash 不一致 | ApplyRejected |
| 空 sha256 | ApplyRejected |
| 拒否後の workspace | **README.md 不変**（status に出ない＝ゲートが適用前に中断、何も書いていない） |

## 判定

- ユニット 65/65・実 workspace 往復成功・実 workspace 拒否4/4で tree 不変
- codex_apply は Codex を呼ばない（決定的）・stage/commit しない・hash/HEAD/clean tree を束縛
- **Phase 3 完了**。実用形は「propose で diff＋sha256＋base_head を得る → 人間が diff を
  レビュー（非ASCII review ヒントで重点把握）→ codex_apply で exact diff を適用」

## 残課題・次の候補

- propose→apply を Claude Code の MCP 経由（メイン会話が diff をユーザー提示→承認）で通す
  end-to-end の体験確認（本ログは jsonrpc-smoke 経由の機械検証）
- 非ASCII文字化けの根本回避が必要なら WSL2 運用（claude-code-setup.md に案内済み）
- README Roadmap 次項: Phase 3 運用検証の積み増し / クロスエージェント自動レビューループ
