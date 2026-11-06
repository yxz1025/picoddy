import { useState } from "react";
import "./TableWidget.css";

interface TableWidgetProps {
  title?: string;
  columns?: string[];
  data?: Record<string, any>[];
  rawText?: string;
  filePath?: string;
}

export default function TableWidget({ title = "表格数据", columns = [], data = [], rawText, filePath }: TableWidgetProps) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  // 解析简易 CSV/TSV 如果没有提供 structured data
  let displayColumns = columns;
  let displayRows = data;

  if (displayRows.length === 0 && rawText) {
    const lines = rawText.trim().split("\n").filter(Boolean);
    if (lines.length > 0) {
      displayColumns = lines[0].split(/[,|\t]/).map((c) => c.trim().replace(/^["']|["']$/g, ""));
      displayRows = lines.slice(1).map((line) => {
        const cells = line.split(/[,|\t]/).map((c) => c.trim().replace(/^["']|["']$/g, ""));
        const rowObj: Record<string, string> = {};
        displayColumns.forEach((col, idx) => {
          rowObj[col] = cells[idx] ?? "";
        });
        return rowObj;
      });
    }
  }

  // 搜索过滤
  const filteredRows = displayRows.filter((row) =>
    Object.values(row).some((val) => String(val).toLowerCase().includes(search.toLowerCase()))
  );

  // 排序
  if (sortCol) {
    filteredRows.sort((a, b) => {
      const valA = a[sortCol] ?? "";
      const valB = b[sortCol] ?? "";
      if (typeof valA === "number" && typeof valB === "number") {
        return sortAsc ? valA - valB : valB - valA;
      }
      return sortAsc
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
  }

  const handleHeaderClick = (col: string) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  return (
    <div className="table-widget">
      <div className="table-widget-header">
        <div className="table-widget-title">
          <span>📊</span>
          <span>{title}</span>
          <span className="table-row-count">({filteredRows.length} 行)</span>
        </div>
        <div className="table-widget-actions">
          <input
            type="text"
            className="table-search-input"
            placeholder="在表格中搜索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {filePath && (
            <button
              className="table-float-btn"
              onClick={() => window.open(`file://${filePath}`)}
              title="打开原文件"
            >
              ↗ 打开
            </button>
          )}
        </div>
      </div>

      <div className="table-widget-body">
        {displayColumns.length === 0 ? (
          <div className="table-empty">暂无有效表格数据</div>
        ) : (
          <table className="gen-table">
            <thead>
              <tr>
                {displayColumns.map((col) => (
                  <th key={col} onClick={() => handleHeaderClick(col)} className="sortable-th">
                    {col} {sortCol === col ? (sortAsc ? "▲" : "▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 100).map((row, idx) => (
                <tr key={idx}>
                  {displayColumns.map((col) => (
                    <td key={col}>{String(row[col] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {filteredRows.length > 100 && (
        <div className="table-widget-footer">仅展示前 100 条记录，更多数据请打开完整表格查看</div>
      )}
    </div>
  );
}
