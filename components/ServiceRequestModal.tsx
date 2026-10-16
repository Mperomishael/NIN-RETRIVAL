"use client";

import { FormEvent, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, ArrowDownToLine, ArrowRight, Check, Clock3, IdCard, Wallet } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { ServicePreview } from "@/components/ServicePreview";
import { ResultView } from "@/components/ResultView";
import { downloadBase64Pdf, downloadResultPdf } from "@/lib/pdf";
import { money, type Service } from "@/lib/format";

type Fields = {
  nin: string; phone: string; bvn: string; firstName: string; lastName: string; gender: string; dateOfBirth: string;
  slipType: string; trackingId: string; errorType: string; fieldCode: string; modificationValue: string; modificationReason: string;
};
const emptyFields: Fields = {
  nin: "", phone: "", bvn: "", firstName: "", lastName: "", gender: "m", dateOfBirth: "", slipType: "Standard Slip",
  trackingId: "", errorType: "No Record", fieldCode: "032", modificationValue: "", modificationReason: "",
};

const purposes = [
  "Customer onboarding / KYC with consent",
  "Data subject requested their own record",
  "Compliance verification with lawful basis",
];
const slipTypes = ["Standard Slip", "Premium Slip", "Regular Slip", "Information Slip"];
const modifications = [
  { value: "032", label: "Correction of name" },
  { value: "033", label: "Phone number update" },
  { value: "034", label: "Gender update" },
  { value: "035", label: "Date of birth correction" },
  { value: "037", label: "Residential address update" },
];
const modificationLabel: Record<string, string> = {
  "032": "Correct full name", "033": "Correct phone number", "034": "Correct gender",
  "035": "Correct date of birth", "037": "Correct residential address",
};

type Step = "form" | "review" | "result";
type Payload = {
  reference?: string; message?: string; processing?: boolean; providerReference?: string;
  result?: Record<string, unknown> | null; slip?: { fileName: string; base64: string } | null;
};

type Props = {
  service: Service;
  Icon: LucideIcon;
  isApproved: boolean;
  balanceKobo: number;
  onClose: () => void;
  onFinished: () => void;
  onFundWallet: () => void;
  onVerifyNin: () => void;
};

