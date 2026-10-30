import { useState } from 'react';
import { reportToCsv, type Report } from '../../../../src/shared/report';
import { downloadText, fileSafe, useApp } from '../hooks';
import { Modal } from './ui';

/** Downloads the report as CSV, with a copy-to-clipboard fallback if the iframe blocks downloads. */
export function ExportButton({ report, name }: { report: Report; name: string }) {
  const { toast } = useApp();
  const [fallback, setFallback] = useState<string>();
  const file = `${fileSafe(name)}-${report.generatedAt.slice(0, 10)}.csv`;
  return (
    <>
      <button
        className="btn"
        onClick={() => {
          const csv = reportToCsv(report);
          if (downloadText(file, csv)) toast(`Exported ${file}`);
          else setFallback(csv);
        }}
      >
        Export CSV
      </button>
      <button className="btn subtle" onClick={() => setFallback(reportToCsv(report))} title="Show CSV to copy">
        Copy CSV
      </button>
      {fallback !== undefined && (
        <Modal
          title="CSV export"
          onClose={() => setFallback(undefined)}
          footer={
            <button
              className="btn primary"
              onClick={() =>
                navigator.clipboard.writeText(fallback).then(
                  () => toast('Copied to clipboard'),
                  () => toast('Select the text and copy it manually', 'error'),
                )
              }
            >
              Copy to clipboard
            </button>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            Copy this text and paste it into a .csv file or a spreadsheet.
          </p>
          <textarea className="input" readOnly rows={14} value={fallback} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </Modal>
      )}
    </>
  );
}
