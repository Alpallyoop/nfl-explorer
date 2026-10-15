# Proposal 0001 - NFL Explorer ownership, boundaries and contract

Status: proposed 2026-10-15. For Constellation (`registry/services.json`, service `nfl-explorer`), whose record
has `owns: []` and `does_not_own: []` ("UNCLASSIFIED").

## Proposed registry values

**owns**
- Presenting NFL's ledger, chain status, integration receipts, registered integrations and ingest state to an operator
- Operator-initiated NFL operations through `nfl.api.v1` (lookup, verify, commit, receipt verify / witness, ingest status / run once)
- Hashing a local file on the operator's computer before asking NFL about it

**does_not_own**
- Ledger storage, record format or chain (nfl)
- Deciding what is verified, witnessed or refused (nfl)
- Trust, signer lists or keys (neverlost)
- Packet-law verification (cpr)
- Starting, stopping or scheduling NFL ingest (nfl host; the explorer can only ask for status or one run)

**upstream_services:** `nfl` (unchanged). **contract_families:** none of its own; consumes `nfl.api.v1`.

## Integration record to add

`nfl-explorer > nfl`, contract `nfl.api.v1`, strength strong. Receipts: the explorer is an interactive operator
console; proposal 0013 says every integration writes a `constellation.integration.receipt.v1` per exchange.
Decision needed: either record that operator-console reads are exempt, or the explorer writes receipts for its
writes (`commit`, `receipt/witness`, `ingest/control`) into its own evidence folder `runtime/receipts/`
and offers them to NFL. Until decided, nothing is emitted and the record should stay `specified`.

## Conflicts reported (not changed here)

- `docs/canonical/ECOSYSTEM_INTEGRATION.md` says family `fides`; the registry and `project.contract.json` say
  `covenant`. The document is managed by Constellation and should be regenerated.
- The registered repository folder was not the git repository (the app was a nested repo with a placeholder
  remote). Fixed in this repository on 2026-10-15 by moving the app to the root.

## Compatibility

The old renderer called `window.NFL.getState(url)` (which returned state, not a response) and the main process
wrote straight into `C:\dev\nfl\data\ledger.ndjson`, bypassing NFL's lock and chain, and faked ingest runs
(`INGEST_OK` with zero counts). That code is removed; there is no other consumer of it.
