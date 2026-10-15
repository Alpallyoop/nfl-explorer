"use strict";
// NFL Explorer -> NFL HTTP API (nfl.api.v1) client. Used by the Electron main process and by tests.
// The explorer owns no ledger state: every read and write is an nfl.api.v1 call, and an unreachable NFL is
// reported as "unavailable", never replaced by local data.

const DEFAULT_BASE = "http://127.0.0.1:8086";

// The only operations the UI may ask for. Anything else is refused before a request is made.
const OPS = {
  health:        { method: "GET",  path: () => "/health" },
  lookup:        { method: "GET",  path: (p) => "/lookup?hash=" + encodeURIComponent(reqStr(p, "hash")) },
  verifySha256:  { method: "POST", path: () => "/verify", body: (p) => ({ sha256: reqStr(p, "sha256") }) },
  verifyPath:    { method: "POST", path: () => "/verify", body: (p) => ({ file: reqStr(p, "file") }) },
  commit:        { method: "POST", path: () => "/commit", body: (p) => ({ hash: reqStr(p, "hash"), artifact: optStr(p, "artifact") }) },
  recent:        { method: "GET",  path: (p) => "/recent?limit=" + limit(p) },
  chain:         { method: "GET",  path: () => "/ledger/chain" },
  receiptVerify: { method: "POST", path: () => "/receipt/verify", body: (p) => ({ lines: lines(p) }) },
  receiptWitness:{ method: "POST", path: () => "/receipt/witness", body: (p) => ({ lines: lines(p) }) },
  integrations:  { method: "GET",  path: () => "/integrations" },
  receipts:      { method: "GET",  path: (p) => "/receipts?limit=" + limit(p) + (p && p.packet_id ? "&packet_id=" + encodeURIComponent(String(p.packet_id)) : "") },
  ingestLastRun: { method: "GET",  path: () => "/ingest/last-run" },
  ingestRuns:    { method: "GET",  path: (p) => "/ingest/runs?limit=" + limit(p) },
  ingestFailures:{ method: "GET",  path: (p) => "/ingest/failures?limit=" + limit(p) },
  ingestControl: { method: "POST", path: () => "/ingest/control", body: (p) => ({ action: ingestAction(p) }) }
};

function reqStr(p, k) {
  const v = p && typeof p[k] === "string" ? p[k].trim() : "";
  if (!v) throw new ClientError("MISSING_" + k.toUpperCase());
  return v;
}
function optStr(p, k) { return p && typeof p[k] === "string" ? p[k] : ""; }
function limit(p) {
  const n = p && Number.isInteger(p.limit) ? p.limit : 50;
  if (n < 1 || n > 1000) throw new ClientError("BAD_LIMIT");
  return n;
}
function lines(p) {
  const raw = p && Array.isArray(p.lines) ? p.lines : [];
  const out = raw.filter((l) => typeof l === "string" && l.length > 0);
  if (out.length === 0) throw new ClientError("MISSING_RECEIPT");
  if (out.length > 1000) throw new ClientError("TOO_MANY_RECEIPTS");
  return out;
}
function ingestAction(p) {
  const a = p && p.action;
  if (!["status", "run-once"].includes(a)) throw new ClientError("BAD_ACTION"); // start/stop stay on the NFL host
  return a;
}

class ClientError extends Error {
  constructor(token) { super(token); this.token = token; }
}

function normalizeBase(base) {
  const b = String(base || DEFAULT_BASE).trim().replace(/\/+$/, "");
  let u;
  try { u = new URL(b); } catch { throw new ClientError("BAD_API_BASE"); }
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(u.hostname)) throw new ClientError("API_BASE_NOT_LOOPBACK");
  return b;
}

// Returns { ok, unavailable, status, httpStatus, data, error }
async function call(base, op, params, opts) {
  const spec = OPS[op];
  if (!spec) return { ok: false, unavailable: false, status: "REFUSED", httpStatus: 0, data: null, error: "UNKNOWN_OPERATION" };
  let url, init;
  try {
    url = normalizeBase(base) + spec.path(params || {});
    init = { method: spec.method, headers: { accept: "application/json" } };
    if (spec.body) { init.body = JSON.stringify(spec.body(params || {})); init.headers["content-type"] = "application/json"; }
  } catch (e) {
    return { ok: false, unavailable: false, status: "REFUSED", httpStatus: 0, data: null, error: e.token || String(e.message || e) };
  }
  const timeoutMs = (opts && opts.timeoutMs) || 20000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, unavailable: true, status: "UNAVAILABLE", httpStatus: 0, data: null, error: ctl.signal.aborted ? "NFL_TIMEOUT" : "NFL_UNREACHABLE" };
  }
  clearTimeout(timer);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { return { ok: false, unavailable: false, status: "BAD_RESPONSE", httpStatus: res.status, data: null, error: "NFL_BAD_RESPONSE" }; }
  const status = data && typeof data.status === "string" ? data.status : "BAD_RESPONSE";
  const ok = res.status >= 200 && res.status < 300 && status !== "ERROR";
  return { ok, unavailable: false, status, httpStatus: res.status, data, error: ok ? null : (data && data.message) || status };
}

module.exports = { call, normalizeBase, OPS, DEFAULT_BASE, ClientError };
