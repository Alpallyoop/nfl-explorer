"use strict";
// Tests for electron/nflClient.cjs - the only code in NFL Explorer that talks to NFL.
// Part 1 needs nothing. Part 2 runs against a real NFL API (sibling ../nfl or NFL_REPO) on a throwaway
// ledger; it is reported as skipped, never as passed, when NFL or PowerShell is not available.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const client = require("../electron/nflClient.cjs");

test("unknown operation is refused without a request", async () => {
  const r = await client.call("http://127.0.0.1:1", "deleteEverything", {});
  assert.equal(r.status, "REFUSED"); assert.equal(r.error, "UNKNOWN_OPERATION"); assert.equal(r.unavailable, false);
});

test("non-loopback API base is refused", async () => {
  const r = await client.call("http://example.com:8086", "health", {});
  assert.equal(r.status, "REFUSED"); assert.equal(r.error, "API_BASE_NOT_LOOPBACK");
  assert.throws(() => client.normalizeBase("https://127.0.0.1:8086"), /API_BASE_NOT_LOOPBACK/);
});

test("input validation happens before any request", async () => {
  for (const [op, p, tok] of [["lookup", {}, "MISSING_HASH"], ["commit", { hash: "  " }, "MISSING_HASH"], ["recent", { limit: 0 }, "BAD_LIMIT"],
    ["receiptWitness", { lines: [] }, "MISSING_RECEIPT"], ["ingestControl", { action: "stop" }, "BAD_ACTION"], ["ingestControl", { action: "start" }, "BAD_ACTION"]]) {
    const r = await client.call("http://127.0.0.1:1", op, p);
    assert.equal(r.status, "REFUSED", op); assert.equal(r.error, tok, op);
  }
});

async function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
}

test("NFL unreachable is reported as unavailable, not as data", async () => {
  const port = await freePort();
  const r = await client.call("http://127.0.0.1:" + port, "health", {}, { timeoutMs: 3000 });
  assert.equal(r.ok, false); assert.equal(r.unavailable, true); assert.equal(r.status, "UNAVAILABLE"); assert.equal(r.data, null);
});

// ---- Part 2: contract against a real NFL API ---------------------------------------------------
const nflRepo = path.resolve(process.env.NFL_REPO || path.join(__dirname, "..", "..", "nfl"));
const apiScript = path.join(nflRepo, "scripts", "nfl_api_v1.ps1");
const libScript = path.join(nflRepo, "scripts", "_lib_nfl_v1.ps1");
const ps = ["pwsh", "powershell"].find((x) => spawnSync(x, ["-NoProfile", "-Command", "1"], { stdio: "ignore" }).status === 0);
const skip = !fs.existsSync(apiScript) ? "NFL repository not found (set NFL_REPO)" : !ps ? "PowerShell not found" : false;

test("contract with a real NFL API (nfl.api.v1)", { skip, timeout: 120000 }, async (t) => {
  const scratch = path.join(__dirname, "..", ".scratch");
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, "nfltest-"));
  fs.mkdirSync(path.join(root, ".constellation"), { recursive: true });
  fs.copyFileSync(path.join(nflRepo, ".constellation", "SERVICE_MAP.md"), path.join(root, ".constellation", "SERVICE_MAP.md"));
  const port = await freePort();
  const base = "http://127.0.0.1:" + port;
  const api = spawn(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", apiScript, "-RepoRoot", root, "-Prefix", base + "/"], { stdio: "ignore" });
  t.after(() => { api.kill(); fs.rmSync(root, { recursive: true, force: true }); });

  let h;
  for (let i = 0; i < 100; i++) { h = await client.call(base, "health", {}, { timeoutMs: 2000 }); if (h.ok) break; await new Promise((r) => setTimeout(r, 200)); }
  assert.equal(h.ok, true, "API did not start");
  assert.equal(h.data.ledger.present, false);

  const hash = crypto.createHash("sha256").update("nfl-explorer contract test").digest("hex");
  const c = await client.call(base, "commit", { hash, artifact: "explorer-test" });
  assert.equal(c.status, "COMMIT_OK"); assert.equal(c.data.seq, 0);
  const bad = await client.call(base, "commit", { hash: "not hex", artifact: "x" });
  assert.equal(bad.ok, false); assert.equal(bad.error, "BAD_HASH");

  const l = await client.call(base, "lookup", { hash });
  assert.equal(l.status, "FOUND"); assert.equal(l.data.artifact, "explorer-test");
  const v = await client.call(base, "verifySha256", { sha256: hash });
  assert.equal(v.status, "VERIFIED");
  const vp = await client.call(base, "verifyPath", { file: "/etc/hostname" });
  assert.equal(vp.ok, false); assert.equal(vp.error, "PATH_VERIFY_DISABLED");
  const nf = await client.call(base, "lookup", { hash: "e".repeat(64) });
  assert.equal(nf.status, "NOT_FOUND"); assert.equal(nf.ok, true);

  const rec = await client.call(base, "recent", { limit: 10 });
  assert.equal(rec.data.count, 1);
  const ch = await client.call(base, "chain", {});
  assert.equal(ch.data.ok, true); assert.equal(ch.data.chained_count, 1);

  const mk = (consumer) => spawnSync(ps, ["-NoProfile", "-Command", `. '${libScript}'; New-NflIntegrationReceiptLine -Consumer ${consumer} -Provider nfl -Outcome ok -PrevSha256 ('0'*64)`], { encoding: "utf8" }).stdout.trim();
  const good = mk("runledger"), unreg = mk("apv");
  const w = await client.call(base, "receiptWitness", { lines: [good, unreg] });
  assert.equal(w.httpStatus, 422); assert.equal(w.data.witnessed, 1); assert.equal(w.data.refused, 1);
  assert.equal(w.data.items[1].error, "RECEIPT_UNATTRIBUTED");
  const rv = await client.call(base, "receiptVerify", { lines: [good] });
  assert.equal(rv.data.items[0].status, "VERIFIED");

  const ig = await client.call(base, "integrations", {});
  assert.ok(ig.data.items.some((x) => x.consumer === "runledger" && x.provider === "nfl"));
  const lr = await client.call(base, "ingestLastRun", {});
  assert.equal(lr.status, "OK"); assert.equal(lr.data.item, null);
});
