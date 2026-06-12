# AGENTS.md

## Purpose

This repository is an experimental MCP bridge that lets Claude Code invoke Codex CLI
through staged, safety-gated tools. Phase 1 is implemented: `src/` contains a TypeScript
MCP server exposing exactly one tool, `codex_plan` (strictly read-only).

## Rules for coding agents

- Do not add `codex_propose_patch` / `codex_apply` (or any mutating tool) unless the task
  explicitly starts Phase 2 or Phase 3. The MCP tools/list must keep exposing only
  `codex_plan` until then.
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
