# HANDOFF: propose-agents-note (existing-EN-file modification field test)

> Field test: a diff modifying an existing English file. Proposal only.

## 1. Goal

Add one bullet to the "Validation" section of `AGENTS.md`: before proposing changes,
agents should also check `docs/ops/` validation logs to understand the current phase gate.

## 2. Requirements

- Modify `AGENTS.md` only
- Add exactly one bullet to the existing Validation list, matching its style
- Do not rewrite or reformat existing lines

## 3. Constraints

- Git unified diff, single ```diff fence
- No changes to any other file

## 4. Done criteria

- [ ] An addition-only diff against AGENTS.md
