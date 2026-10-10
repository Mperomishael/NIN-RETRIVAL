"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowUpRight, CheckCircle2, CircleAlert, Clock3, LockKeyhole, RefreshCw, ShieldCheck, Wallet, XCircle } from "lucide-react";

type Account = { id:string; code:string; label:string; asset:"NGN"|"USDT"; network:string; custody_class:"hot"|"cold"; address:string|null; is_active:boolean; ledger_balance:number };
type Deposit = { id:string; account_id:string; asset:string; network:string; amount:string|number; external_reference:string; tx_hash:string|null; status:string; submitted_by:string; evidence_reference:string|null; confirmations:number; created_at:string };
type Transfer = { id:string; source_account_id:string; destination_account_id:string; asset:string; amount:string|number; status:string; rationale:string; requested_by:string; approved_by:string|null; created_at:string };
type TreasuryData = { accounts:Account[]; pendingDeposits:Deposit[]; transfers:Transfer[]; custodyExecutionConfigured:boolean };

const amountText=(value:number|string,asset:string)=>asset==="NGN"
 ? new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:2}).format(Number(value)||0)
 : new Intl.NumberFormat("en-US",{maximumFractionDigits:8}).format(Number(value)||0)+" USDT";
const dateText=(value:string)=>new Date(value).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"});

