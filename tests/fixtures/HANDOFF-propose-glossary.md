# HANDOFF: propose-glossary (patch-proposal test)

> Real task used to validate codex_propose_patch. The expected output is a small
> Git unified diff that CREATES one new file. The tool never applies the patch.

## 1. Goal

Create a new file `docs/glossary.md` defining the project's core terms in English.

## 2. Background / findings

- Terms like MCP, handoff document, workspace guard, approval gate, and the staged tools
  appear across README.md, docs/design.md, and docs/security.md but are not defined in
  one place
- A NEW file avoids modifying existing (Japanese) documents

## 3. Requirements for the change

- Exactly one new file: `docs/glossary.md`
- At most 40 lines
- English only
- Define at least: MCP, handoff document, workspace guard, approval gate,
  staged tools (codex_plan / codex_propose_patch / codex_apply), Markdown handoff fallback
- Definitions must stay consistent with docs/design.md and docs/security.md
  (e.g., codex_plan is read-only; codex_apply requires explicit approval and is not implemented)

## 4. Files

- Create: `docs/glossary.md` (new file only — do not modify any existing file)
- Read: README.md, docs/design.md, docs/security.md

## 5. Constraints

- The diff must be Git format, new-file form (`--- /dev/null`)
- Do not modify or reformat any existing file

## 6. Done criteria

- [ ] One `diff --git a/docs/glossary.md b/docs/glossary.md` section and nothing else

## 7. Review

The proposed diff is reviewed by a human. Application happens only after explicit
approval in a later phase.
