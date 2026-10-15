import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { nfl, nflConfig, pickAndHashFile, isHexDigest, type NflResult, type HashedFile } from './nfl'

type View = 'overview' | 'lookup' | 'verify' | 'commit' | 'receipts' | 'ledger' | 'integrations' | 'ingest'
type Rec = Record<string, unknown>

const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: 'overview', label: 'Overview', hint: 'Ledger health and chain status' },
  { key: 'lookup', label: 'Lookup', hint: 'Find a committed hash' },
  { key: 'verify', label: 'Verify file', hint: 'Hash a file locally and check the ledger' },
  { key: 'commit', label: 'Commit', hint: 'Record a new hash' },
  { key: 'receipts', label: 'Integration receipts', hint: 'Verify or witness constellation.integration.receipt.v1 lines' },
  { key: 'ledger', label: 'Ledger', hint: 'Most recent records' },
  { key: 'integrations', label: 'Integrations', hint: 'Registered integrations NFL takes part in' },
  { key: 'ingest', label: 'Ingest', hint: 'Inbox ingest runs, failures and nfl.receipt.v1 receipts' },
]

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : [])

export default function App() {
  const [view, setView] = useState<View>('overview')
  const [apiBase, setApiBase] = useState('')
  const [desktop, setDesktop] = useState(false)
  const [health, setHealth] = useState<NflResult | null>(null)
  const [tick, setTick] = useState(0)
  const refreshHealth = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    nflConfig().then((c) => { setApiBase(c.apiBase); setDesktop(c.desktop) }).catch(() => setApiBase('unknown'))
  }, [])
  useEffect(() => {
    let alive = true
    nfl('health').then((r) => { if (alive) setHealth(r) })
    return () => { alive = false }
  }, [tick])

  const unavailable = health !== null && !health.ok
  const current = VIEWS.find((v) => v.key === view)!

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="eyebrow">Never Forgetting Ledger</div>
          <div className="title">NFL Explorer</div>
        </div>
        <nav>
          {VIEWS.map((v) => (
            <button key={v.key} className={'nav' + (v.key === view ? ' active' : '')} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="eyebrow">NFL API</div>
          <code>{apiBase || '...'}</code>
          <div className={'dot ' + (health === null ? 'wait' : health.ok ? 'up' : 'down')}>
            {health === null ? 'checking' : health.ok ? 'connected' : 'unavailable'}
          </div>
          <div className="muted small">{desktop ? 'desktop app' : 'browser (development)'}</div>
        </div>
      </aside>

      <main className="main">
        <header className="head">
          <h1>{current.label}</h1>
          <p className="muted">{current.hint}</p>
        </header>

        {unavailable && (
          <div className="banner bad">
            <strong>NFL is unavailable</strong> at <code>{apiBase}</code> ({s(health?.error)}). Nothing below is cached or
            invented: start the NFL API (<code>NFL_Runtime.cmd</code> or <code>scripts/nfl_api_v1.ps1</code>) and retry.
            <button className="ghost" onClick={refreshHealth}>Retry</button>
          </div>
        )}

        {view === 'overview' && <Overview health={health} onRefresh={refreshHealth} />}
        {view === 'lookup' && <Lookup />}
        {view === 'verify' && <VerifyFile desktop={desktop} />}
        {view === 'commit' && <Commit desktop={desktop} onCommitted={refreshHealth} />}
        {view === 'receipts' && <Receipts onWitnessed={refreshHealth} />}
        {view === 'ledger' && <Ledger />}
        {view === 'integrations' && <Integrations />}
        {view === 'ingest' && <Ingest />}
      </main>
    </div>
  )
}

function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && <div className="card-head"><h2>{title}</h2><div>{actions}</div></div>}
      {children}
    </section>
  )
}

function Badge({ status }: { status: string }) {
  const good = ['OK', 'FOUND', 'VERIFIED', 'COMMIT_OK', 'WITNESSED', 'ALREADY_WITNESSED', 'NFL_LEDGER_CHAIN_OK', 'NFL_RECEIPT_WITNESS_OK'].includes(status)
  const bad = ['ERROR', 'REFUSED', 'UNAVAILABLE', 'NFL_LEDGER_CHAIN_FAIL', 'NFL_RECEIPT_REFUSED', 'FORBIDDEN', 'BAD_RESPONSE'].includes(status)
  return <span className={'badge ' + (good ? 'good' : bad ? 'bad' : 'neutral')}>{status}</span>
}