export function ServiceRequestModal({ service, Icon, isApproved, balanceKobo, onClose, onFinished, onFundWallet, onVerifyNin }: Props) {
  const [open, setOpen] = useState(true);
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [purpose, setPurpose] = useState(purposes[0]);
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [pdfState, setPdfState] = useState<"idle" | "done" | "failed">("idle");
  const lastPayload = useRef<Payload | null>(null);

  const id = service.id;
  const set = (patch: Partial<Fields>) => setFields(current => ({ ...current, ...patch }));
  const digits = (v: string) => v.replace(/\D/g, "");
  const insufficient = balanceKobo < service.price_kobo;

  function close() {
    setOpen(false);
    setTimeout(onClose, 200);
  }

  function review(event: FormEvent) {
    event.preventDefault();
    if (!consent) { setError("Confirm the data subject has authorized this request to continue."); return; }
    setError("");
    setStep("review");
  }

  async function downloadPdf(source: Payload) {
    try {
      if (source.slip) downloadBase64Pdf(source.slip.base64, source.slip.fileName);
      else if (source.result && typeof source.result === "object") {
        await downloadResultPdf({ serviceName: service.name, reference: String(source.reference ?? ""), data: source.result });
      } else return;
      setPdfState("done");
    } catch {
      setPdfState("failed");
    }
  }

  async function submit() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: id, purpose, consent, ...fields }),
      });
      const data = await response.json().catch(() => ({})) as Payload & { error?: string };
      if (!response.ok) throw new Error(data.error || "The request could not be completed.");
      lastPayload.current = data;
      setPayload(data);
      setStep("result");
      onFinished();
      if (!data.processing) await downloadPdf(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request could not be completed.");
      setStep("review");
      onFinished();
    } finally {
      setLoading(false);
    }
  }

  const input = (label: string, key: keyof Fields, extra: { placeholder?: string; numeric?: boolean; max?: number; inputMode?: "numeric" | "tel" } = {}) => (
    <label className="tv-field">
      <span className="tv-field-label">{label}</span>
      <input
        required
        value={fields[key]}
        maxLength={extra.max}
        inputMode={extra.inputMode}
        placeholder={extra.placeholder}
        onChange={e => set({ [key]: extra.numeric ? digits(e.target.value) : e.target.value } as Partial<Fields>)}
      />
    </label>
  );

  const detailFields = (
    <>
      {id === "nin-lookup" && input("NIN", "nin", { numeric: true, max: 11, inputMode: "numeric", placeholder: "11-digit NIN" })}
      {id === "nin-image-report" && input("NIN", "nin", { numeric: true, max: 11, inputMode: "numeric", placeholder: "11-digit NIN" })}
      {id === "nin-slip" && input("NIN", "nin", { numeric: true, max: 11, inputMode: "numeric", placeholder: "11-digit NIN" })}
      {(id === "phone-lookup" || id === "phone-slip") && input("Phone number", "phone", { inputMode: "tel", placeholder: "08012345678" })}
      {(id === "tracking-id-lookup" || id === "ipe-clearance") && input("Tracking ID", "trackingId", { placeholder: "Provider tracking ID" })}
      {(id === "bvn-verify" || id === "bvn-slip") && input("BVN", "bvn", { numeric: true, max: 11, inputMode: "numeric", placeholder: "11-digit BVN" })}
      {id === "nin-validation" && (
        <>
          {input("NIN", "nin", { numeric: true, max: 11, inputMode: "numeric", placeholder: "11-digit NIN" })}
          {input("Validation issue", "errorType", { max: 80, placeholder: "e.g. No Record" })}
        </>
      )}
      {id === "nin-modification" && (
        <>
          {input("NIN", "nin", { numeric: true, max: 11, inputMode: "numeric", placeholder: "11-digit NIN" })}
          <Select label="Modification type" value={fields.fieldCode} options={modifications} onChange={v => set({ fieldCode: v, modificationValue: "" })} />
          {input(modificationLabel[fields.fieldCode], "modificationValue", { placeholder: "Enter the correct details" })}
          {input("Reason for correction", "modificationReason", { placeholder: "Brief explanation" })}
        </>
      )}
      {id === "demographic" && (
        <>
          <div className="tv-two-fields">{input("First name", "firstName")}{input("Last name", "lastName")}</div>
          <div className="tv-two-fields">
            <Select label="Gender" value={fields.gender} options={[{ value: "m", label: "Male" }, { value: "f", label: "Female" }]} onChange={v => set({ gender: v })} />
            {input("Date of birth", "dateOfBirth", { placeholder: "DD-MM-YYYY" })}
          </div>
        </>
      )}
      {["nin-slip", "bvn-slip", "phone-slip"].includes(id) && (
        <Select label="Slip type" value={fields.slipType} options={slipTypes.map(s => ({ value: s, label: s }))} onChange={v => set({ slipType: v })} />
      )}
      <Select label="Purpose" value={purpose} options={purposes.map(p => ({ value: p, label: p }))} onChange={setPurpose} />
      <label className="tv-terms">
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <span>I have the data subject&apos;s authorization for this request.</span>
      </label>
    </>
  );

  const steps: Array<[Step, string]> = [["form", "Details"], ["review", "Review"], ["result", "Result"]];
  const stepIndex = steps.findIndex(([key]) => key === step);

  const footer = !isApproved ? (
    <>
      <button type="button" className="tv-button-secondary" onClick={close}>Close</button>
      <button type="button" className="tv-button-primary" onClick={() => { close(); onVerifyNin(); }}><IdCard size={17} /> Verify NIN</button>
    </>
  ) : step === "form" ? (
    <>
      <button type="button" className="tv-button-secondary" onClick={close}>Cancel</button>
      <button type="submit" form="tv-request-form" className="tv-button-primary">Review <ArrowRight size={17} /></button>
    </>
  ) : step === "review" ? (
    <>
      <button type="button" className="tv-button-secondary" onClick={() => { setStep("form"); setError(""); }} disabled={loading}>Back</button>
      {insufficient
        ? <button type="button" className="tv-button-primary" onClick={() => { close(); onFundWallet(); }}><Wallet size={17} /> Fund wallet</button>
        : <button type="button" className="tv-button-primary" onClick={() => void submit()} disabled={loading} aria-busy={loading}>
            {loading && <span className="tv-button-spinner" aria-hidden="true" />}
            {loading ? "Processing" : "Confirm and generate"}
          </button>}
    </>
  ) : (
    <button type="button" className="tv-button-primary" onClick={close}>Done</button>
  );

  return (
    <Modal open={open} onClose={close} busy={loading} size="lg" title={service.name} subtitle={service.category} icon={<Icon size={20} />} footer={footer}>
      <div className="tv-request-modal">
        <aside className="tv-request-aside">
          <ServicePreview serviceId={id} />
          <p>{service.description}</p>
          <div className="tv-request-price"><span>Fee</span><strong>{step === "form" ? "Shown on review" : money(service.price_kobo)}</strong></div>
        </aside>

        <div className="tv-request-main">
          {isApproved && (
            <ol className="tv-steps" aria-label="Progress">
              {steps.map(([key, label], i) => (
                <li key={key} className={i < stepIndex ? "tv-step tv-step-done" : i === stepIndex ? "tv-step tv-step-current" : "tv-step"}>
                  <span>{i < stepIndex ? <Check size={13} /> : i + 1}</span>{label}
                </li>
              ))}
            </ol>
          )}

          {error && <div className="tv-inline-alert" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}

          {!isApproved ? (
            <div className="tv-locked">
              <Clock3 size={26} />
              <h3>Verify your NIN to activate</h3>
              <p>Add your NIN in Wallet to unlock live requests.</p>
            </div>
          ) : step === "form" ? (
            <form id="tv-request-form" className="tv-form tv-step-panel" onSubmit={review}>{detailFields}</form>
          ) : step === "review" ? (
            <div className="tv-step-panel tv-review">
              <div className="tv-price-confirmation">
                <div className="tv-price-confirmation-top">
                  <div><span>AMOUNT TO PAY</span><strong>{money(service.price_kobo)}</strong></div>
                </div>
                <div className="tv-order-line"><span>Wallet balance</span><strong>{money(balanceKobo)}</strong></div>
                <div className="tv-order-line"><span>Balance after</span><strong>{insufficient ? "Insufficient" : money(balanceKobo - service.price_kobo)}</strong></div>
              </div>
              {insufficient && <div className="tv-inline-alert" role="alert"><AlertCircle size={17} /><span>Your wallet balance is too low for this request.</span></div>}
            </div>
          ) : (
            <div className="tv-step-panel tv-result">
              <div className={payload?.processing ? "tv-result-banner tv-result-pending" : "tv-result-banner"}>
                <span className="tv-success-mark">{payload?.processing ? <Clock3 size={22} /> : <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}</span>
                <div>
                  <strong>{payload?.processing ? "Request submitted" : "Request completed"}</strong>
                  <span>Reference {String(payload?.reference ?? "")}</span>
                </div>
              </div>
              {payload?.message && <p className="tv-result-message">{payload.message}</p>}
              {!payload?.processing && (payload?.slip || payload?.result) && (
                <div className="tv-pdf-row">
                  <span>{pdfState === "failed" ? "The automatic download was blocked by your browser." : "Your PDF was downloaded automatically."}</span>
                  <button type="button" className="tv-button-secondary" onClick={() => lastPayload.current && void downloadPdf(lastPayload.current)}>
                    <ArrowDownToLine size={16} /> Download PDF
                  </button>
                </div>
              )}
              {payload?.result && typeof payload.result === "object" && <ResultView data={payload.result} />}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
