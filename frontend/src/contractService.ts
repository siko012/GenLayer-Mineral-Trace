import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;
const TIMEOUT_MS = 240_000;

export type Verdict = "CONFLICT_FREE" | "UNCLEAR" | "CONFLICT" | "";

export interface MineralBatchView {
  registrant: string;
  mineral: string;
  origin: string;
  traceText: string;
  traceabilityGaps: number;
  status: number; // 0 REGISTERED, 1 TRACED, 2 RULED, 3 BADGED
  verdict: Verdict;
  badge: boolean;
  rationale: string;
}
export interface MineralRow extends MineralBatchView { id: number; }

function readClient() { return createClient({ chain: studionet, account: createAccount() }); }
function writeClient(account: Hex) { return createClient({ chain: studionet, account }); }

async function waitAccepted(client: any, hash: Hex) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Transaction timed out")), TIMEOUT_MS); });
  try { await Promise.race([client.waitForTransactionReceipt({ hash: hash as never, status: TransactionStatus.ACCEPTED, interval: 5000, retries: 64 }), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
function pick(obj: any, key: string, idx: number): any {
  if (obj == null) return undefined;
  if (Array.isArray(obj)) return obj[idx];
  if (typeof obj === "object" && key in obj) return obj[key];
  return undefined;
}

export async function registerBatch(account: Hex, f: { mineral: string; origin: string }): Promise<number> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "register_batch", args: [f.mineral.trim(), f.origin.trim()], value: 0n })) as Hex;
  await waitAccepted(wc, h);
  const c = await getCounts();
  return c.next - 1;
}
export async function submitTrace(account: Hex, caseId: number, traceText: string): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "submit_trace", args: [caseId, traceText.trim()], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}
export async function adjudicate(account: Hex, caseId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "adjudicate", args: [caseId], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}
export async function issueBadge(account: Hex, caseId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "issue_badge", args: [caseId], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}
export async function getCase(caseId: number): Promise<MineralBatchView> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_case", args: [caseId] });
  return {
    registrant: String(pick(r, "registrant", 0) ?? ""),
    mineral: String(pick(r, "mineral", 1) ?? ""),
    origin: String(pick(r, "origin", 2) ?? ""),
    traceText: String(pick(r, "trace_text", 3) ?? ""),
    traceabilityGaps: Number(pick(r, "traceability_gaps", 4) ?? 0),
    status: Number(pick(r, "status", 5) ?? 0),
    verdict: String(pick(r, "verdict", 6) ?? "") as Verdict,
    badge: Boolean(pick(r, "badge", 7) ?? false),
    rationale: String(pick(r, "rationale", 8) ?? ""),
  };
}
export async function getCounts(): Promise<{ next: number; ruled: number; badged: number }> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_counts", args: [] });
  const parts = String(r).split("||").map((x) => Number(x) || 0);
  return { next: parts[0] || 0, ruled: parts[1] || 0, badged: parts[2] || 0 };
}
export async function listAll(maxRows = 50): Promise<MineralRow[]> {
  const { next } = await getCounts();
  if (next === 0) return [];
  const ids: number[] = [];
  for (let i = next - 1; i >= 0 && i >= next - maxRows; i--) ids.push(i);
  const rows = await Promise.all(ids.map(async (id) => { try { const c = await getCase(id); return { id, ...c }; } catch { return null; } }));
  return rows.filter((r): r is MineralRow => r !== null);
}
