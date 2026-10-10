import Link from "next/link";
import { ShieldCheck, ArrowLeft } from "lucide-react";

export const metadata = { title: "Acceptable Use — TopVerify", description: "Acceptable-use rules for TopVerify identity services." };

export default function AcceptableUsePage() {
  return <main className="tv-legal-shell">
    <Link className="tv-legal-back" href="/"><ArrowLeft size={16}/> Back to TopVerify</Link>
    <div className="tv-legal-mark"><ShieldCheck size={22}/></div>
    <span className="tv-legal-kicker">TOPVERIFY · RESPONSIBLE ACCESS</span>
    <h1>Acceptable-use rules</h1>
    <p className="tv-legal-intro">Every agent is responsible for using identity services lawfully, for a disclosed purpose, and only where the agent has the required authority.</p>
    <section><h2>1. Authorized purposes only</h2><p>Use TopVerify only for a legitimate, specific purpose such as consent-based customer onboarding, a verification requested by the data subject, or a compliance check supported by a lawful basis. You must be entitled to make the request and must follow the upstream provider’s terms and permissions.</p></section>
    <section><h2>2. Consent and transparency</h2><p>Before each request, explain what will be checked, why it is needed, and who will receive the result. Obtain and document the required authorization or other applicable lawful basis. The in-app checkbox records an agent’s confirmation; it does not replace any separate consent, legal basis or notice required for the request.</p></section>
    <section><h2>3. Prohibited conduct</h2><ul><li>No stalking, harassment, doxxing, intimidation, impersonation, identity theft or fraud.</li><li>No searching for a person out of curiosity, for discrimination, or to expose their private details.</li><li>No selling, publishing, forwarding or reusing results outside the disclosed authorized purpose.</li><li>No bypassing provider access controls, account approval, rate limits or security measures.</li><li>No sharing login credentials, API keys or another agent’s wallet.</li><li>No using test credentials to search real people or attempting to alter official records without express authorization.</li></ul></section>
    <section><h2>4. Secure handling</h2><p>Keep results private, restrict access to staff who need them, avoid downloading or retaining unnecessary copies, and promptly report suspected misuse or unauthorized access through the operator’s published support channel.</p></section>
    <section><h2>5. Monitoring and enforcement</h2><p>TopVerify records request references, service types, account identity, request purpose, status and billing events for audit and reconciliation. Where misuse is suspected, TopVerify may pause requests, restrict an account, investigate and cooperate with lawful requests. Account approval does not guarantee access to every provider service.</p></section>
    <section><h2>6. Acceptance and changes</h2><p>By creating an account, you confirm that you understand and will follow these rules and the <Link href="/privacy">Privacy Notice</Link>. This document must be reviewed and adapted to the actual service, provider contracts and applicable law before production launch.</p></section>
    <footer><Link href="/privacy">Read the Privacy Notice</Link> · Draft for review before production launch.</footer>
  </main>;
}
