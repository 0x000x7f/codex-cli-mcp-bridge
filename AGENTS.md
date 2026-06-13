# AGENTS.md

## Purpose

This repository is an experimental MCP bridge that lets Claude Code invoke Codex CLI
through staged, safety-gated tools. Phases 1–3 are implemented: `src/` contains a
TypeScript MCP server exposing three tools — `codex_plan` (read-only planning),
`codex_propose_patch` (read-only Git unified diff proposal, validated with
`git apply --check`, never applied), and `codex_apply` (the ONLY mutating tool — applies a
reviewed, exact diff to the working tree).

## Rules for coding agents

- `codex_apply` must NOT call Codex. It deterministically applies a diff that
  codex_propose_patch produced and a human approved, requiring `approval === true` plus
  `expected_sha256` and `base_head`. It applies to the working tree only and never stages
  or commits. Do not weaken these fail-closed checks.
- `codex_propose_patch` must never apply, commit, or stage the proposed patch — it only
  returns validated diff text plus its sha256 / base_head / review hints.
- Do not modify unrelated files.
- Keep diffs small and reviewable.
- Do not assume access to previous chat context; everything you need must be in this
  repository or the task instructions.
- Report changed files and remaining risks when you finish.

## Validation

Before proposing changes, check consistency across the three design documents:

- `docs/design.md` — tool specifications (`codex_plan` / `codex_propose_patch` / `codex_apply`)
  and phase boundaries
- `docs/security.md` — the non-mutating default and the approval gate must never be weakened
- `docs/comparison-with-markdown-handoff.md` — the Markdown handoff workflow remains the
  documented fallback; do not describe it as deprecated
