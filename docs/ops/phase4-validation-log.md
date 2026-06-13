# Phase 4 検証ログ — codex_review_patch（第三者レビュー・read-only・助言のみ）

codex_review_patch は別 Codex に diff を read-only でレビューさせる**任意の追加レイヤー**。
安全の中核（human review ＋ diff_sha256 ＋ base_head ＋ clean tree ＋ codex_apply）は不変で、
verdict は助言。検証は「束縛ゲートが効くこと」「ファイルを一切変更しないこと」「tools/list が
4つで mutating は codex_apply のみ」の3点。

## ユニットテスト（Codex 不要）

`npm test` 71/71 合格。codex_review_patch は次を網羅:
非Git/不正 diff 拒否（validateGitPatch）・hash 不一致拒否・HEAD 移動拒否・空 sha/head 拒否
（いずれも tree 不変）・レビュープロンプトが read-only/固定セクション/mojibake 低信頼注記/
review_focus を含むこと・**ソースが書き込み/apply/commit 系 API を一切持たないことの静的確認**。

## ライブ field test（実 workspace = bridge repo、v0.6.0）

手順: codex_propose_patch（HANDOFF-propose-glossary）で diff＋diff_sha256＋base_head を取得 →
同じ値で codex_review_patch を実行。

| 項目 | 結果 |
|---|---|
| review 実行 | **成功**（35.6s）。固定セクション全部（Blocking/Non-blocking/Scope creep/Oversized/Test/Security/Non-ASCII/Verdict）を返却 |
| verdict | `approve`（助言）。「ADVISORY ONLY — does not approve or apply」ヘッダ付き |
| working tree | **不変**（review は何も書かない・`git status --porcelain` 前後一致） |
| 束縛 | propose の diff_sha256/base_head をそのまま渡して通過（対象 diff に束縛） |

**相関故障のライブ実証**: reviewer が Non-ASCII セクションで自己申告 —
「LOW CONFIDENCE … **Existing repository docs displayed mojibake through my read path**,
so this is not a substitute for human review of encoding-sensitive content.」
→ Phase 2B′ で見立てた「reviewer Codex も同じ CP932 read-path を共有し mojibake を被る」が
**reviewer 自身の出力で裏付けられた**。mojibake 検出を Codex reviewer に依存しない設計判断が正しい。

## 判定

- ユニット 71/71・束縛ゲート（validate/hash/HEAD）動作・静的に書き込み能力なし
- tools/list は4つ（codex_plan / codex_propose_patch / codex_apply / codex_review_patch）、
  **mutating tool は codex_apply ただ1つ**（不変）
- verdict は助言。apply ゲートは Phase 3 のまま変更なし

## 位置づけ（再掲）

- 安全の中核: human review ＋ diff_sha256 ＋ base_head ＋ clean tree ＋ codex_apply
- codex_review_patch: それを補助する任意の second opinion。高リスク/大 diff のときに使う
- mojibake 判定は相関故障で低信頼 — 人間レビュー＋WSL2 が本丸
