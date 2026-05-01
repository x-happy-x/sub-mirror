import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MAX_SNAPSHOTS_PER_FEED } from "./config.js";
import { pruneSubscriptionFeedSnapshots } from "./sqlite-store.js";

const DATA_ROOT_DIR = path.resolve(process.env.SUB_MIRROR_DATA_DIR || "/data");
const SNAPSHOT_ROOT_DIR = path.join(DATA_ROOT_DIR, "snapshots");
const RAW_SNAPSHOT_DIR = path.join(SNAPSHOT_ROOT_DIR, "raw");
const NORMALIZED_SNAPSHOT_DIR = path.join(SNAPSHOT_ROOT_DIR, "normalized");

function ensureSnapshotDirs() {
  for (const dir of [SNAPSHOT_ROOT_DIR, RAW_SNAPSHOT_DIR, NORMALIZED_SNAPSHOT_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function writeFileAtomic(filePath, body) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, filePath);
}

function writeRawSourceSnapshotBody(snapshotId, body) {
  const id = String(snapshotId || "").trim();
  if (!id) throw new Error("snapshotId is required");
  ensureSnapshotDirs();
  const text = String(body || "");
  const filePath = path.join(RAW_SNAPSHOT_DIR, `${id}.body`);
  writeFileAtomic(filePath, text);
  return {
    path: filePath,
    sha256: sha256Text(text),
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

function writeNormalizedSnapshotFile(snapshotId, value) {
  const id = String(snapshotId || "").trim();
  if (!id) throw new Error("snapshotId is required");
  ensureSnapshotDirs();
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
  const filePath = path.join(NORMALIZED_SNAPSHOT_DIR, `${id}.json`);
  writeFileAtomic(filePath, text);
  return {
    path: filePath,
    sha256: sha256Text(text),
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

function readSnapshotFile(filePath) {
  return fs.readFileSync(String(filePath || ""), "utf8");
}

function deleteSnapshotFile(filePath) {
  const target = String(filePath || "").trim();
  if (!target) return false;
  if (!fs.existsSync(target)) return false;
  fs.unlinkSync(target);
  return true;
}

async function pruneStoredSnapshots(feedId, retainCount = MAX_SNAPSHOTS_PER_FEED) {
  const removed = await pruneSubscriptionFeedSnapshots(feedId, retainCount);
  for (const item of removed) {
    deleteSnapshotFile(item.bodyPath);
    deleteSnapshotFile(item.normalizedPath);
  }
  return removed;
}

export {
  SNAPSHOT_ROOT_DIR,
  RAW_SNAPSHOT_DIR,
  NORMALIZED_SNAPSHOT_DIR,
  ensureSnapshotDirs,
  writeRawSourceSnapshotBody,
  writeNormalizedSnapshotFile,
  readSnapshotFile,
  deleteSnapshotFile,
  pruneStoredSnapshots,
};
