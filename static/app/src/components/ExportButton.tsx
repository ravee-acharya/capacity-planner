import { useState } from 'react';
import { reportToCsv, type Report } from '../../../../src/shared/report';
import { downloadText, fileSafe, useApp } from '../hooks';
import { Modal } from './ui';

/** Downloads the report as CSV; "Copy CSV" shows the text for pasting straight into a spreadsheet. */
export function ExportButton({ report, name }: { report: Report; name: string }) {
  const { toast } = useApp();
  const [csv, setCsv] = useState<string>();
  const file = `${fileSafe(name)}-${report.generatedAt.slice(0, 10)}.csv`;
  return (
    <>
      <button
        className="btn"
        onClick={() => {
          const text = reportToCsv(report);
          if (downloadText(file, text)) toast(`Downloaded ${file}`);
          else setCsv(text);
        }}
      >
        Export CSV
      </button>
      <button className="btn subtle" onClick={() => setCsv(reportToCsv(report))} title="Show the CSV to copy into a spreadsheet">
        Copy CSV
      </button>
      {csv !== undefined && (
        <Modal
          title="Copy CSV"
          onClose={() => setCsv(undefined)}
          footer={
            <button
              className="btn primary"
              onClick={() =>
                navigator.clipboard.writeText(csv).then(
                  () => toast('CSV copied – paste it into Excel or Google Sheets'),
                  () => toast('Select the text and press Ctrl+C to copy', 'error'),
                )
              }
            >
              Copy to clipboard
            </button>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            Paste this into Excel or Google Sheets. If the copy button doesn't work, click in the box, press Ctrl+A, then Ctrl+C.
          </p>
          <textarea className="input" readOnly rows={12} value={csv} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </Modal>
      )}
    </>
  );
}
