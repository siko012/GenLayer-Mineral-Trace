import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import * as d3 from "d3";
import {
  registerBatch, submitTrace, adjudicate, issueBadge,
  getCase, getCounts, listAll,
  MineralBatchView, MineralRow,
} from "./contractService";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;
const STATUS_LABEL = ["registered", "traced", "ruled", "badged"];
const MAX_GAPS = 12; // visualisation cap
const PREFERS_REDUCED = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;

function shortAddr(a: string): string {
  return a && a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a || "-";
}
async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); } catch { /* clipboard blocked */ }
}

// Lodestar variant: traceability "score" = MAX_GAPS - traceability_gaps (clamped 0..MAX_GAPS).
// Higher = clearer custody. Threshold lines: score >= 11 (CONFLICT_FREE), >=9 (UNCLEAR), <9 (CONFLICT).
function TraceabilityArea({ rows }: { rows: MineralRow[] }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const ruled = useMemo(() => rows.filter((r) => r.verdict).slice().reverse(), [rows]);
  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const W = 720, H = 240;
    const PAD = { l: 38, r: 18, t: 12, b: 22 };
    const xs = d3.scaleLinear().domain([0, Math.max(1, ruled.length - 1)]).range([PAD.l, W - PAD.r]);
    const ys = d3.scaleLinear().domain([0, MAX_GAPS]).range([H - PAD.b, PAD.t]);

    const g = svg.append("g").attr("class", "grid");
    [0, MAX_GAPS - 4, MAX_GAPS - 1, MAX_GAPS].forEach((v) => {
      g.append("line").attr("x1", PAD.l).attr("x2", W - PAD.r).attr("y1", ys(v)).attr("y2", ys(v))
        .attr("class", v === MAX_GAPS - 1 ? "thr" : "g");
      g.append("text").attr("x", 6).attr("y", ys(v)).attr("dy", "0.35em").attr("class", "gl").text(v.toString());
    });
    g.append("text").attr("x", W - PAD.r - 4).attr("y", ys(MAX_GAPS - 1) - 6).attr("class", "thrl").attr("text-anchor", "end").text("conflict-free floor");

    if (ruled.length === 0) {
      svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("class", "empty").attr("text-anchor", "middle").text("No batches ruled - register the first batch to begin the lodestar.");
      return;
    }

    const score = (r: MineralRow) => Math.max(0, Math.min(MAX_GAPS, MAX_GAPS - r.traceabilityGaps));
    const pts = ruled.map((r, i) => ({ x: xs(i), y: ys(score(r)), r }));
    const a = d3.area<typeof pts[0]>().x((d) => d.x).y0(H - PAD.b).y1((d) => d.y).curve(d3.curveCatmullRom);
    const lp = d3.line<typeof pts[0]>().x((d) => d.x).y((d) => d.y).curve(d3.curveCatmullRom);
    svg.append("path").attr("d", a(pts) as string).attr("class", "ar-trace");
    const p = svg.append("path").attr("d", lp(pts) as string).attr("class", "ar-line");
    const len = (p.node() as SVGPathElement).getTotalLength();
    if (PREFERS_REDUCED) {
      p.attr("stroke-dashoffset", 0);
    } else {
      p.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
        .transition().duration(900).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0);
    }

    svg.append("g").selectAll("circle").data(pts).join("circle")
      .attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", 4)
      .attr("class", (d) => `dot v-${d.r.verdict}`);
  }, [ruled]);
  return <svg ref={ref} className="area" viewBox="0 0 720 240" preserveAspectRatio="xMidYMid meet" />;
}

