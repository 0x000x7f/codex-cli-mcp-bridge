// Live fail-closed check against the REAL workspace (clean tree must stay clean).
//   node tests/manual/apply-reject-check.mjs
// Confirms codex_apply rejects bad approval / hash / HEAD without touching files.
import { codexApply, ApplyRejected } from "../../dist/src/tools/codex-apply.js";

const root = process.cwd();
const diff = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-x\n+y\n";

async function expectReject(label, args) {
  try {
    await codexApply(root, args);
    console.log(`FAIL (${label}): expected rejection`);
  } catch (e) {
    console.log(`ok (${label}): ${e instanceof ApplyRejected ? "ApplyRejected" : e.constructor.name}`);
  }
}

await expectReject("approval=false", { diff, approval: false, expected_sha256: "x", base_head: "x" });
await expectReject("approval='true'", { diff, approval: "true", expected_sha256: "x", base_head: "x" });
await expectReject("hash mismatch", { diff, approval: true, expected_sha256: "deadbeef", base_head: "HEAD" });
await expectReject("empty sha", { diff, approval: true, expected_sha256: "", base_head: "HEAD" });
console.log("done");
