import { FileImage } from "lucide-react";
import { displayFields, extractImage } from "@/lib/pdf";

export function ResultView({ data }: { data: Record<string, unknown> }) {
  const image = extractImage(data);
  const fields = displayFields(data);
  return (
    <div className="tv-result-card">
      <div className="tv-result-photo">
        {image
          ? <img src={image} alt="Image returned by the identity provider" referrerPolicy="no-referrer" />
          : <div className="tv-result-nophoto"><FileImage size={26} /><span>No image supplied</span></div>}
      </div>
      <dl className="tv-result-fields">
        {fields.length
          ? fields.map(([key, value], i) => (
              <div key={key} style={{ animationDelay: `${Math.min(i, 12) * 0.04}s` }}>
                <dt>{key.replace(/[_-]+/g, " ")}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))
          : <div><dt>Result</dt><dd>The provider returned no displayable fields.</dd></div>}
      </dl>
    </div>
  );
}