function Outcome({ r }: { r: NflResult | null }) {
  if (!r) return null
  return (
    <div className={'outcome ' + (r.ok ? 'good' : 'bad')}>
      <Badge status={r.status} />
      {r.error && r.error !== r.status && <span className="mono"> {r.error}</span>}
    </div>
  )
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
    </dl>
  )
}

function Table({ cols, rows, empty }: { cols: [string, (r: Rec) => ReactNode][]; rows: Rec[]; empty: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map(([h]) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(([h, f]) => <td key={h}>{f(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

const Hash = ({ v }: { v: unknown }) => <span className="mono hash" title={s(v)}>{s(v)}</span>

function Overview({ health, onRefresh }: { health: NflResult | null; onRefresh: () => void }) {
  const [last, setLast] = useState<NflResult | null>(null)
  useEffect(() => { nfl('ingestLastRun').then(setLast) }, [health])
  const l = (health?.data?.ledger ?? {}) as Rec
  const run = (last?.data?.item ?? null) as Rec | null
  return (
    <div className="grid2">
      <Card title="Ledger" actions={<button className="ghost" onClick={onRefresh}>Refresh</button>}>
        {!health ? <p className="muted">Checking...</p> : !health.ok ? <Outcome r={health} /> : (
          <KV rows={[
            ['records', s(l.count)],
            ['self-chain', l.chain_ok ? <Badge status="NFL_LEDGER_CHAIN_OK" /> : <span><Badge status="NFL_LEDGER_CHAIN_FAIL" /> <span className="mono">{s(l.chain_error)}</span></span>],
            ['unchained prefix', s(l.unchained_prefix) + ' (records written before self-chaining)'],
            ['chained records', s(l.chained_count)],
            ['chain head', <Hash v={l.head} />],
            ['Constellation registry copy', s(health.data?.registry)],
          ]} />
        )}
      </Card>
      <Card title="Last ingest run">
        {!last ? <p className="muted">Loading...</p> : !last.ok ? <Outcome r={last} /> : !run ? <p className="muted">No ingest run recorded yet.</p> : (
          <KV rows={[
            ['run', s(run.run_id)], ['when (UTC)', s(run.utc)], ['result', run.ok ? <Badge status="OK" /> : <Badge status="ERROR" />],
            ['scanned / processed / skipped', `${s(run.scanned)} / ${s(run.processed)} / ${s(run.skipped)}`],
            ['failed / unattributed / pending', `${s(run.failed)} / ${s(run.unattributed ?? 0)} / ${s(run.pending ?? 0)}`],
            ['CPR', s(run.cpr ?? 'n/a')],
          ]} />
        )}
      </Card>
    </div>
  )
}

function Lookup() {
  const [hash, setHash] = useState('')
  const [r, setR] = useState<NflResult | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); setR(await nfl('lookup', { hash: hash.trim().toLowerCase() })); setBusy(false) }
  const items = arr(r?.data?.items)
  return (
    <Card>
      <label>Hash</label>
      <div className="row">
        <input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="sha256 hex digest" onKeyDown={(e) => e.key === 'Enter' && hash.trim() && go()} />
        <button disabled={busy || !hash.trim()} onClick={go}>Lookup</button>
      </div>
      <Outcome r={r} />
      {r?.status === 'NOT_FOUND' && <p className="muted">This hash has not been committed to the ledger.</p>}
      {items.length > 0 && (
        <Table empty="" rows={items} cols={[
          ['seq', (x) => s(x.seq)], ['artifact', (x) => s(x.artifact)], ['timestamp (UTC)', (x) => s(x.timestamp)], ['source', (x) => s(x.source_repo)],
        ]} />
      )}
    </Card>
  )
}

function FilePicker({ desktop, onHashed }: { desktop: boolean; onHashed: (f: HashedFile | null) => void }) {
  if (desktop) return <button className="ghost" onClick={async () => onHashed(await pickAndHashFile())}>Choose file...</button>
  return <input type="file" onChange={async (e) => onHashed(e.target.files?.[0] ? await pickAndHashFile(e.target.files[0]) : null)} />
}

function VerifyFile({ desktop }: { desktop: boolean }) {
  const [file, setFile] = useState<HashedFile | null>(null)
  const [r, setR] = useState<NflResult | null>(null)
  const onHashed = async (f: HashedFile | null) => {
    setFile(f); setR(null)
    if (f) setR(await nfl('verifySha256', { sha256: f.sha256 }))
  }
  return (
    <Card>
      <p className="muted">The file is hashed on this computer (SHA-256); only the hash is sent to NFL.</p>
      <FilePicker desktop={desktop} onHashed={onHashed} />
      {file && <KV rows={[['file', file.name], ['bytes', String(file.bytes)], ['sha256', <Hash v={file.sha256} />]]} />}
      <Outcome r={r} />
      {r?.status === 'VERIFIED' && <KV rows={[['artifact', s(r.data?.artifact)], ['committed (UTC)', s(r.data?.timestamp)], ['seq', s(r.data?.seq)]]} />}
      {r?.status === 'NOT_FOUND' && <p className="muted">No record of this file's hash in the ledger.</p>}
    </Card>
  )
}

function Commit({ desktop, onCommitted }: { desktop: boolean; onCommitted: () => void }) {
  const [hash, setHash] = useState('')
  const [artifact, setArtifact] = useState('')
  const [r, setR] = useState<NflResult | null>(null)
  const [busy, setBusy] = useState(false)
  const h = hash.trim().toLowerCase()
  const valid = isHexDigest(h)
  const go = async () => {
    setBusy(true)
    const res = await nfl('commit', { hash: h, artifact })
    setR(res); setBusy(false)
    if (res.ok) onCommitted()
  }
  return (
    <Card>
      <p className="muted">Commits are permanent: the ledger is append-only. NFL stores the hash and your label, never the content.</p>
      <label>Hash</label>
      <div className="row">
        <input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="hex digest (SHA-256)" />
        <FilePicker desktop={desktop} onHashed={(f) => { if (f) { setHash(f.sha256); if (!artifact) setArtifact('file:' + f.name) } }} />
      </div>
      {hash && !valid && <p className="warn">Not a hex digest; NFL will refuse it (BAD_HASH).</p>}
      <label>Artifact label</label>
      <input value={artifact} onChange={(e) => setArtifact(e.target.value)} placeholder="what this hash is (max 1024 characters)" maxLength={1024} />
      <div className="row end"><button disabled={busy || !valid} onClick={go}>Commit</button></div>
      <Outcome r={r} />
      {r?.ok && <KV rows={[['hash', <Hash v={r.data?.hash} />], ['seq', s(r.data?.seq)], ['timestamp (UTC)', s(r.data?.timestamp)]]} />}
    </Card>
  )
}

function Receipts({ onWitnessed }: { onWitnessed: () => void }) {
  const [text, setText] = useState('')
  const [r, setR] = useState<NflResult | null>(null)
  const [busy, setBusy] = useState(false)
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0)
  const run = async (op: 'receiptVerify' | 'receiptWitness') => {
    setBusy(true)
    const res = await nfl(op, { lines })
    setR(res); setBusy(false)
    if (op === 'receiptWitness') onWitnessed()
  }
  return (
    <Card>
      <p className="muted">
        One <code>constellation.integration.receipt.v1</code> line per row, exactly as the emitter wrote it. NFL
        recomputes each hash. Witnessing commits only receipts of registered integrations; everything else is refused
        with a reason and nothing is written.
      </p>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"schema":"constellation.integration.receipt.v1","consumer":"...","provider":"nfl",...}' />
      <div className="row end">
        <span className="muted small">{lines.length} line(s)</span>
        <button className="ghost" disabled={busy || lines.length === 0} onClick={() => run('receiptVerify')}>Verify</button>
        <button disabled={busy || lines.length === 0} onClick={() => run('receiptWitness')}>Witness</button>
      </div>
      <Outcome r={r} />
      {r?.data && (
        <Table empty="" rows={arr(r.data.items)} cols={[
          ['result', (x) => <Badge status={s(x.status)} />], ['receipt sha256', (x) => <Hash v={x.receipt_sha256} />],
          ['integration', (x) => s(x.integration)], ['seq', (x) => s(x.seq)],
          ['detail', (x) => s(x.error ?? x.receipt_error ?? x.timestamp)],
        ]} />
      )}
    </Card>
  )
}

function Ledger() {
  const [r, setR] = useState<NflResult | null>(null)
  const [limit, setLimit] = useState(50)
  const [tick, setTick] = useState(0)
  const load = () => setTick((t) => t + 1)
  useEffect(() => {
    let alive = true
    nfl('recent', { limit }).then((x) => { if (alive) setR(x) })
    return () => { alive = false }
  }, [limit, tick])
  return (
    <Card title="Most recent records" actions={
      <div className="row">
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{[20, 50, 200, 1000].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        <button className="ghost" onClick={load}>Refresh</button>
      </div>}>
      {r && !r.ok && <Outcome r={r} />}
      {r?.ok && (
        <Table empty="The ledger is empty." rows={arr(r.data?.items)} cols={[
          ['seq', (x) => s(x.seq)], ['hash', (x) => <Hash v={x.hash} />], ['artifact', (x) => s(x.artifact)],
          ['timestamp (UTC)', (x) => s(x.timestamp)], ['prev', (x) => (x.prev === undefined ? <span className="muted">unchained</span> : <Hash v={x.prev} />)],
        ]} />
      )}
    </Card>
  )
}

function Integrations() {
  const [r, setR] = useState<NflResult | null>(null)
  useEffect(() => { nfl('integrations').then(setR) }, [])
  return (
    <Card title="From Constellation's registry (read-only copy in NFL)">
      {r && !r.ok && <Outcome r={r} />}
      {r?.ok && (
        <Table empty="None." rows={arr(r.data?.items)} cols={[
          ['consumer', (x) => s(x.consumer)], ['provider', (x) => s(x.provider)], ['contracts', (x) => arr(x.contracts).map(String).join(', ') || '-'],
          ['receipt emitter', (x) => s(x.emitted_by)], ['witness', (x) => s(x.witness)], ['receipt state', (x) => s(x.state)],
        ]} />
      )}
    </Card>
  )
}

function Ingest() {
  const [last, setLast] = useState<NflResult | null>(null)
  const [fails, setFails] = useState<NflResult | null>(null)
  const [rcpts, setRcpts] = useState<NflResult | null>(null)
  const [ctl, setCtl] = useState<NflResult | null>(null)
  const [tick, setTick] = useState(0)
  const load = () => setTick((t) => t + 1)
  useEffect(() => {
    let alive = true
    Promise.all([nfl('ingestLastRun'), nfl('ingestFailures', { limit: 50 }), nfl('receipts', { limit: 50 })]).then(([a, b, c]) => {
      if (alive) { setLast(a); setFails(b); setRcpts(c) }
    })
    return () => { alive = false }
  }, [tick])
  const run = (last?.data?.item ?? null) as Rec | null
  const control = async (action: 'status' | 'run-once') => { setCtl(await nfl('ingestControl', { action })); if (action === 'run-once') void load() }
  return (
    <>
      <Card title="Inboxes (last run)" actions={<div className="row">
        <button className="ghost" onClick={() => control('status')}>Schedule status</button>
        <button onClick={() => control('run-once')}>Run once</button>
        <button className="ghost" onClick={load}>Refresh</button></div>}>
        {ctl && <><Outcome r={ctl} />{ctl.data?.output ? <pre>{s(ctl.data.output)}</pre> : null}</>}
        {last && !last.ok && <Outcome r={last} />}
        {run ? (
          <Table empty="No inboxes reported." rows={arr(run.inboxes)} cols={[
            ['inbox', (x) => s(x.name)], ['mode', (x) => s(x.mode)], ['state', (x) => <Badge status={s(x.state) === 'ok' ? 'OK' : s(x.state)} />], ['attribution', (x) => s(x.attribution)],
          ]} />
        ) : last?.ok ? <p className="muted">No ingest run recorded yet.</p> : null}
      </Card>
      <Card title="Failures and refusals">
        {fails && !fails.ok && <Outcome r={fails} />}
        {fails?.ok && (
          <Table empty="None." rows={arr(fails.data?.items)} cols={[
            ['when (UTC)', (x) => s(x.utc)], ['inbox', (x) => s(x.inbox_name)], ['item', (x) => s(x.item_path)], ['result', (x) => s(x.result ?? (x.ok === false ? 'FAILED' : ''))],
          ]} />
        )}
      </Card>
      <Card title="nfl.receipt.v1 receipts issued">
        {rcpts && !rcpts.ok && <Outcome r={rcpts} />}
        {rcpts?.ok && (
          <Table empty="None yet." rows={arr(rcpts.data?.items)} cols={[
            ['time (UTC)', (x) => s(x.receipt_time)], ['producer', (x) => s(x.producer)], ['event', (x) => s(x.event_type)],
            ['packet id', (x) => <Hash v={arr(x.pointers).find((p) => p.kind === 'packet_id')?.value} />], ['seq', (x) => s(x.ledger_seq)],
          ]} />
        )}
      </Card>
    </>
  )
}