export default function TreasuryPage(){
 const [data,setData]=useState<TreasuryData|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [asset,setAsset]=useState<"NGN"|"USDT">("NGN");
 const [amount,setAmount]=useState("");
 const [externalReference,setExternalReference]=useState("");
 const [evidenceReference,setEvidenceReference]=useState("");
 const [txHash,setTxHash]=useState("");
 const [sourceCode,setSourceCode]=useState("USDT_BSC_HOT");
 const [destinationCode,setDestinationCode]=useState("USDT_BSC_COLD");
 const [transferAmount,setTransferAmount]=useState("");
 const [rationale,setRationale]=useState("");

 const load=useCallback(async()=>{
   setLoading(true);setError("");
   try{const response=await fetch("/api/admin/treasury",{cache:"no-store"});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to load treasury.");setData(payload);}
   catch(e){setError(e instanceof Error?e.message:"Unable to load treasury.");}
   finally{setLoading(false);}
 },[]);
 useEffect(()=>{void load();},[load]);

 async function act(body:Record<string,unknown>){
   setBusy(true);setError("");setNotice("");
   try{const response=await fetch("/api/admin/treasury",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Treasury action failed.");setNotice(payload.message||payload.result?.status||"Action recorded.");await load();return true;}
   catch(e){setError(e instanceof Error?e.message:"Treasury action failed.");return false;}
   finally{setBusy(false);}
 }
 async function submitNgn(e:FormEvent){e.preventDefault();if(await act({action:"record-ngn-deposit",amount,externalReference,evidenceReference})){setAmount("");setExternalReference("");setEvidenceReference("");}}
 async function submitUsdt(e:FormEvent){e.preventDefault();if(await act({action:"verify-usdt-deposit",txHash})){setTxHash("");}}
 async function submitTransfer(e:FormEvent){e.preventDefault();if(await act({action:"request-transfer",asset,amount:transferAmount,sourceCode,destinationCode,rationale})){setTransferAmount("");setRationale("");}}

 const accounts=data?.accounts||[];
 const getAccount=(id:string)=>accounts.find(a=>a.id===id);
 const hotAccounts=useMemo(()=>accounts.filter(a=>a.custody_class==="hot"),[accounts]);
 const coldAccounts=useMemo(()=>accounts.filter(a=>a.custody_class==="cold"),[accounts]);
 const filteredTransferSources=accounts.filter(a=>a.asset===asset);
 const compatibleDestinations=filteredTransferSources.filter(a=>a.code!==sourceCode && a.network===getAccount(sourceCode)?.network);

 return <main className="tv-treasury-page">
  <header className="tv-treasury-header">
   <div><Link href="/" className="tv-treasury-back"><ArrowLeft size={15}/> Back to TopVerify</Link><span className="tv-eyebrow"><ShieldCheck size={13}/> SUPER-ADMIN CONTROL CENTRE</span><h1>Treasury &amp; wallets</h1><p>Company treasury, verified deposits, reserve transfers and a separate accounting ledger.</p></div>
   <button className="tv-button-secondary" onClick={()=>void load()} disabled={loading||busy}><RefreshCw size={15}/> Refresh</button>
  </header>
  <div className="tv-treasury-security"><LockKeyhole size={18}/><div><strong>Protected treasury operations</strong><p>Balances below are ledger balances, not live bank or blockchain balances. Deposit verification is server-side. Transfer approvals never sign or broadcast funds.</p></div><span>ADMIN ONLY</span></div>
  {error&&<div className="tv-treasury-alert tv-treasury-error"><CircleAlert size={17}/>{error}</div>}
  {notice&&<div className="tv-treasury-alert tv-treasury-success"><CheckCircle2 size={17}/>{notice}</div>}
  {loading&&!data?<div className="tv-treasury-loading"><RefreshCw size={20}/> Loading treasury records…</div>:<>
   <div className="tv-treasury-summary">
    <div className="tv-treasury-stat"><span>Hot treasury accounts</span><strong>{hotAccounts.length}</strong><small>Operational deposits</small></div>
    <div className="tv-treasury-stat"><span>Cold reserve accounts</span><strong>{coldAccounts.length}</strong><small>Offline / external custody</small></div>
    <div className="tv-treasury-stat"><span>Deposits awaiting review</span><strong>{data?.pendingDeposits.length||0}</strong><small>NGN entries require second review</small></div>
    <div className="tv-treasury-stat"><span>Transfers awaiting action</span><strong>{data?.transfers.filter(t=>t.status==="pending_approval").length||0}</strong><small>Two distinct admins required</small></div>
   </div>
   <section className="tv-treasury-section"><div className="tv-treasury-section-head"><div><h2>Treasury accounts</h2><p>Company assets only. Customer agent-wallet liabilities are kept in the separate NGN wallet ledger.</p></div><span className="tv-treasury-tag"><Wallet size={14}/> Ledger view</span></div>
    <div className="tv-treasury-account-grid">{accounts.map(account=><article className="tv-treasury-account" key={account.id}><div className="tv-treasury-account-top"><span className={account.custody_class==="hot"?"tv-treasury-account-icon tv-hot":"tv-treasury-account-icon tv-cold"}><Wallet size={19}/></span><span className={account.custody_class==="hot"?"tv-treasury-pill tv-pill-hot":"tv-treasury-pill tv-pill-cold"}>{account.custody_class.toUpperCase()}</span></div><strong>{account.label}</strong><span className="tv-treasury-account-code">{account.code} · {account.network}</span><b>{amountText(account.ledger_balance,account.asset)}</b><small>{account.asset==="USDT"?"BSC token contract / destination must be configured":"NGN bank/provider settlement ledger"}</small>{account.address?<code>{account.address}</code>:<span className="tv-treasury-unconfigured">Address not configured</span>}</article>)}</div>
   </section>
   <div className="tv-treasury-two-col">
    <section className="tv-treasury-section"><div className="tv-treasury-section-head"><div><h2>Verify USDT deposit</h2><p>Checks a BSC mainnet receipt, configured token contract, destination and confirmations before crediting the company hot-wallet ledger.</p></div><ArrowDownToLine size={19}/></div>
     <form className="tv-treasury-form" onSubmit={submitUsdt}><label>BSC transaction hash<input required value={txHash} onChange={e=>setTxHash(e.target.value)} placeholder="0x…" autoComplete="off"/></label><button className="tv-button-primary" disabled={busy}>{busy?"Verifying…":"Verify on BSC"}</button><small>Requires BSC_RPC_URL, BSC_USDT_TOKEN_ADDRESS, BSC_USDT_HOT_ADDRESS and confirmation threshold. No token transfer is signed by this app.</small></form>
    </section>
    <section className="tv-treasury-section"><div className="tv-treasury-section-head"><div><h2>Record NGN deposit</h2><p>Creates a pending entry only. A different super-admin must match it to bank/provider evidence before crediting the company ledger.</p></div><ArrowDownToLine size={19}/></div>
     <form className="tv-treasury-form" onSubmit={submitNgn}><label>Amount (NGN)<input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="250000.00"/></label><label>Bank / provider reference<input required value={externalReference} onChange={e=>setExternalReference(e.target.value)} placeholder="Settlement reference"/></label><label>Evidence reference<input required value={evidenceReference} onChange={e=>setEvidenceReference(e.target.value)} placeholder="Statement / receipt reference"/></label><button className="tv-button-primary" disabled={busy}>{busy?"Recording…":"Record pending deposit"}</button></form>
    </section>
   </div>
   <section className="tv-treasury-section"><div className="tv-treasury-section-head"><div><h2>Hot ↔ cold transfer proposal</h2><p>Request a reserve movement. A different super-admin must approve it. Execution stays disabled until an external bank/custody signer is integrated.</p></div><ArrowLeftRight size={19}/></div>
    <form className="tv-treasury-transfer-form" onSubmit={submitTransfer}>
     <label>Asset<select value={asset} onChange={e=>{const next=e.target.value as "NGN"|"USDT";setAsset(next);setSourceCode(next==="NGN"?"NGN_HOT":"USDT_BSC_HOT");setDestinationCode(next==="NGN"?"NGN_COLD":"USDT_BSC_COLD");}}><option value="NGN">NGN</option><option value="USDT">USDT · BSC</option></select></label>
     <label>From<select value={sourceCode} onChange={e=>{setSourceCode(e.target.value);const source=accounts.find(a=>a.code===e.target.value);const next=accounts.find(a=>a.code!==e.target.value&&a.asset===source?.asset&&a.network===source?.network);if(next)setDestinationCode(next.code);}}>{filteredTransferSources.map(a=><option key={a.code} value={a.code}>{a.label}</option>)}</select></label>
     <label>To<select value={destinationCode} onChange={e=>setDestinationCode(e.target.value)}>{compatibleDestinations.map(a=><option key={a.code} value={a.code}>{a.label}</option>)}</select></label>
     <label>Amount<input required inputMode="decimal" value={transferAmount} onChange={e=>setTransferAmount(e.target.value)} placeholder={asset==="NGN"?"100000":"250.00"}/></label>
     <label className="tv-treasury-reason">Reason / business justification<input required minLength={8} maxLength={500} value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="Explain why this treasury movement is needed"/></label>
     <button className="tv-button-primary" disabled={busy||!compatibleDestinations.length}>{busy?"Submitting…":"Submit for second approval"} <ArrowUpRight size={15}/></button>
    </form>
   </section>
   <section className="tv-treasury-section"><div className="tv-treasury-section-head"><div><h2>NGN deposits awaiting review</h2><p>Review evidence outside this app (bank/provider dashboard) before approving.</p></div><Clock3 size={19}/></div>
    {!data?.pendingDeposits.length?<div className="tv-treasury-empty">No deposits awaiting review.</div>:<div className="tv-treasury-table-wrap"><table className="tv-treasury-table"><thead><tr><th>Asset / amount</th><th>Provider reference</th><th>Evidence</th><th>Submitted</th><th>Action</th></tr></thead><tbody>{data.pendingDeposits.map(d=><tr key={d.id}><td><strong>{amountText(d.amount,d.asset)}</strong><small>{d.network}</small></td><td>{d.external_reference}</td><td>{d.evidence_reference||"Missing"}</td><td>{dateText(d.created_at)}<small>Submitter: {d.submitted_by.slice(0,8)}…</small></td><td><button className="tv-button-secondary" disabled={busy||d.asset!=="NGN"} onClick={()=>void act({action:"approve-ngn-deposit",depositId:d.id})}>Review &amp; credit</button></td></tr>)}</tbody></table></div>}
   </section>
   <section className="tv-treasury-section"><div className="tv-treasury-section-head"><div><h2>Transfer approvals</h2><p>Approved means “ready for external execution,” not that funds have moved.</p></div><ArrowLeftRight size={19}/></div>
    {!data?.transfers.length?<div className="tv-treasury-empty">No transfer proposals.</div>:<div className="tv-treasury-table-wrap"><table className="tv-treasury-table"><thead><tr><th>Transfer</th><th>Amount</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody>{data.transfers.map(t=><tr key={t.id}><td><strong>{getAccount(t.source_account_id)?.label||t.source_account_id.slice(0,8)}</strong><small>To: {getAccount(t.destination_account_id)?.label||t.destination_account_id.slice(0,8)}</small><small>{dateText(t.created_at)}</small></td><td>{amountText(t.amount,t.asset)}</td><td>{t.rationale}</td><td><span className="tv-treasury-status">{t.status.replaceAll("_"," ")}</span></td><td>{t.status==="pending_approval"?<button className="tv-button-secondary" disabled={busy} onClick={()=>void act({action:"approve-transfer",transferId:t.id})}>Second approval</button>:<span className="tv-treasury-not-executed"><XCircle size={14}/> Not executed</span>}</td></tr>)}</tbody></table></div>}
   </section>
   <footer className="tv-treasury-footer"><ShieldCheck size={16}/><span>Every credit and approval is recorded. Customer funds and company treasury are separate ledgers. Reconcile against bank statements and BSC chain data before treating ledger balances as spendable assets.</span></footer>
  </>}
 </main>;
}
