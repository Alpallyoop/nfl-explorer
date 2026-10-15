# NFL Explorer

Desktop explorer UI for the Never Forgetting Ledger (NFL). Constellation service `nfl-explorer`, family
`covenant`, layer `application.ledger-explorer`, upstream `nfl`.

It shows what NFL holds and lets an operator use NFL's own operations. It owns no ledger state: every read and
write is a call to NFL's local HTTP API (`nfl.api.v1`). If NFL is not running the explorer says so and shows
nothing else; it never reads or writes NFL's files and never invents data.

## What it does

| View | NFL call |
|---|---|
| Overview: record count, self-chain status and head, registry copy, last ingest run | `GET /health`, `GET /ingest/last-run` |
| Lookup a hash (every matching record) | `GET /lookup` |
| Verify a file: hashed on this computer, only the SHA-256 is sent | `POST /verify {sha256}` |
| Commit a hash with a label (or pick a file to hash) | `POST /commit` |
| Integration receipts: verify or witness `constellation.integration.receipt.v1` lines | `POST /receipt/verify`, `POST /receipt/witness` |
| Ledger: most recent records with `seq` / `prev` | `GET /recent` |
| Integrations NFL takes part in | `GET /integrations` |
| Ingest: inbox states, failures and refusals, `nfl.receipt.v1` receipts, schedule status, run once | `GET /ingest/*`, `GET /receipts`, `POST /ingest/control` (status, run-once only) |

## How it is built

- `electron/nflClient.cjs` is the only code that talks to NFL: an allow-list of 15 operations, input checks
  before any request, loopback-only API base, and an explicit `UNAVAILABLE` result when NFL cannot be reached.
- `electron/main.cjs` runs it in the main process. The window is sandboxed (`contextIsolation`, `sandbox`, no
  Node), cannot navigate or open windows, and the production page carries a strict Content-Security-Policy.
  `electron/preload.cjs` exposes three calls: `config`, `request(op, params)`, `hashFile`.
- `npm run dev` (browser) uses the same client through a Vite dev-server bridge (`/__nfl/request`).
- The API base is `NFL_API_BASE` (default `http://127.0.0.1:8086`).

## Run

```powershell
npm ci
# NFL API first (in the nfl repository): NFL_Runtime.cmd, or scripts\nfl_api_v1.ps1 -RepoRoot . -Prefix http://127.0.0.1:8086/
npm run desktop     # Electron window against the Vite dev server
npm run dev         # browser at http://127.0.0.1:5173/
npm run build       # type-check + production bundle in dist/
npm start           # Electron on the built dist/
npm run dist        # Windows installer (electron-builder, NSIS) in dist-electron/
```

From the NFL repository, `NFL_Ops_Launcher.cmd` starts the API and this app together.

## Test

```powershell
npm run lint
npm test            # client allow-list, validation, unavailable state; plus a contract test against a real
                    # NFL API on a throwaway ledger (needs the sibling ../nfl or NFL_REPO, and PowerShell;
                    # reported as skipped, not passed, when either is missing)
```

## Working remotely

Commands run and passing in a Linux cloud session on 2026-10-15 (Node 22, PowerShell 7.4.6 for the contract test):
`npm ci --ignore-scripts`, `npm run build`, `npm run lint`, `NFL_REPO=../nfl npm test` (5/5), and the UI was
exercised headless against a live NFL API. Only on Windows: `npm run desktop` / `npm start` (Electron needs its
binary: run plain `npm ci`, without `--ignore-scripts`) and `npm run dist`.

## Layout note

Until 2026-10-15 the app lived in a nested `nfl-explorer/nfl-explorer` git repository with a placeholder remote,
so the registered folder held only Constellation's files. The app now sits at the repository root; the old
nested history (one commit, `efd5b93`) is kept untracked in `.scratch/legacy-inner-git/`.
