import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function randomToken(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

async function importStoreModule() {
  return import(`./sqlite-store.js?case=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

test("short-link permissions deny anonymous and unrelated users by default", async (t) => {
  const ownerUsername = randomToken("owner");
  const strangerUsername = randomToken("stranger");
  const shortLinkId = randomToken("link");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sub-mirror-perms-"));
  process.env.SUB_MIRROR_DATA_DIR = tempDir;
  t.after(() => {
    delete process.env.SUB_MIRROR_DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const {
    createShortLinkRow,
    createUser,
    getShortLinkPermissions,
  } = await importStoreModule();

  await createUser({ username: ownerUsername, password: "secret123", role: "user" });
  await createUser({ username: strangerUsername, password: "secret123", role: "user" });
  await createShortLinkRow(shortLinkId, {
    title: "Private sub",
    ownerUsername,
    params: {
      endpoint: "last",
      output: "yml",
      sub_url: "https://example.com/sub",
    },
  });

  const anonymous = await getShortLinkPermissions(shortLinkId, { username: "", role: "user" });
  assert.equal(anonymous?.canView, false);
  assert.equal(anonymous?.canEdit, false);
  assert.equal(anonymous?.accessLevel, "");

  const stranger = await getShortLinkPermissions(shortLinkId, { username: strangerUsername, role: "user" });
  assert.equal(stranger?.canView, false);
  assert.equal(stranger?.canEdit, false);
  assert.equal(stranger?.accessLevel, "");

  const owner = await getShortLinkPermissions(shortLinkId, { username: ownerUsername, role: "user" });
  assert.equal(owner?.canView, true);
  assert.equal(owner?.canEdit, true);
  assert.equal(owner?.accessLevel, "edit");
});
