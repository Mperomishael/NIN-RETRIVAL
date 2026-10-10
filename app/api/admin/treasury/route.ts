import { NextResponse } from "next/server";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server treasury configuration is incomplete.");
  return createSupabaseAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authorizeAdmin() {
  const server = await createSupabaseServerClient();
  const { data, error } = await server.auth.getUser();
  if (error || !data.user) return { response: NextResponse.json({ error: "Sign in required." }, { status: 401 }) } as const;
  let admin: ReturnType<typeof adminClient>;
  try { admin = adminClient(); } catch { return { response: NextResponse.json({ error: "Treasury server configuration is incomplete." }, { status: 503 }) } as const; }
  const { data: profile, error: profileError } = await admin.from("profiles").select("id,status,is_super_admin").eq("id", data.user.id).maybeSingle();
  if (profileError || !profile || profile.status !== "approved" || profile.is_super_admin !== true) {
    return { response: NextResponse.json({ error: "Super-admin access required." }, { status: 403 }) } as const;
  }
  return { admin, actorId: data.user.id } as const;
}

function amountString(value: unknown, asset: "NGN" | "USDT") {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Enter an amount.");
  const text = String(value).trim();
  const decimals = asset === "NGN" ? 2 : 18;
  const pattern = new RegExp("^(?:0|[1-9]\\d{0,17})(?:\\.\\d{1," + decimals + "})?$");
  if (!pattern.test(text) || !/[1-9]/.test(text)) throw new Error("Enter a positive amount with valid precision.");
  return text;
}

async function rpc(method: string, params: unknown[]) {
  const endpoint = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
  const response = await fetch(endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("BSC RPC is temporarily unavailable.");
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (body.error || body.result === undefined || body.result === null) throw new Error("Could not verify the transaction on BSC.");
  return body.result;
}

function fromBaseUnits(value: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

async function verifyBscDeposit(txHash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("Enter a valid BSC transaction hash.");
  const token = process.env.BSC_USDT_TOKEN_ADDRESS?.trim();
  const hotAddress = process.env.BSC_USDT_HOT_ADDRESS?.trim();
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token) || !hotAddress || !/^0x[0-9a-fA-F]{40}$/.test(hotAddress)) {
    throw new Error("USDT deposit verification is disabled until the verified token contract and hot-wallet address are configured.");
  }
  const chainId = String(await rpc("eth_chainId", []));
  if (chainId.toLowerCase() !== "0x38") throw new Error("Configured RPC is not BNB Smart Chain mainnet (chain ID 56).");
  const receipt = await rpc("eth_getTransactionReceipt", [txHash]) as {
    status?: string; blockNumber?: string;
    logs?: Array<{ address?: string; topics?: string[]; data?: string }>;
  } | null;
  if (!receipt || !receipt.blockNumber || receipt.status?.toLowerCase() !== "0x1") throw new Error("Transaction is not confirmed successfully on BSC.");
  const head = BigInt(String(await rpc("eth_blockNumber", [])));
  const block = BigInt(receipt.blockNumber);
  const confirmations = Number(head - block + 1n);
  const minimum = Number(process.env.BSC_USDT_MIN_CONFIRMATIONS || "15");
  if (!Number.isSafeInteger(minimum) || minimum < 1 || confirmations < minimum) throw new Error("Transaction has " + confirmations + " confirmations; " + minimum + " are required.");
  const decimalsHex = String(await rpc("eth_call", [{ to: token, data: "0x313ce567" }, "latest"]));
  const decimals = Number(BigInt(decimalsHex));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("Configured token returned invalid decimals.");
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const expectedRecipient = hotAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  let baseUnits = 0n;
  for (const log of receipt.logs || []) {
    if (log.address?.toLowerCase() !== token.toLowerCase()) continue;
    if (log.topics?.[0]?.toLowerCase() !== transferTopic || log.topics?.length !== 3) continue;
    if (log.topics[2].toLowerCase().replace(/^0x/, "") !== expectedRecipient) continue;
    if (!log.data || !/^0x[0-9a-fA-F]+$/.test(log.data)) continue;
    baseUnits += BigInt(log.data);
  }
  if (baseUnits <= 0n) throw new Error("No transfer of the configured token to the configured hot wallet was found in this transaction.");
  return { amount: fromBaseUnits(baseUnits, decimals), confirmations, blockNumber: Number(block), tokenAddress: token, destinationAddress: hotAddress, decimals };
}

