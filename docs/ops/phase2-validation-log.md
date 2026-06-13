# Phase 2 運用検証ログ — codex_propose_patch field test

Phase 3（適用を伴う段階）へ進む前に、`codex_propose_patch` を実作業で使い、
**安全性（working tree 不変）・diff 品質（apply --check 通過率）・運用上の癖**を記録する。

## 方法

- Phase 1 と同じ規律: 各実走の直前・直後に対象 workspace で `git status --porcelain` を
  取得し、完全一致を確認する（**dirty tree の場合は中断して報告**）
- 実行は `node tests/manual/jsonrpc-smoke.mjs <handoff_path> propose`
- 特に記録する項目: `git apply --check` の通過/失敗（**失敗率が高ければ Strategy B
  = temp worktree 方式への移行を検討** — docs/design.md §8 の fallback）

## 評価基準

| 評価 | 意味 |
|---|---|
| A | check passed・最小差分・そのまま人間レビューに回せる |
| B | check passed・一部修正すれば使える |
| C | check passed だが差分が過剰・的外れ |
| D | 検証ゲートで拒否（フェンス違反・パス違反・上限超過・check 失敗） |
| E | 失敗（ツールエラー） |

※ D はゲートが機能した証拠でもあるため、原因（モデル起因か指示起因か）を Issues 欄に書く。

## 検証ログ

| No | Date | Target repo | Handoff | JA? | Result | elapsed | Tree clean? | apply --check | Rating | Issues |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-06-13 | bridge | HANDOFF-propose-glossary（新規ファイル作成） | no | success | 40.7s | yes | passed | A | 実装時の初回検証。context 再現が不要な新規ファイル形式 |
| 1 | 2026-06-13 | bridge | HANDOFF-propose-ja-edit（日本語ファイルの既存行変更） | yes | gate 拒否 | 44.6s | yes | **failed**（patch does not apply） | D | mojibake により日本語 context 行を再現できない（仮説どおり） |
| 2 | 2026-06-13 | bridge | HANDOFF-propose-agents-note（英語ファイルの既存行変更） | no | gate 拒否 | 29.0s | yes | **failed**（patch does not apply） | D | **英語でも失敗** — 原因は mojibake ではなく context 行の不正確な再現 |
| 3 | 2026-06-13 | bridge | HANDOFF-propose-two-files（2ファイル変更） | 混在 | gate 拒否 | 57.4s | yes | **failed**（corrupt patch） | D | hunk 構造自体が不正。複数ファイルでさらに悪化 |
| 4 | 2026-06-13 | bridge | HANDOFF-propose-delete（2行ファイルの削除） | no | success | 22.2s | yes | passed | A | 削除形式（+++ /dev/null）。2行の完全再現は可能 |
| 5 | 2026-06-13 | claude-code-agent-workflow | HANDOFF-propose-usage-gitignore-note（別repo×日本語変更） | yes | gate 拒否 | 39.5s | yes | **failed**（corrupt patch） | D | 別リポジトリでも同傾向 |
| 6 | 2026-06-13 | bridge | HANDOFF-propose-oversize（全文書英訳の過大要求） | no | gate 拒否 | 96.7s | yes | **failed**（corrupt patch） | D | サイズ上限に達する前に構造不正で拒否 |

集計: 実走7件（実装時1＋field 6）。**A: 2 / D: 5 / E: 0**。`apply --check` 通過率 **2/7 ≈ 29%**。
全件で working tree 変更ゼロ（対象が別リポジトリの場合も両側で確認）。エラーは全件原因が読める。

## 観察事項と判定

1. **成否を分けるのは「既存内容の正確な再現量」**: 新規ファイル（context 0行）と極小ファイル削除（2行）は
   成功。既存ファイルの変更（context 行＋行番号の正確な再現が必要）は**言語を問わず全滅**（4/4 失敗）
2. **mojibake は悪化要因であって主因ではない**: 英語ファイル（AGENTS.md）の変更も `patch does not apply`。
   主因は「モデルが手書きする diff の context・hunk 構造の不正確さ」という Strategy A の本質的限界
3. **安全網は完璧に機能**: 不正 diff は 7件中5件すべて `git apply --check` が捕捉し、全件 working tree
   変更ゼロ・エラー可読。「悪い diff が黙って通る」事故はゼロ
