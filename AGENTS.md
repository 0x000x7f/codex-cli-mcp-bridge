# AGENTS.md

## Purpose

This repository is the design-phase (Phase 0) home of an experimental MCP bridge that will
let Claude Code invoke Codex CLI through staged, safety-gated tools. At this phase the
repository intentionally contains **documentation only** — there is no `src/` directory yet.

## Rules for coding agents

- Phase 0 is documentation-only. Do not add source code, package manifests, or build
  configuration unless the task explicitly starts Phase 1.
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
