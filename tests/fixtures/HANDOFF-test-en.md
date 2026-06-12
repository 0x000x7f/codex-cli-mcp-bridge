# HANDOFF: glossary-section-en (test fixture)

> English-language fixture for validating codex_plan read-only behavior. Planning only.

## 1. Goal

Produce an implementation plan for adding a Glossary section to docs/design.md.

## 2. Background / findings

- docs/design.md defines three staged tools (codex_plan / codex_propose_patch / codex_apply)
- Terms such as MCP, handoff, workspace guard, and approval gate lack a single place of definition

## 3. Approach

- Consider appending a "## Glossary" section near the end of design.md
- Selection criterion: terms used at least twice across the repository docs

## 4. Files

- Read only: docs/design.md, docs/security.md, README.md

## 5. Constraints

- Planning-only task; file changes happen in a later phase
- Do not produce patches, diffs, or paste-ready code

## 6. Test commands

- None (documentation only)

## 7. Done criteria

- [ ] A list of glossary terms and a placement proposal
- [ ] Risks / open questions enumerated

## 8. Review

- A human reviews the plan