4. **判定: Phase 3 着手ゲートは不通過**（通過率 29% < 目安 70%）。
   **Strategy B（temp worktree 方式）への移行を推奨** — temp に worktree を切って Codex に実編集させ、
   bridge が `git diff` で diff を採取する方式なら context は定義上正確になる。
   設計は docs/design.md §8 の fallback として記録済み・security.md の command policy も許容済み
5. Strategy A の存続価値: 新規ファイル作成・ファイル削除の提案には引き続き有効（軽量・書き込み面ゼロ）。
   Strategy B 導入時もタスク種別による使い分け（または A 失敗時の B フォールバック）が候補

## Phase 3 着手ゲート（チェックリスト）

- [x] codex_propose_patch 実走 5件以上（日本語ファイルへの diff を含む）— 7件実施
- [x] すべての実走で working tree 変更ゼロ
- [ ] **apply --check 通過率が運用に耐える水準 — 不通過（29% < 70%）。Strategy B への移行が必要**
- [x] 拒否系のエラーが読める（patch does not apply / corrupt patch とも原因特定可能）
- [x] tools/list が codex_plan / codex_propose_patch の2つのみ
- [ ] Phase 3 の承認ゲート設計レビュー（Strategy B 導入後に実施）

**判定（2026-06-13）: Phase 3 はブロック。次のステップは Strategy B（temp worktree 方式）の
設計・実装による diff 品質の改善**（既存ファイル変更で check 通過率 70% 以上が再開条件）。

---

## Phase 2B′ field test（Strategy B′ = bridge-applied writes、v0.4.0）

Strategy B は native Windows の codex exec 書き込みブロックにより断念し、
**B′（Codex は read-only で完全ファイル内容を出力 → bridge が worktree に書き込み → git diff 採取）**
にピボット（design.md §9）。Phase 2A で失敗した4ケースを含む6件を再戦。

| No | Target | Handoff | JA? | 種別 | Result | elapsed | Tree clean? | apply --check | Rating | Issues |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | bridge | propose-ja-edit | yes | 既存変更 | success | 74s | yes | **passed** | A | 日本語 context 正確・追加のみ・化けなし |
| B2 | bridge | propose-agents-note | no | 既存変更 | success | 37s | yes | **passed** | **D** | **既存の em dash `—` が `窶・` に文字化けして変更行に混入**（apply --check は通る） |
| B3 | bridge | propose-glossary | no | 新規作成 | success | 38s | yes | passed | A | 回帰確認 |
| B4 | bridge | propose-delete | no | 削除 | success | 19s | yes | passed | A | 回帰確認 |
| B5 | bridge | propose-two-files | 混在 | 2ファイル変更 | success | 88s | yes | **passed** | A | README＋setup.md（日本語含む）・追加のみ・化けなし |
| B6 | workflow | propose-usage-gitignore-note | yes | 別repo×既存変更 | success | 76s | yes | **passed** | A | 日本語 context 正確・追加のみ・化けなし |

集計: 6件。**A: 5 / D: 1 / E: 0**。**apply --check 通過率 6/6 = 100%**（Phase 2A の 29% から激変）。
全件で working tree 変更ゼロ・temp worktree 残骸なし・HEAD 不変・tools/list は2つのみ。

### Phase 2A vs 2B′（同一の既存ファイル変更4ケース）

| ケース | 2A（手書き diff） | 2B′（bridge-applied） |
|---|---|---|
| JA 既存変更 | ❌ patch does not apply | ✅ A |
| EN 既存変更 | ❌ patch does not apply | ⚠ D（apply 通るが em dash 化け） |
| 2ファイル変更 | ❌ corrupt patch | ✅ A |
| 別repo×JA | ❌ corrupt patch | ✅ A |

→ **diff の構造破壊（context/hunk ズレ）は B′ で完全に解消**（Git が diff を生成するため原理的に正確）。

### 新発見と運用上の重要な制約

1. **B′ は diff 構造は正確だが、内容の文字化けまでは保証しない**: Codex がファイル全体を
   再生成する際、既存の非ASCII**記号**（em dash `—` U+2014）が確率的に文字化けする
   （B2 で発生、B1/B5/B6 の日本語ひらがな・漢字では未発生）。化けた行は変更行として
   diff に出るため `apply --check` は通ってしまう。**apply --check 通過 = 構造的に正しい、
   だが内容の正しさ（文字化けなし）は保証しない**
