const IMAGE_KEYS = ["photo_url", "image_url", "photo", "image", "picture", "portrait", "face_image"];
const HIDDEN_KEYS = [...IMAGE_KEYS, "signature", "signature_url", "signature_base64"];

const ascii = (value: string) => value.replace(/₦/g, "NGN ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "");
const titleCase = (key: string) => key.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const slug = (value: string) => value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadBase64Pdf(base64: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  triggerDownload(new Blob([bytes], { type: "application/pdf" }), fileName || "TopVerify-document.pdf");
}

export function extractImage(data: Record<string, unknown>): string | null {
  const raw = IMAGE_KEYS.map(key => data[key]).find(v => typeof v === "string" && v.length > 80) as string | undefined;
  if (!raw) return null;
  if (raw.startsWith("data:image/")) return raw;
  if (raw.startsWith("https://")) return raw;
  if (/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length > 1000) return `data:image/${raw.startsWith("iVBOR") ? "png" : "jpeg"};base64,${raw}`;
  return null;
}

export function displayFields(data: Record<string, unknown>) {
  return Object.entries(data).filter(([key, value]) =>
    !HIDDEN_KEYS.includes(key) &&
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
    String(value).trim().length > 0
  ) as Array<[string, string | number | boolean]>;
}

export async function downloadResultPdf(options: { serviceName: string; reference: string; data: Record<string, unknown> }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 42;
  const brand: [number, number, number] = [31, 63, 184];

  doc.setFillColor(...brand);
  doc.rect(0, 0, W, 92, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("TopVerify", M, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(207, 220, 255);
  doc.text("Identity verification report", M, 70);
  doc.setFontSize(10);
  doc.text(ascii(new Date().toLocaleString("en-NG", { dateStyle: "long", timeStyle: "short" })), W - M, 50, { align: "right" });

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(ascii(options.serviceName), M, 128);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Reference: ${ascii(options.reference || "-")}`, M, 146);

  let y = 170;
  const image = extractImage(options.data);
  if (image && image.startsWith("data:image/")) {
    try {
      doc.addImage(image, image.includes("png") ? "PNG" : "JPEG", W - M - 110, 112, 110, 132);
      y = 262;
    } catch {
      y = 170;
    }
  }

  const fields = displayFields(options.data);
  const labelW = 160;
  const valueW = W - M * 2 - labelW - 16;
  fields.forEach(([key, value], index) => {
    const lines = doc.splitTextToSize(ascii(String(value)), valueW) as string[];
    const rowH = Math.max(28, lines.length * 14 + 14);
    if (y + rowH > H - 70) { doc.addPage(); y = M; }
    if (index % 2 === 0) { doc.setFillColor(244, 247, 252); doc.rect(M, y, W - M * 2, rowH, "F"); }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(ascii(titleCase(key)).toUpperCase(), M + 10, y + 17);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(lines, M + labelW + 6, y + 17);
    y += rowH;
  });
  if (!fields.length) {
    doc.setFontSize(11);
    doc.setTextColor(100, 116, 139);
    doc.text("The provider returned no displayable fields for this request.", M, y + 10);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(228, 232, 241);
    doc.line(M, H - 48, W - M, H - 48);
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text("Confidential. Provided for the authorized purpose only. Not a government-issued document.", M, H - 32);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 32, { align: "right" });
  }

  doc.save(`TopVerify-${slug(options.serviceName)}-${slug(options.reference || "report")}.pdf`);
}
