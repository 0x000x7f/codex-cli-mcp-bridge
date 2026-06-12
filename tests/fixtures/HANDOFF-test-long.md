# HANDOFF: structured-logging（長文テスト用フィクスチャ）

> 長い HANDOFF に対する codex_plan の耐性（timeout・計画品質の劣化）を検証するための架空タスク。
> 計画立案のみ。実装は行われない。

## 1. 目的

bridge 全体（src/ 配下）に構造化ログを導入するための実装計画を立てる。
現在のログは `console.error` による単発のテキスト行のみで、以下の課題がある:

- ログレベル（debug / info / warn / error）の区別がない
- codex 実行1回分のログを相関させる ID がない
- タイムアウトや異常終了の事後解析に必要な情報（経過時間・引数の要約）が揃わない
- MCP の仕様上 stdout はトランスポート専用のため、すべて stderr に出す制約がある

## 2. 背景・調査結果

### 2.1 現状のログ出力箇所

- `src/server.ts` — 起動時の ready 行（workspace と tools の表示）
- `src/tools/codex-plan.ts` — handoff の path とサイズ（本文は出さない、security.md §6 準拠）
- それ以外のモジュール（spawn / parse / guard）はログを出していない

### 2.2 制約となる既存設計

- stdout は MCP トランスポート専用。**ログは stderr のみ**
- HANDOFF 本文・Codex への prompt 全文・Codex の応答全文はログに出さない（機密・サイズの両面）
- 依存追加は慎重に。ゼロ依存（手書きの小さな logger）を第一候補として検討する
- Windows でも文字化けしない出力（ASCII セーフなキー名、値は UTF-8）

### 2.3 参考にすべきファイル

- docs/security.md — §6 機密情報の扱い（ログ方針の上位ルール）
- docs/design.md — §4 セッション管理（ステートレス設計。ログも1実行単位で完結させたい）
- src/codex/spawn.ts — タイムアウト処理（kill 時のログが現状ない）
- src/codex/parse-output.ts — パース失敗時の rawOutput の扱い（全文 throw に載せている。ログ側の上限要検討）

## 3. 設計・方針（候補）

### 3.1 logger の形

- `src/logging/logger.ts` を新設し、`log(level, event, fields)` 形式の関数を提供する
- 出力は1行 JSON（stderr）。例: `{"ts":"...","level":"info","event":"codex.spawn","run_id":"...","fields":{...}}`
- `run_id` は codex 実行1回ごとに採番し、spawn → 出力受信 → 終了/タイムアウト → パースの各イベントを相関させる

### 3.2 導入箇所（想定）

- spawn 開始時: コマンド種別・args の**形だけ**（prompt 本文は含めない）・timeout 値
- 終了時: exitCode・経過 ms・stdout/stderr のバイト数（内容は出さない）
- タイムアウト時: kill の方式（taskkill / SIGKILL）と pid
- guard 拒否時: 拒否理由の種別（absolute / outside / not-found / not-file）— path 自体は relPath のみ
- パース失敗時: 行数・JSON として解釈できた行数・エラー種別（rawOutput 全文は出さない）

### 3.3 設定

- `CODEX_BRIDGE_LOG_LEVEL`（既定 info。debug で詳細化）
- ログ無効化は想定しない（最低限 error は常時）

## 4. 対象ファイル

- 変更可: `src/logging/logger.ts`（新規）、`src/server.ts`、`src/tools/codex-plan.ts`、
  `src/codex/spawn.ts`、`src/codex/parse-output.ts`、`src/safety/workspace-guard.ts`
- 読むだけ: `docs/security.md`、`docs/design.md`、`tests/`
- 触ってはいけない: `.mcp.json`、`package.json` の dependencies（devDependencies 含め追加しない前提で計画する）

## 5. 制約・禁止事項

- これは計画立案のみのタスク。ファイル変更は後続フェーズで行う
- patch / unified diff / 貼り付け用コードの生成は禁止
- ログに HANDOFF 本文・prompt 全文・応答全文を含める設計は提案しない
- stdout への出力を伴う設計は提案しない（MCP トランスポート破壊）
- 外部ロギングサービス・ネットワーク送信を伴う設計は提案しない

## 6. テストコマンド

- `npm test`（既存 13 件が通ること）
- logger 単体のテスト追加方針も計画に含めること（node:test、追加依存なし）

## 7. 完了条件（後続フェーズでの実装に対する受け入れ基準）

- [ ] logger のインターフェース案（関数シグネチャ・イベント名の一覧）が示されている
- [ ] 各モジュールへの導入ポイントが網羅されている（spawn / timeout / guard / parse / server）
- [ ] security.md §6 と矛盾しないことの確認結果が示されている
- [ ] run_id の採番方式と相関の設計が示されている
- [ ] ログ肥大化への対策（レベル・サイズ上限）が示されている
- [ ] テスト方針（何を node:test で検証するか）が示されている
- [ ] 段階導入の順序（どのファイルから入れるか）が示されている

## 8. リスク・未解決点（計画側で評価してほしい点）

- stderr への JSON 行出力が、Claude Code 側の MCP ログ表示でどう見えるか（可読性）
- parse-output の rawOutput 添付（最大4000字）とログ上限の整合
- guard 拒否ログが攻撃者へのヒントにならないか（外部公開時の考慮）
- 1行 JSON の ts フィールドのタイムゾーン表記（UTC 固定か local か）

## 9. レビュー方法

完了後、人間が計画を読みレビューする。観点: §7 の受け入れ基準の網羅性、§5 の禁止事項への抵触有無。