export async function GET() {
  const auth = await authorizeAdmin();
  if ("response" in auth) return auth.response;
  const { admin } = auth;
  const [accountsResult, ledgerResult, depositsResult, transfersResult] = await Promise.all([
    admin.from("treasury_accounts").select("id,code,label,asset,network,custody_class,address,is_active").order("asset").order("custody_class"),
    admin.from("treasury_ledger").select("account_id,direction,amount"),
    admin.from("treasury_deposits").select("id,account_id,asset,network,amount,external_reference,tx_hash,status,submitted_by,evidence_reference,confirmations,created_at").eq("status","pending_review").order("created_at",{ascending:false}).limit(30),
    admin.from("treasury_transfers").select("id,source_account_id,destination_account_id,asset,amount,status,rationale,requested_by,approved_by,created_at").in("status",["pending_approval","approved_to_execute"]).order("created_at",{ascending:false}).limit(30),
  ]);
  const failure = [accountsResult,ledgerResult,depositsResult,transfersResult].find(x=>x.error);
  if (failure?.error) return NextResponse.json({ error: "Unable to load treasury data." }, { status: 500 });
  const balances = new Map<string, number>();
  for (const entry of ledgerResult.data || []) {
    const signed = Number(entry.amount) * (entry.direction === "credit" ? 1 : -1);
    balances.set(entry.account_id, (balances.get(entry.account_id) || 0) + signed);
  }
  const accounts = (accountsResult.data || []).map(a=>({...a,ledger_balance:balances.get(a.id)||0}));
  return NextResponse.json({ accounts, pendingDeposits:depositsResult.data||[], transfers:transfersResult.data||[], custodyExecutionConfigured:false });
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin();
  if ("response" in auth) return auth.response;
  const { admin, actorId } = auth;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const action = typeof body.action === "string" ? body.action : "";
  try {
    if (action === "record-ngn-deposit") {
      const amount = amountString(body.amount, "NGN");
      const externalReference = String(body.externalReference || "").trim();
      const evidenceReference = String(body.evidenceReference || "").trim();
      if (externalReference.length < 5 || externalReference.length > 180 || evidenceReference.length < 5 || evidenceReference.length > 500) {
        return NextResponse.json({ error: "Enter a bank/provider reference and an evidence reference of at least 5 characters." }, { status: 400 });
      }
      const { data: account, error: accountError } = await admin.from("treasury_accounts").select("id").eq("code","NGN_HOT").eq("is_active",true).single();
      if (accountError || !account) return NextResponse.json({ error: "NGN operating treasury is not configured." }, { status: 503 });
      const { error } = await admin.from("treasury_deposits").insert({
        account_id:account.id,asset:"NGN",network:"NGN_BANK",amount,external_reference,status:"pending_review",
        submitted_by:actorId,evidence_reference,metadata:{ submitted_via:"admin_console", note:String(body.note||"").slice(0,300) }
      });
      if (error) {
        if (error.code === "23505") return NextResponse.json({ error: "That bank/provider reference has already been recorded." }, { status: 409 });
        return NextResponse.json({ error: "Could not record the pending deposit." }, { status: 500 });
      }
      await admin.from("audit_logs").insert({actor_id:actorId,action:"treasury_ngn_deposit_submitted",entity_type:"treasury_deposit",metadata:{amount,external_reference:evidenceReference}});
      return NextResponse.json({ ok:true, message:"Deposit recorded for independent review. It has not been credited." });
    }
    if (action === "approve-ngn-deposit") {
      const id = String(body.depositId || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid deposit reference." }, { status:400 });
      const { data, error } = await admin.schema("private").rpc("topverify_approve_ngn_deposit",{p_deposit_id:id,p_reviewer_id:actorId});
      if (error) return NextResponse.json({error:error.message.includes("SECOND_REVIEWER_REQUIRED")?"A different super-admin must review this deposit.":error.message.includes("EVIDENCE_REQUIRED")?"Evidence is required before crediting.":"Deposit review could not be completed."},{status:409});
      return NextResponse.json({ok:true,result:data});
    }
    if (action === "verify-usdt-deposit") {
      const txHash = String(body.txHash || "").trim();
      const verified = await verifyBscDeposit(txHash);
      const { data: account, error: accountError } = await admin.from("treasury_accounts").select("id").eq("code","USDT_BSC_HOT").eq("is_active",true).single();
      if (accountError || !account) return NextResponse.json({ error:"USDT BSC hot treasury is not configured." }, { status:503 });
      const { data, error } = await admin.schema("private").rpc("topverify_record_bsc_usdt_deposit",{
        p_account_id:account.id,p_tx_hash:txHash,p_amount:verified.amount,p_confirmations:verified.confirmations,
        p_block_number:verified.blockNumber,p_actor_id:actorId,
        p_metadata:{token_address:verified.tokenAddress,destination_address:verified.destinationAddress,decimals:verified.decimals,chain_id:56}
      });
      if (error) return NextResponse.json({error:error.code==="23505"?"This transaction has already been recorded.":"Could not record the verified deposit."},{status:409});
      return NextResponse.json({ok:true,result:data});
    }
    if (action === "request-transfer") {
      const amount = amountString(body.amount, body.asset === "USDT" ? "USDT" : "NGN");
      const sourceCode = String(body.sourceCode || "");
      const destinationCode = String(body.destinationCode || "");
      const rationale = String(body.rationale || "").trim();
      if (rationale.length < 8 || rationale.length > 500) return NextResponse.json({error:"Provide a transfer reason between 8 and 500 characters."},{status:400});
      const {data:accounts,error:accountsError}=await admin.from("treasury_accounts").select("id,code,asset,network").in("code",[sourceCode,destinationCode]).eq("is_active",true);
      if(accountsError||!accounts||accounts.length!==2) return NextResponse.json({error:"Choose two active treasury accounts."},{status:400});
      const source=accounts.find(a=>a.code===sourceCode); const destination=accounts.find(a=>a.code===destinationCode);
      if(!source||!destination||source.asset!==destination.asset||source.network!==destination.network) return NextResponse.json({error:"Transfers must stay within the same asset and network."},{status:400});
      const {data,error}=await admin.schema("private").rpc("topverify_request_treasury_transfer",{
        p_source_account_id:source.id,p_destination_account_id:destination.id,p_amount:amount,p_rationale:rationale,p_requester_id:actorId
      });
      if(error) return NextResponse.json({error:"Could not submit the transfer for approval."},{status:409});
      return NextResponse.json({ok:true,result:data,message:"Transfer proposal created. No funds have moved."});
    }
    if (action === "approve-transfer") {
      const id = String(body.transferId || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error:"Invalid transfer reference."},{status:400});
      const {data,error}=await admin.schema("private").rpc("topverify_approve_treasury_transfer",{p_transfer_id:id,p_approver_id:actorId});
      if(error) return NextResponse.json({error:error.message.includes("SECOND_APPROVER_REQUIRED")?"The requester cannot approve their own transfer.": "Transfer approval could not be completed."},{status:409});
      return NextResponse.json({ok:true,result:data,message:"Second approval recorded. This does not broadcast or execute a transfer."});
    }
    return NextResponse.json({error:"Unsupported treasury action."},{status:400});
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("BSC RPC") || message.includes("BSC mainnet") || message.includes("USDT deposit verification") || message.includes("confirmations") || message.includes("Transaction") || message.includes("transfer of the configured token")) {
      return NextResponse.json({error:message},{status:422});
    }
    return NextResponse.json({error:"Treasury operation failed safely. Check the record and audit trail before retrying."},{status:500});
  }
}
