import { useState } from 'react';
import { reportToCsv, type Report } from '../../../../src/shared/report';
import { downloadText, fileSafe, useApp } from '../hooks';
import { Modal } from './ui';

/**
 * Exports the report as CSV. Jira's app frame can block downloads silently (the app cannot
 * detect it), so the CSV is always shown too, ready to copy.
 */
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
          downloadText(file, text);
          setCsv(text);
        }}
      >
        Export CSV
      </button>
      {csv !== undefined && (
        <Modal
          title="Export CSV"
          onClose={() => setCsv(undefined)}
          footer={
            <>
              <button className="btn subtle" onClick={() => downloadText(file, csv)}>
                Try download again
              </button>
              <button
                className="btn primary"
                onClick={() =>
                  navigator.clipboard.writeText(csv).then(
                    () => toast('CSV copied – paste it into Excel or Google Sheets'),
                    () => toast('Select the text and copy it manually', 'error'),
                  )
                }
              >
                Copy to clipboard
              </button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            If <strong>{file}</strong> didn't download (Jira can block downloads from apps), copy the CSV below and paste it into Excel or Google Sheets.
          </p>
          <textarea className="input" readOnly rows={12} value={csv} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </Modal>
      )}
    </>
  );
}