2. **安全網は機能**: 文字化けは diff に `-`/`+` として可視化され、人間レビューで検出可能
   （実際この field test でも即座に検出できた）。working tree は全件不変
3. **運用ルール（決定）**: B′ の出力 diff は**必ず人間がレビューし、特に非ASCII記号の
   文字化けを確認する**。自動適用（Phase 3）に進む前にこの検出を担保する設計が必須
4. 文字化けの自動検出は初期実装では見送り（`窶` 等は合法な日本語文字でもあり誤検知が多い。
   堅牢な mojibake 検出は別課題）。レビュー必須の運用で対処

### Phase 3 着手ゲート 再評価

- [x] codex_propose_patch 実走 5件以上（既存ファイル変更・日本語含む）— B′ で6件
- [x] すべての実走で working tree 変更ゼロ
- [x] **apply --check 通過率が運用に耐える水準（100% ≥ 70%）— Strategy B′ で達成**
- [x] tools/list が codex_plan / codex_propose_patch の2つのみ
- [ ] **B′ 固有リスク（非ASCII記号の文字化け）への対処方針が Phase 3 設計に織り込まれている**
- [ ] Phase 3 の承認ゲート設計（approval 厳密判定・適用前 clean tree 必須・rollback）レビュー

**判定: 構造的 diff 品質ゲートは通過。ただし Phase 3（自動適用）の前に、文字化け検出を
レビュー必須として担保する設計が条件。** B′ の diff はそのままでは「apply 可能」だが
「内容が正しい」とは限らないため、適用の自動化は文字化け対策とセットで設計する。

---

## Phase 2B′-minor: 文字化け緩和テスト（プロンプト制約）

B2 の em dash 文字化けに対し、B′ プロンプトへ非ASCII保持制約を追加して再検証した。

追加した制約（要旨）: "Preserve all existing non-ASCII characters EXACTLY ... Do not
normalize ... em/en dashes, curly quotes, Japanese text ... For lines you are not changing,
copy them byte-for-byte from the original file. Treat the file as UTF-8."

| No | Target | Handoff | 結果 |
|---|---|---|---|
| B7 | bridge | propose-agents-note（B2 の再実走） | **緩和無効** — em dash `—` が依然 `窶・` に文字化け（変更していない既存行まで -/+ で出た） |
| — | bridge | propose-design-note（日本語＋em dash 混在） | ctx_shell の 120s 制限で中断（大ファイルで処理長）。worktree 残骸が残り手動 cleanup（下記） |

### 結論（確定）

1. **プロンプト緩和は無効**。文字化けは Codex 側のエンコーディング問題であり、bridge の
   プロンプトでは解決できない
2. **化けているのは Codex の出力時点**: bridge は stdout を UTF-8 で読んでおり、同一 JSON
   内の日本語（かな・漢字）は正しく復元される。にもかかわらず em dash だけ `窶`（U+7AB6＝
   UTF-8 バイト E2 80 を CP932 誤解釈した時の典型）に化ける → Codex がファイルを読む/出力する
   過程で特定の非ASCII記号にエンコーディング変換ミスが起きている（文字種依存）
3. bridge 側で完全な自動検出は困難（`窶` は合法な日本語文字でもあり誤検知が多い）

### 対策方針（Phase 3 設計へ）

文字化けは **Phase 3 の承認ゲートで吸収する** — `codex_apply` は適用前に diff を提示し、
人間が内容（文字化け含む）を確認して `approval=true` を返したときのみ適用する。承認の瞬間が
そのままレビューになる。補助として、bridge が diff サマリに「非ASCII を含む変更行数」を
警告表示することは安価で有効（実装は Phase 3 とあわせて検討）。

### 運用知見: 大ファイル × 親プロセス強制終了で worktree 残骸

design.md（大）は Codex 処理が長く、親プロセス（ここでは ctx_shell の 120s 制限）が
bridge を強制終了すると finally の cleanup が走らず worktree が残った。本体 porcelain は
不変（安全性は保持）。手動復旧: 孤立した codex プロセスを停止 → `git worktree remove --force`
→ `git worktree prune` → temp ディレクトリ削除。**大ファイルの実走は bridge の timeout
（既定 300s）以上の余裕を持って実行する**こと（短い親タイムアウトで切らない）。
