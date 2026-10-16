type Kind = "report" | "slip" | "image-report" | "clearance" | "modify";

export function previewKind(serviceId: string): Kind {
  if (["nin-slip", "bvn-slip", "phone-slip"].includes(serviceId)) return "slip";
  if (serviceId === "nin-image-report") return "image-report";
  if (serviceId === "ipe-clearance") return "clearance";
  if (serviceId === "nin-modification") return "modify";
  return "report";
}

const rows = [0, 1, 2, 3];

function Person({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle className="pv-person" cx="0" cy="-8" r="11" />
      <path className="pv-person" d="M-20 22c0-12 9-18 20-18s20 6 20 18z" />
    </g>
  );
}

function Illustration({ kind }: { kind: Kind }) {
  if (kind === "slip") {
    return (
      <svg viewBox="0 0 320 190" role="img" aria-label="Sample slip preview">
        <g className="pv-float">
          <rect className="pv-card" x="36" y="28" width="248" height="134" rx="14" />
          <rect className="pv-brand" x="36" y="28" width="248" height="28" rx="14" />
          <rect className="pv-brand" x="36" y="42" width="248" height="14" />
          <rect className="pv-on-brand" x="52" y="38" width="70" height="6" rx="3" />
          <rect className="pv-soft" x="52" y="72" width="66" height="76" rx="8" />
          <Person x={85} y={108} />
          {rows.slice(0, 3).map(i => (
            <g key={i} className="pv-row" style={{ animationDelay: `${i * 0.14}s` }}>
              <rect className="pv-line" x="134" y={72 + i * 17} width="34" height="5" rx="2.5" />
              <rect className="pv-ink" x="134" y={81 + i * 17} width={92 - i * 12} height="6" rx="3" />
            </g>
          ))}
          <g className="pv-qr">
            {[0, 1, 2, 3].flatMap(r => [0, 1, 2, 3].map(c => ((r * 3 + c * 5) % 3 !== 0 ? <rect key={`${r}${c}`} className="pv-ink" x={238 + c * 9} y={110 + r * 9} width="7" height="7" rx="1.5" /> : null)))}
          </g>
          <rect className="pv-scan" x="52" y="72" width="66" height="3" rx="1.5" />
        </g>
      </svg>
    );
  }
  if (kind === "image-report") {
    return (
      <svg viewBox="0 0 320 190" role="img" aria-label="Sample image and written report preview">
        <g className="pv-float">
          <rect className="pv-card" x="62" y="12" width="196" height="166" rx="14" />
          <rect className="pv-brand" x="62" y="12" width="196" height="30" rx="14" />
          <rect className="pv-brand" x="62" y="28" width="196" height="14" />
          <rect className="pv-on-brand" x="78" y="23" width="80" height="6" rx="3" />
          <rect className="pv-soft" x="78" y="54" width="62" height="76" rx="8" />
          <Person x={109} y={92} />
          {rows.map(i => (
            <g key={i} className="pv-row" style={{ animationDelay: `${i * 0.14}s` }}>
              <rect className="pv-line" x="152" y={56 + i * 19} width="30" height="5" rx="2.5" />
              <rect className="pv-ink" x="152" y={65 + i * 19} width={84 - (i % 2) * 18} height="6" rx="3" />
            </g>
          ))}
          <rect className="pv-line" x="78" y="142" width="164" height="5" rx="2.5" />
          <rect className="pv-line" x="78" y="154" width="120" height="5" rx="2.5" />
          <rect className="pv-scan" x="78" y="54" width="62" height="3" rx="1.5" />
        </g>
      </svg>
    );
  }
  if (kind === "clearance") {
    return (
      <svg viewBox="0 0 320 190" role="img" aria-label="Sample clearance preview">
        <g className="pv-float">
          <circle className="pv-halo" cx="160" cy="88" r="66" />
          <path className="pv-shield" d="M160 26l50 18v42c0 34-22 55-50 66-28-11-50-32-50-66V44z" />
          <path className="pv-check" d="M137 90l17 17 31-35" />
        </g>
        {[0, 1, 2].map(i => (
          <g key={i} className="pv-row" style={{ animationDelay: `${0.3 + i * 0.2}s` }}>
            <circle className={i < 2 ? "pv-dot-on" : "pv-dot"} cx={128 + i * 32} cy="176" r="5" />
          </g>
        ))}
      </svg>
    );
  }
  if (kind === "modify") {
    return (
      <svg viewBox="0 0 320 190" role="img" aria-label="Sample record update preview">
        <g className="pv-float">
          <rect className="pv-card" x="62" y="14" width="196" height="162" rx="14" />
          <rect className="pv-brand" x="62" y="14" width="196" height="30" rx="14" />
          <rect className="pv-brand" x="62" y="30" width="196" height="14" />
          <rect className="pv-on-brand" x="78" y="25" width="76" height="6" rx="3" />
          {[0, 1].map(i => (
            <g key={i} className="pv-row" style={{ animationDelay: `${i * 0.2}s` }}>
              <rect className="pv-line" x="78" y={60 + i * 44} width="40" height="5" rx="2.5" />
              <rect className="pv-old" x="78" y={70 + i * 44} width="90" height="7" rx="3.5" />
              <rect className="pv-strike" x="78" y={73 + i * 44} width="90" height="1.6" />
              <rect className="pv-new" x="78" y={83 + i * 44} width="120" height="7" rx="3.5" />
            </g>
          ))}
          <rect className="pv-line" x="78" y="150" width="150" height="5" rx="2.5" />
          <g className="pv-pencil" transform="translate(226 112) rotate(40)">
            <rect className="pv-ink" x="-5" y="-30" width="10" height="46" rx="3" />
            <path className="pv-brand" d="M-5 16h10l-5 11z" />
          </g>
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 320 190" role="img" aria-label="Sample verification report preview">
      <g className="pv-float">
        <rect className="pv-card" x="62" y="12" width="196" height="166" rx="14" />
        <rect className="pv-brand" x="62" y="12" width="196" height="38" rx="14" />
        <rect className="pv-brand" x="62" y="34" width="196" height="16" />
        <rect className="pv-on-brand" x="78" y="25" width="64" height="6" rx="3" />
        <rect className="pv-on-brand-soft" x="78" y="36" width="40" height="4" rx="2" />
        <circle className="pv-ok" cx="238" cy="31" r="10" />
        <path className="pv-tick" d="M233 31l4 4 7-8" />
        <Person x={102} y={92} s={0.9} />
        {rows.map(i => (
          <g key={i} className="pv-row" style={{ animationDelay: `${i * 0.14}s` }}>
            <rect className="pv-line" x="136" y={62 + i * 17} width="30" height="5" rx="2.5" />
            <rect className="pv-ink" x="136" y={71 + i * 17} width={92 - (i % 3) * 14} height="6" rx="3" />
          </g>
        ))}
        {[0, 1].map(i => <rect key={i} className="pv-line" x="78" y={142 + i * 14} width={160 - i * 36} height="5" rx="2.5" />)}
        <rect className="pv-scan" x="62" y="50" width="196" height="3" rx="1.5" />
      </g>
    </svg>
  );
}

export function ServicePreview({ serviceId, compact }: { serviceId: string; compact?: boolean }) {
  const kind = previewKind(serviceId);
  return (
    <div className={compact ? `tv-preview tv-preview-${kind} tv-preview-compact` : `tv-preview tv-preview-${kind}`}>
      <Illustration kind={kind} />
      <span className="tv-preview-tag">Sample preview</span>
    </div>
  );
}
