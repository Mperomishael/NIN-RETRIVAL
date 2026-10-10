import Link from "next/link";
import { ShieldCheck, ArrowLeft } from "lucide-react";

export const metadata = { title: "Privacy Notice — TopVerify", description: "Draft privacy notice for TopVerify identity services." };

export default function PrivacyPage() {
  return <main className="tv-legal-shell">
    <Link className="tv-legal-back" href="/"><ArrowLeft size={16}/> Back to TopVerify</Link>
    <div className="tv-legal-mark"><ShieldCheck size={22}/></div>
    <span className="tv-legal-kicker">TOPVERIFY · PRIVACY</span>
    <h1>Privacy notice</h1>
    <p className="tv-legal-intro">This is a launch draft. Before accepting real customers, the TopVerify operator must add its verified legal name, business address, privacy contact, final retention periods and any applicable registration details, then obtain legal review.</p>
    <section><h2>1. Who operates TopVerify?</h2><p>TopVerify is operated by the business identified on the final production site. Replace this section before launch with the operator’s legal name, address and a monitored privacy contact. Do not launch with missing or placeholder controller information.</p></section>
    <section><h2>2. What information is collected?</h2><p>Agent onboarding currently collects a name, email address through authentication, phone number, optional business name and address, intended use, and acceptance of the acceptable-use terms. The platform also records account status, wallet ledger entries, service references, request purposes, timestamps and security audit events.</p><p>When an approved agent submits a permitted identity request, TopVerify sends the minimum required fields to its configured provider. Identity results are returned to the requesting agent. The current request history stores a minimal summary, not the full identity response or PDF contents.</p></section>
    <section><h2>3. Why is information processed?</h2><p>Information is used to administer agent accounts, review access eligibility, provide requested identity services, manage wallets and service charges, prevent abuse, reconcile provider transactions, and maintain security and audit records. Each identity request must have a lawful, disclosed purpose and appropriate authorization.</p></section>
    <section><h2>4. Providers and recipients</h2><p>TopVerify uses Supabase for authentication and database hosting and may send required request fields to NINSlip or other specifically disclosed, approved identity providers. Payment information may be sent to a payment processor when wallet funding is activated. Before launch, list the actual providers, their relevant roles, data locations and transfer safeguards here.</p></section>
    <section><h2>5. Retention and security</h2><p>Access is restricted through authentication, account approval, row-level security and server-side API credentials. Before launch, publish exact retention periods for profiles, request references, audit records and payment events, plus a process for deletion or anonymization where applicable. Do not store identity photos, signatures or complete results unless there is a documented need and suitable protection.</p></section>
    <section><h2>6. Your rights and choices</h2><p>Subject to applicable law, individuals may have rights to request access, correction, deletion, restriction or a copy of their personal data, and to withdraw consent where consent is the applicable lawful basis. Withdrawal does not make earlier lawful processing retroactively unlawful. A request can be made through the operator’s published privacy contact, which must be added before launch.</p></section>
    <section><h2>7. Complaints and updates</h2><p>Individuals may contact the Nigeria Data Protection Commission through its official channels where appropriate. TopVerify will publish the effective date and notify users of material changes. This draft is not a substitute for a legal review against the Nigeria Data Protection Act and the actual operating model.</p></section>
    <footer>Draft for review · Do not treat this page as a final legal notice.</footer>
  </main>;
}
