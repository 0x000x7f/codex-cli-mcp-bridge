# AGENTS.md

## Purpose

This repository is an experimental MCP bridge that lets Claude Code invoke Codex CLI
through staged, safety-gated tools. Phases 1 and 2 are implemented: `src/` contains a
TypeScript MCP server exposing exactly two read-only tools — `codex_plan` (planning) and
`codex_propose_patch` (Git unified diff proposal, validated with `git apply --check`,
never applied).

## Rules for coding agents

- Do not add `codex_apply` (or any tool that mutates the working tree) unless the task
  explicitly starts Phase 3. The MCP tools/list must keep exposing only `codex_plan` and
  `codex_propose_patch` until then.
- `codex_propose_patch` must never apply, commit, or stage the proposed patch — it only
  returns validated diff text.
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
