# HANDOFF: propose-delete (file-deletion field test)

> Field test for deletion-form diffs (`+++ /dev/null`). Proposal only.

## 1. Goal

Propose a patch that deletes `tests/fixtures/disposable-note.txt`.

## 2. Background

The file states in its own body that it exists only as a deletion target for this test.

## 3. Requirements

- Delete `tests/fixtures/disposable-note.txt` and change nothing else
- Use Git deletion form (`+++ /dev/null`)

## 4. Constraints

- Git unified diff, single ```diff fence

## 5. Done criteria

- [ ] A deletion-only diff for exactly that one file