function Spark({ values }: { values: number[] }) {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    if (values.length === 0) return;
    const W = 88, H = 22;
    const xs = d3.scaleLinear().domain([0, Math.max(1, values.length - 1)]).range([0, W]);
    const ys = d3.scaleLinear().domain([0, Math.max(1, d3.max(values) || 1)]).range([H - 1, 1]);
    svg.append("path").attr("d", d3.area<number>().x((_, i) => xs(i)).y0(H).y1((d) => ys(d)).curve(d3.curveMonotoneX)(values) as string).attr("class", "sp-a");
    svg.append("path").attr("d", d3.line<number>().x((_, i) => xs(i)).y((d) => ys(d)).curve(d3.curveMonotoneX)(values) as string).attr("class", "sp-l");
  }, [values]);
  return <svg ref={ref} className="spark" viewBox="0 0 88 22" preserveAspectRatio="none" />;
}

export function App() {
  const { address, isConnected } = useAccount();
  const acct = address as Hex | undefined;

  const [mineral, setMineral] = useState("");
  const [origin, setOrigin] = useState("");
  const [traceText, setTraceText] = useState("");
  const [rows, setRows] = useState<MineralRow[]>([]);
  const [counts, setCounts] = useState({ next: 0, ruled: 0, badged: 0 });
  const [selId, setSelId] = useState<number | null>(null);
  const [sel, setSel] = useState<MineralBatchView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [netErr, setNetErr] = useState(false);

  async function refreshAll() {
    if (typeof document !== "undefined" && document.hidden) return; // pause when tab hidden
    try {
      const [c, list] = await Promise.all([getCounts(), listAll(50)]);
      setCounts(c); setRows(list);
      if (selId != null) { try { setSel(await getCase(selId)); } catch { /* keep */ } }
      setNetErr(false);
    } catch { setNetErr(true); /* surfaced, not silent */ }
  }
  useEffect(() => {
    refreshAll();
    const t = setInterval(refreshAll, 12000);
    const onVis = () => { if (!document.hidden) refreshAll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  async function pick(id: number) {
    setSelId(id);
    try { setSel(await getCase(id)); } catch { setSel(null); }
  }
  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label); setNote("");
    try { return await fn(); } catch (e) { setNote(String((e as Error).message || e).slice(0, 220)); return undefined; }
    finally { setBusy(null); refreshAll(); }
  }

  async function onRegister() {
    if (!acct) return;
    if (mineral.trim().length < 2) return setNote("Mineral name is required.");
    if (origin.trim().length < 2) return setNote("Origin is required.");
    const id = await run("Registering the batch", () => registerBatch(acct, { mineral, origin }));
    if (id != null) { setSelId(id); setMineral(""); setOrigin(""); setNote(`Batch #${id} registered. Submit the chain-of-custody trace next.`); }
  }
  async function onSubmitTrace() {
    if (!acct || selId == null) return;
    if (traceText.trim().length < 25) return setNote("Trace text must include at least 25 characters of custody chain.");
    await run("Submitting custody chain", () => submitTrace(acct, selId, traceText));
    setTraceText("");
  }
  async function onAdjudicate() {
    if (!acct || selId == null) return;
    await run("Validators auditing the chain", () => adjudicate(acct, selId));
  }
  async function onIssueBadge() {
    if (!acct || selId == null) return;
    await run("Issuing the conflict-free badge", () => issueBadge(acct, selId));
  }

  const sparkRuled = useMemo(() => { let acc = 0; return rows.slice().reverse().map((r) => (acc += r.verdict ? 1 : 0)); }, [rows]);
  const sparkBadged = useMemo(() => { let acc = 0; return rows.slice().reverse().map((r) => (acc += r.badge ? 1 : 0)); }, [rows]);
  const sparkScore = useMemo(() => rows.slice().reverse().map((r) => Math.max(0, MAX_GAPS - r.traceabilityGaps)), [rows]);
  const sparkConflict = useMemo(() => { let acc = 0; return rows.slice().reverse().map((r) => (acc += r.verdict === "CONFLICT" ? 1 : 0)); }, [rows]);

  return (
    <div className="page">
      <header className="bar">
        <div className="brand">
          <span className="wm">Lodestar</span>
          <em className="tag">mineral custody registry</em>
        </div>
        <div className="bar-r">
          <span className="chip"><i className="dot" /> GenLayer · studionet · {netErr ? "reconnecting…" : "live"}</span>
          <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
        </div>
      </header>

      <section className="hero">
        <div className="hcopy">
          <p className="kicker">Lodestar · conflict-free mineral provenance</p>
          <h1>Mint a conflict-free badge<br />the registry can actually defend.</h1>
          <p className="lede">
            Register a mineral batch with its origin. Submit the full chain-of-custody trace. A panel of GenLayer
            validators audits every link and counts the{" "}
            <em>broken or contested links</em> - zero gaps mints the badge, gaps over the floor block it.
          </p>
          <div className="meta">
            <span>contract</span><button type="button" className="copybtn" aria-label="Copier l'adresse du contrat" onClick={() => copyText(CONTRACT_ADDRESS)}><code>{shortAddr(CONTRACT_ADDRESS)}</code> ⧉</button>
            <span className="sep">·</span>
            <span>verdicts</span><code>CONFLICT_FREE · UNCLEAR · CONFLICT</code>
          </div>
        </div>
        <div className="hviz">
          <div className="hviz-h">
            <span>Traceability score by batch</span>
            <span className="muted">{MAX_GAPS} - gaps, higher = cleaner custody</span>
          </div>
          <TraceabilityArea rows={rows} />
        </div>
      </section>

      <section className="stats">
        <div className="stat"><span className="lbl">Batches</span><span className="num">{counts.next}</span><Spark values={Array.from({ length: counts.next + 1 }, (_, i) => i)} /></div>
        <div className="stat"><span className="lbl">Audited</span><span className="num">{counts.ruled}</span><Spark values={sparkRuled} /></div>
        <div className="stat"><span className="lbl">Badged</span><span className="num">{counts.badged}</span><Spark values={sparkBadged} /></div>
        <div className="stat"><span className="lbl">Conflicted</span><span className="num">{sparkConflict.length ? sparkConflict[sparkConflict.length - 1] : 0}</span><Spark values={sparkConflict} /></div>
        <div className="stat"><span className="lbl">Mean score</span><span className="num">{sparkScore.length ? Math.round(sparkScore.reduce((a, b) => a + b, 0) / sparkScore.length) : 0}<i>/12</i></span><Spark values={sparkScore} /></div>
      </section>

      <nav className="rule">
        <span><i>1</i> Register the batch</span>
        <span><i>2</i> Submit chain of custody</span>
        <span><i>3</i> Validators audit every link</span>
        <span><i>4</i> Issue the conflict-free badge</span>
      </nav>

      <section className="work">
        <div className="ledger">
          <div className="ledger-h">
            <h2>Batch ledger</h2>
            <span className="muted">{rows.length} on-chain · custody chain inline below each row</span>
          </div>
          {rows.length === 0 ? (<p className="empty-row">No batches yet. Register the first one.</p>) : (
            <table className="tbl">
              <thead><tr><th>batch</th><th>status</th><th>traceability</th><th>verdict</th><th>mineral &amp; origin</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const score = Math.max(0, MAX_GAPS - r.traceabilityGaps);
                  const expanded = selId === r.id;
                  return (
                    <>
                      <tr key={r.id} className={`${expanded ? "sel" : ""} ${r.verdict === "CONFLICT" ? "conflict" : ""}`} onClick={() => pick(r.id)} tabIndex={0} role="button" aria-label={`Batch ${r.id}, ${r.mineral || "mineral"}, ${r.verdict || "pending"}`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(r.id); } }}>
                        <td><code>#{r.id}</code></td>
                        <td><span className={`pill s${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                        <td className="bar-cell">
                          <div className="fb"><i style={{ width: `${(score / MAX_GAPS) * 100}%` }} className={r.verdict === "CONFLICT_FREE" ? "fill-good" : r.verdict === "UNCLEAR" ? "fill-mid" : r.verdict === "CONFLICT" ? "fill-bad" : "fill-low"} /></div>
                          <code className="bv">{score}/{MAX_GAPS} · {r.traceabilityGaps} gap{r.traceabilityGaps === 1 ? "" : "s"}</code>
                        </td>
                        <td><span className={`vd v-${r.verdict || "none"}`}>{r.verdict || "pending"}{r.badge && " ·"} {r.badge ? <span className="badge-tag">badge</span> : null}</span></td>
                        <td>
                          <code className="zone">{r.mineral || "-"}</code>
                          <span className="vs">·</span>
                          <code className="addr">{r.origin || "-"}</code>
                        </td>
                      </tr>
                      {expanded && r.traceText && (
                        <tr key={`${r.id}-custody`} className="custody-row">
                          <td colSpan={5}>
                            <div className="custody">
                              <span className="cl">chain of custody</span>
                              <pre>{r.traceText}</pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Register a batch</h3>
            <label>Mineral</label>
            <input value={mineral} onChange={(e) => setMineral(e.target.value)} placeholder="e.g. tantalum, cobalt, tungsten" />
            <label>Stated origin</label>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="region / mine / supplier" />
            <button className="go" disabled={!isConnected || !!busy || mineral.trim().length < 2 || origin.trim().length < 2} onClick={onRegister}>
              {isConnected ? "Register the batch" : "Connect a wallet to register"}
            </button>
          </div>

          {sel && selId != null && (
            <div className="panel selpanel">
              <h3>Selected · batch <code>#{selId}</code></h3>
              <div className="kv"><span>status</span><b>{STATUS_LABEL[sel.status] || sel.status}</b></div>
              <div className="kv"><span>mineral</span><code>{sel.mineral}</code></div>
              <div className="kv"><span>origin</span><code>{sel.origin}</code></div>
              {sel.verdict ? (
                <>
                  <div className={`verdict v-${sel.verdict}`}>{sel.verdict.replace("_", " ")}</div>
                  <div className="kv"><span>gaps</span><code>{sel.traceabilityGaps}</code></div>
                  <div className="kv"><span>badge</span><b className={sel.badge ? "good" : "muted"}>{sel.badge ? "issued" : "not issued"}</b></div>
                  {sel.rationale && <p className="rationale">{sel.rationale}</p>}
                </>
              ) : sel.status === 0 ? (<p className="muted">Awaiting chain-of-custody submission.</p>) : (<p className="muted">Awaiting adjudication.</p>)}

              {sel.status === 0 && (
                <>
                  <label>Chain of custody</label>
                  <textarea value={traceText} onChange={(e) => setTraceText(e.target.value)} placeholder="List every custody link: extractor -> processor -> shipper -> ... with dates and references." />
                  <button className="ghost" disabled={!isConnected || !!busy} onClick={onSubmitTrace}>Submit chain of custody</button>
                </>
              )}
              {sel.status === 1 && (<button className="go" disabled={!isConnected || !!busy} onClick={onAdjudicate}>Audit the chain &amp; rule</button>)}
              {sel.status === 2 && sel.verdict === "CONFLICT_FREE" && (<button className="go" disabled={!isConnected || !!busy} onClick={onIssueBadge}>Issue the conflict-free badge</button>)}
              {sel.status === 2 && sel.verdict !== "CONFLICT_FREE" && (<p className="muted">Badge withheld. {sel.verdict === "UNCLEAR" ? "Unclear custody - re-submit traces." : "Conflict found - batch flagged."}</p>)}
              {sel.status === 3 && (<p className="muted">Badge issued. The registry stands.</p>)}
            </div>
          )}
        </aside>
      </section>

      {(busy || note) && <div className="toast">{busy ? `${busy}...` : note}</div>}

      <footer className="foot">
        <span>contract <code>{shortAddr(CONTRACT_ADDRESS)}</code></span>
        <span>{counts.badged} badge{counts.badged === 1 ? "" : "s"} issued</span>
        <span>custody verdicts reproduced by independent GenLayer validators on studionet</span>
      </footer>
    </div>
  );
}
