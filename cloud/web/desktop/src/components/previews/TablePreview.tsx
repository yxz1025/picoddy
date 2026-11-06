import { useState, useEffect } from "react";

interface TablePreviewProps {
  filePath: string;
}

export default function TablePreview({ filePath }: TablePreviewProps) {
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/preview?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setSheets(data.sheets || []);
          setActiveSheet(0);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (loading) return <div className="preview-loading">加载中...</div>;
  if (error) return <div className="preview-error">预览失败: {error}</div>;
  if (sheets.length === 0) return <div className="preview-empty">空表格</div>;

  const sheet = sheets[activeSheet] || sheets[0];
  const { rows } = sheet;

  return (
    <div className="preview-table">
      {sheets.length > 1 && (
        <div className="preview-table-tabs">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              className={`preview-table-tab${i === activeSheet ? " active" : ""}`}
              onClick={() => setActiveSheet(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="preview-table-wrap">
        <table>
          {rows.length > 0 && (
            <thead>
              <tr>
                {rows[0].map((cell, ci) => (
                  <th key={ci}>{cell}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.slice(1).map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
