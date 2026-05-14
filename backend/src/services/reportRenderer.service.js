// Tier 4 #15 — Report rendering (CSV / XLSX / PDF).
// Input: builder envelope { title, columns, rows, summary? }
// Output: { contentType, filename, buffer } so callers can stream or attach.

const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

function fmtCell(value, format) {
  if (value == null || value === '') return '';
  if (format === 'date') {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
  }
  if (format === 'datetime') {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
  }
  if (format === 'money') {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : String(value);
  }
  if (format === 'pct') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return (n * 100).toFixed(1) + '%';
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toCsvRow(values) {
  return values
    .map((v) => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(',');
}

function renderCsv(envelope) {
  const header = envelope.columns.map((c) => c.label);
  const lines = [toCsvRow(header)];
  for (const row of envelope.rows) {
    lines.push(toCsvRow(envelope.columns.map((c) => fmtCell(row[c.key], c.format))));
  }
  return {
    contentType: 'text/csv; charset=utf-8',
    filename: `${slug(envelope.title)}.csv`,
    buffer: Buffer.from(lines.join('\r\n'), 'utf-8'),
  };
}

async function renderXlsx(envelope) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RPE Chain';
  wb.created = new Date();
  const ws = wb.addWorksheet(envelope.title.slice(0, 31) || 'Report');
  ws.addRow(envelope.columns.map((c) => c.label));
  ws.getRow(1).font = { bold: true };
  for (const row of envelope.rows) {
    ws.addRow(envelope.columns.map((c) => {
      const v = row[c.key];
      if (v == null) return '';
      if (c.format === 'date' || c.format === 'datetime') {
        const d = v instanceof Date ? v : new Date(v);
        return Number.isNaN(d.getTime()) ? String(v) : d;
      }
      if (c.format === 'money' || c.format === 'pct') {
        const n = Number(v);
        return Number.isFinite(n) ? n : v;
      }
      return v;
    }));
  }
  // Auto-size columns (rough heuristic — bounded width)
  envelope.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    let maxLen = c.label.length;
    for (const row of envelope.rows) {
      const s = fmtCell(row[c.key], c.format);
      if (s.length > maxLen) maxLen = s.length;
    }
    col.width = Math.min(40, Math.max(8, maxLen + 2));
    if (c.format === 'money') col.numFmt = '#,##0.00';
    if (c.format === 'pct') col.numFmt = '0.0%';
    if (c.format === 'date') col.numFmt = 'yyyy-mm-dd';
    if (c.format === 'datetime') col.numFmt = 'yyyy-mm-dd hh:mm';
  });
  const buf = await wb.xlsx.writeBuffer();
  return {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: `${slug(envelope.title)}.xlsx`,
    buffer: Buffer.from(buf),
  };
}

function renderPdf(envelope) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve({
        contentType: 'application/pdf',
        filename: `${slug(envelope.title)}.pdf`,
        buffer: Buffer.concat(chunks),
      }));
      doc.on('error', reject);

      doc.fontSize(16).text(envelope.title, { align: 'left' });
      doc.fontSize(9).fillColor('#666').text(`Generated ${new Date().toISOString()}`);
      doc.moveDown(0.5);
      doc.fillColor('#000');

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colWidth = pageWidth / envelope.columns.length;
      const rowHeight = 16;
      let y = doc.y;

      // Header
      doc.font('Helvetica-Bold').fontSize(8);
      envelope.columns.forEach((c, i) => {
        doc.text(c.label, doc.page.margins.left + i * colWidth, y, {
          width: colWidth - 4, height: rowHeight, ellipsis: true,
        });
      });
      y += rowHeight;
      doc.moveTo(doc.page.margins.left, y - 2)
        .lineTo(doc.page.margins.left + pageWidth, y - 2)
        .strokeColor('#999').stroke();

      // Rows
      doc.font('Helvetica').fontSize(8);
      const maxRows = Math.min(envelope.rows.length, 5000); // safety cap
      for (let r = 0; r < maxRows; r += 1) {
        const row = envelope.rows[r];
        if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        envelope.columns.forEach((c, i) => {
          doc.text(fmtCell(row[c.key], c.format), doc.page.margins.left + i * colWidth, y, {
            width: colWidth - 4, height: rowHeight, ellipsis: true,
          });
        });
        y += rowHeight;
      }
      if (envelope.rows.length > maxRows) {
        doc.moveDown().font('Helvetica-Oblique').fontSize(8)
          .text(`(truncated — showing ${maxRows} of ${envelope.rows.length} rows)`);
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function slug(s) {
  return String(s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
}

async function render(envelope, format) {
  const fmt = String(format || 'csv').toLowerCase();
  if (fmt === 'csv') return renderCsv(envelope);
  if (fmt === 'xlsx') return renderXlsx(envelope);
  if (fmt === 'pdf') return renderPdf(envelope);
  const err = new Error(`Unsupported format: ${format}`);
  err.status = 400;
  err.code = 'REPORT_FORMAT_INVALID';
  throw err;
}

module.exports = { render, renderCsv, renderXlsx, renderPdf };
