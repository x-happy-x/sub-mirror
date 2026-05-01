import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function importSubscriptionModule() {
  return import(`./subscription.js?case=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

test("extractHappDecryptResult parses result block", async () => {
  const { extractHappDecryptResult } = await importSubscriptionModule();
  const output = [
    "Input",
    "  happ://crypt/some-value/",
    "",
    "Result",
    "  https://example.com/sub?token=123",
  ].join("\n");

  assert.equal(extractHappDecryptResult(output), "https://example.com/sub?token=123");
});

test("decryptHappLink invokes binary with one argument for crypt5 links", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "happ-decrypt-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.HAPP_DECRYPT_BIN;
  });
  const binPath = path.join(tempDir, "happ-decrypt-stub.sh");
  fs.writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "if [ \"$#\" -ne 1 ]; then",
      "  echo \"Error\"",
      "  echo \"  expected exactly one argument, got $#\"",
      "  exit 1",
      "fi",
      "echo \"Input\"",
      "echo \"  $1\"",
      "echo",
      "echo \"Result\"",
      "echo \"  https://decoded.example/sub\"",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(binPath, 0o755);
  process.env.HAPP_DECRYPT_BIN = binPath;

  const { decryptHappLink } = await importSubscriptionModule();
  const result = await decryptHappLink("happ://crypt5/some-encrypted-value/");

  assert.equal(result.ok, true);
  assert.equal(result.originalUrl, "happ://crypt5/some-encrypted-value/");
  assert.equal(result.resolvedUrl, "https://decoded.example/sub");
  assert.equal(result.changed, true);
});
