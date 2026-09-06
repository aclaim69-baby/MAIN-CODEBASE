import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Record } from './store';
import { fuelReasonLabel } from './lib/fuelAnalysis';

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Returns image dimensions from a data URL so we can fit it proportionally.
 */
async function getImageDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}

export async function generatePDF(record: Record, logoUrlOrDataUrl?: string | null): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;

  // ── Resolve logo data URL ──────────────────────────────────
  const logoDataUrl =
    logoUrlOrDataUrl?.startsWith('data:')
      ? logoUrlOrDataUrl
      : logoUrlOrDataUrl
      ? await fetchAsDataUrl(logoUrlOrDataUrl)
      : null;

  // ── BRANDED HEADER BAND ────────────────────────────────────
  // Dark blue header bar spanning full width
  const HEADER_H = 28;
  doc.setFillColor(30, 58, 138); // deep blue #1E3A8A
  doc.rect(0, 0, pageW, HEADER_H, 'F');

  // Thin accent stripe at bottom of header
  doc.setFillColor(59, 130, 246); // lighter blue #3B82F6
  doc.rect(0, HEADER_H - 1.5, pageW, 1.5, 'F');

  let logoPlacedWidth = 0;

  // ── Logo inside header (left side) ────────────────────────
  if (logoDataUrl) {
    try {
      const { w: iw, h: ih } = await getImageDimensions(logoDataUrl);
      const maxH = 18; // max logo height within header
      const maxW = 55; // max logo width
      const aspect = iw / ih;
      let drawH = maxH;
      let drawW = drawH * aspect;
      if (drawW > maxW) { drawW = maxW; drawH = drawW / aspect; }

      const logoX = margin;
      const logoY = (HEADER_H - drawH) / 2;
      doc.addImage(logoDataUrl, 'PNG', logoX, logoY, drawW, drawH);
      logoPlacedWidth = drawW + 6; // gap after logo
    } catch { /* skip logo if error */ }
  }

  // ── Report title inside header (right of logo) ─────────────
  const titleX = margin + logoPlacedWidth;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('DAILY CHECKING REPORT', titleX, HEADER_H / 2 + 2, { baseline: 'middle' });

  // Sub-label on the right
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(186, 230, 253); // light blue
  const refLabel = `Ref: ${record.refId}   |   ${record.date}`;
  doc.text(refLabel, pageW - margin, HEADER_H / 2 + 2, { align: 'right', baseline: 'middle' });

  // ── Content starts below header ────────────────────────────
  let y = HEADER_H + 10;

  // ── Details grid (2 columns) ──────────────────────────────
  const leftCol  = margin;
  const rightCol = pageW / 2 + 5;

  const details: [string, string][] = [
    ['Department',       record.departmentName],
    ['Section',          record.sectionName],
    ['Equipment Type',   `${record.equipmentTypeName} (${record.equipmentTypeCode})`],
    ['Equipment No.',    record.equipmentNumber || '—'],
    ['Date',             record.date],
    ['Start Time',       record.startTime],
    ['Completion Time',  record.completionTime],
    ['Hour Meter Reading', record.hourMeterReading],
    ...(record.fuelCanDetermine === 'yes' && record.fuelLevel
      ? [['Fuel Level', `${record.fuelLevel}%`] as [string, string]]
      : record.fuelCanDetermine === 'no'
      ? [['Fuel Level', `Cannot determine — ${fuelReasonLabel(record.fuelUndeterminedReason)}`] as [string, string]]
      : []),
    ['Technician Name',  record.technicianName],
    ['Supervisor Name',  record.supervisorName],
    ['QC Verifier',      record.qcVerifierName || '—'],
  ];

  doc.setFontSize(9);
  details.forEach(([label, value], i) => {
    const col  = i % 2 === 0 ? leftCol : rightCol;
    const rowY = y + Math.floor(i / 2) * 9;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(107, 105, 99);
    doc.text(`${label}:`, col, rowY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(26, 26, 24);
    doc.text(value, col + 44, rowY);
  });
  y += Math.ceil(details.length / 2) * 9 + 6;

  // ── Divider ───────────────────────────────────────────────
  doc.setDrawColor(30, 58, 138);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  // ── Checklist section label ───────────────────────────────
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 138);
  doc.text('CHECKLIST', margin, y);
  y += 6;

  // ── Checklist table ───────────────────────────────────────
  const tableRows: (string | { content: string; colSpan: number; styles: object })[][] =
    record.checklistResponses.map((r) => {
      if (r.isSubheading) {
        return [
          {
            content: r.label,
            colSpan: 4,
            styles: {
              fontStyle: 'bold' as const,
              fillColor: [219, 234, 254] as [number, number, number],
              textColor: [30, 64, 175]  as [number, number, number],
              fontSize: 9,
            },
          },
        ];
      }
      return [r.label, r.status || '—', r.comment || '—', r.actionPlan || '—'];
    });

  autoTable(doc, {
    startY: y,
    head:   [['Check', 'Status', 'Comment', 'Action Plan']],
    body:   tableRows,
    margin: { left: margin, right: margin },
    styles: {
      fontSize:    9,
      cellPadding: 3,
      lineColor:   [220, 220, 220],
      lineWidth:   0.1,
    },
    headStyles: {
      fillColor:  [30, 58, 138],
      textColor:  [255, 255, 255],
      fontStyle:  'bold',
      fontSize:   8,
    },
    bodyStyles: {
      textColor: [26, 26, 24],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 26 },
      2: { cellWidth: 60 },
      3: { cellWidth: 60 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const val = data.cell.raw as string;
        if (val === 'NOT OK') {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        } else if (val === 'OK') {
          data.cell.styles.textColor = [22, 101, 52];
        } else if (val === 'N/A') {
          data.cell.styles.textColor = [107, 105, 99];
        }
      }
    },
  });

  // ── After table ───────────────────────────────────────────
  let finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── Urgent Attention Assessment ─────────────────────────────
  {
    if (finalY > pageH - 40) {
      doc.addPage();
      finalY = margin + 10;
    }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.text('URGENT ATTENTION ASSESSMENT', margin, finalY);
    finalY += 6;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    if (record.requiresUrgentAttention) {
      doc.setTextColor(185, 28, 28); // red
      doc.text('YES — Urgent Attention Required', margin, finalY);
    } else {
      doc.setTextColor(22, 101, 52); // green
      doc.text('NO — No Urgent Attention Required', margin, finalY);
    }
    finalY += 6;

    if (record.requiresUrgentAttention && record.urgentAttentionReason?.trim()) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(58, 57, 53);
      const reasonLines = doc.splitTextToSize(record.urgentAttentionReason.trim(), pageW - margin * 2);
      doc.text(reasonLines, margin, finalY);
      finalY += reasonLines.length * 5 + 4;
    }

    finalY += 4;
  }

  // ── Additional Comments ───────────────────────────────────
  if (record.additionalComment?.trim()) {
    // Check if we need a new page
    if (finalY > pageH - 40) {
      doc.addPage();
      finalY = margin + 10;
    }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.text('ADDITIONAL COMMENTS', margin, finalY);
    finalY += 6;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(58, 57, 53);
    const commentLines = doc.splitTextToSize(record.additionalComment.trim(), pageW - margin * 2);
    doc.text(commentLines, margin, finalY);
    finalY += commentLines.length * 5 + 6;
  }

  // ── Footer bar ────────────────────────────────────────────
  const footerY = pageH - 8;
  doc.setFillColor(241, 245, 249);
  doc.rect(0, footerY - 4, pageW, 12, 'F');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Generated: ${new Date().toLocaleString()}   |   Daily Checking System   |   Ref: ${record.refId}`,
    pageW / 2,
    footerY,
    { align: 'center' }
  );

  doc.save(`DailyChecking-${record.refId}.pdf`);
}

export function formatDate(isoDate: string): string {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-GB', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  });
}

export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}
