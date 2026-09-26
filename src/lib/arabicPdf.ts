import { jsPDF } from 'jspdf';
import { CAIRO_FONT_B64 } from './cairoFontBase64';

const MARGIN_MM = 8;
const PAGE_W = 210;
const PAGE_H = 297;
const USABLE_W = PAGE_W - MARGIN_MM * 2;
const BRAND = '#0066CC';

interface FontSpec {
  size: number;
  color: string;
}

/**
 * jsPDF 4.x natively shapes Arabic (joining) via its internal arabic module and
 * emits a CIDFontType2/Identity-H subset with a ToUnicode map, so the Arabic
 * text in the resulting PDF is BOTH correctly shaped AND selectable/copyable.
 *
 * This module draws real text (no canvas rasterization) using an embedded Cairo
 * TrueType font. The variable font registers as "Cairo" (regular weight); visual
 * hierarchy is preserved via font size + color since a separate bold file is not
 * bundled.
 */

// Register the Cairo TTF once per JS context.
let fontReady: boolean | null = null;
function ensureFont(doc: jsPDF): void {
  if (fontReady) return;
  doc.addFileToVFS('Cairo.ttf', CAIRO_FONT_B64);
  doc.addFont('Cairo.ttf', 'Cairo', 'normal');
  fontReady = true;
}

export type PdfBlock =
  | { kind: 'header'; lines: { text: string; bold?: boolean; size?: number; color?: string }[] }
  | { kind: 'docTitle'; text: string }
  | { kind: 'docId'; text: string }
  | { kind: 'section'; text: string }
  | { kind: 'kv'; label: string; value: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'divider' }
  | { kind: 'footer'; lines: string[] }
  | { kind: 'signature'; text: string; sub?: string };

export interface ArabicDocOptions {
  filename: string;
  blocks: PdfBlock[];
}

export interface ClinicBrand {
  clinicName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Clinic letterhead. Only non-empty fields are rendered; returns [] when
 * there is no clinic data, so documents never show placeholders.
 */
export const clinicHeaderBlock = (profile?: ClinicBrand | null): PdfBlock[] => {
  const lines: { text: string; bold?: boolean; size?: number; color?: string }[] = [];
  const name = profile?.clinicName?.trim();
  const address = profile?.address?.trim();
  const contact = [profile?.phone?.trim(), profile?.email?.trim()].filter(Boolean).join(' | ');
  if (name) lines.push({ text: name, bold: true, size: 18, color: BRAND });
  if (address) lines.push({ text: address, size: 11, color: '#555555' });
  if (contact) lines.push({ text: contact, size: 10, color: '#888888' });
  if (!lines.length) return [];
  return [{ kind: 'header', lines }];
};

export const docTimestamp = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const docStamp = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export const footerBlock = (docId: string): PdfBlock[] => [
  { kind: 'divider' },
  { kind: 'footer', lines: ['سري — خاص بالعيادة', `تم الإنشاء: ${docTimestamp()}`, `${docId}`] },
];

// ---- text helpers built on jsPDF metrics (real selectable text) ----

function setFont(doc: jsPDF, spec: FontSpec): void {
  doc.setFont('Cairo');
  doc.setFontSize(spec.size);
  doc.setTextColor(...docStrColor(spec.color));
}

function docStrColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [51, 51, 51];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** RTL-aware word wrap using real glyph metrics. */
function wrapLines(doc: jsPDF, text: string, maxWidthMm: number): string[] {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (doc.getTextWidth(test) > maxWidthMm && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * Draw one line of text right-aligned to `rightX` (the right edge in mm).
 * `isRtl` enables jsPDF's bidi engine so mixed Arabic/Latin is reordered
 * correctly and the whole line is drawn right-aligned.
 */
function drawLine(
  doc: jsPDF,
  text: string,
  rightX: number,
  y: number,
  opts: { rtl?: boolean } = {}
): void {
  doc.text(text, rightX, y, {
    align: 'right',
    isInputRtl: opts.rtl !== false,
    isSymmetricSwapping: true,
    maxWidth: rightX - MARGIN_MM,
  });
}

// ---- block measurement (in mm) ----

interface MeasuredTable {
  colW: number[];
  rowHeights: number[];
  headerH: number;
}

function measureTable(doc: jsPDF, b: Extract<PdfBlock, { kind: 'table' }>): MeasuredTable {
  doc.setFont('Cairo');
  const cellPad = 3;
  const contentW = USABLE_W;
  const colW = b.headers.map((h, ci) => {
    doc.setFontSize(9.5);
    let w = doc.getTextWidth(h) + cellPad * 2;
    doc.setFontSize(9);
    for (const row of b.rows) {
      w = Math.max(w, doc.getTextWidth(String(row[ci] ?? '')) + cellPad * 2);
    }
    return Math.min(w, contentW * 0.6);
  });
  const total = colW.reduce((a, x) => a + x, 0);
  const scale = total > contentW ? contentW / total : 1;
  const scaled = colW.map((w) => w * scale);
  const rowHeights = b.rows.map((row) => {
    let lines = 1;
    doc.setFontSize(9);
    row.forEach((c, i) => {
      lines = Math.max(lines, wrapLines(doc, String(c ?? ''), scaled[i] - cellPad * 2).length);
    });
    return Math.max(6, lines * 4.5 + 2);
  });
  return { colW: scaled, rowHeights, headerH: 7 };
}

function measureBlock(doc: jsPDF, b: PdfBlock): number {
  switch (b.kind) {
    case 'header': {
      let h = 0;
      for (const l of b.lines) h += (l.size ?? 12) * 0.8 + 2;
      return h + 3;
    }
    case 'docTitle': return 11;
    case 'docId': return 7;
    case 'section': return 9;
    case 'kv': {
      doc.setFontSize(9);
      const labelW = doc.getTextWidth(b.label) + 3;
      const valueW = USABLE_W - labelW - 3;
      const lines = wrapLines(doc, b.value || '', valueW);
      return Math.max(6, lines.length * 5 + 2);
    }
    case 'paragraph': {
      doc.setFontSize(9);
      return wrapLines(doc, b.text, USABLE_W).length * 5 + 2;
    }
    case 'divider': return 5;
    case 'footer': return b.lines.length * 4.6 + 2;
    case 'signature': return 14;
    case 'table': {
      const t = measureTable(doc, b);
      return t.headerH + t.rowHeights.reduce((a, x) => a + x, 0) + 3;
    }
  }
}

// ---- drawing (mm coordinates, y measured from top) ----

export const exportArabicDocumentPdf = ({ filename, blocks }: ArabicDocOptions): void => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  ensureFont(doc);
  doc.setFont('Cairo');

  const HEADER_GAP = 0;
  let y = MARGIN_MM + HEADER_GAP;
  const BOTTOM = PAGE_H - MARGIN_MM;

  const newPage = () => {
    doc.addPage();
    y = MARGIN_MM + HEADER_GAP;
  };

  const drawBlock = (b: PdfBlock): void => {
    switch (b.kind) {
      case 'header': {
        for (const l of b.lines) {
          const size = l.size ?? 12;
          setFont(doc, { size, color: l.color ?? '#333333' });
          const rightX = PAGE_W - MARGIN_MM;
          drawLine(doc, l.text, rightX, y + size * 0.6, { rtl: true });
          y += size * 0.8 + 2;
        }
        y += 2;
        break;
      }
      case 'docTitle': {
        setFont(doc, { size: 15, color: BRAND });
        drawLine(doc, b.text, PAGE_W - MARGIN_MM, y + 5, { rtl: true });
        y += 11;
        break;
      }
      case 'docId': {
        setFont(doc, { size: 9, color: '#888888' });
        drawLine(doc, b.text, PAGE_W - MARGIN_MM, y + 4, { rtl: true });
        y += 7;
        break;
      }
      case 'section': {
        setFont(doc, { size: 10, color: '#333333' });
        drawLine(doc, b.text, PAGE_W - MARGIN_MM, y + 4, { rtl: true });
        doc.setDrawColor(221, 221, 221);
        doc.setLineWidth(0.2);
        doc.line(MARGIN_MM, y + 7, PAGE_W - MARGIN_MM, y + 7);
        y += 9;
        break;
      }
      case 'kv': {
        setFont(doc, { size: 9, color: '#555555' });
        const labelW = doc.getTextWidth(b.label) + 3;
        const labelX = PAGE_W - MARGIN_MM - labelW;
        drawLine(doc, b.label, PAGE_W - MARGIN_MM, y + 4, { rtl: true });
        setFont(doc, { size: 9, color: '#111111' });
        const valueW = labelX - MARGIN_MM;
        const lines = wrapLines(doc, b.value || '', valueW);
        lines.forEach((ln, i) => drawLine(doc, ln, labelX - 2, y + 4 + i * 5, { rtl: true }));
        y += Math.max(6, lines.length * 5 + 2);
        break;
      }
      case 'paragraph': {
        setFont(doc, { size: 9, color: '#111111' });
        const lines = wrapLines(doc, b.text, USABLE_W);
        lines.forEach((ln, i) => drawLine(doc, ln, PAGE_W - MARGIN_MM, y + 4 + i * 5, { rtl: true }));
        y += lines.length * 5 + 2;
        break;
      }
      case 'divider': {
        doc.setDrawColor(204, 204, 204);
        doc.setLineWidth(0.2);
        doc.line(MARGIN_MM, y + 2, PAGE_W - MARGIN_MM, y + 2);
        y += 5;
        break;
      }
      case 'footer': {
        setFont(doc, { size: 8, color: '#888888' });
        b.lines.forEach((ln, i) => drawLine(doc, ln, PAGE_W - MARGIN_MM, y + 3 + i * 4.6, { rtl: true }));
        y += b.lines.length * 4.6 + 2;
        break;
      }
      case 'signature': {
        doc.setDrawColor(85, 85, 85);
        doc.setLineWidth(0.2);
        const x2 = PAGE_W - MARGIN_MM - 4;
        const x1 = x2 - 60;
        doc.line(x1, y + 5, x2, y + 5);
        setFont(doc, { size: 9, color: '#333333' });
        drawLine(doc, b.text, x2, y + 9, { rtl: true });
        if (b.sub) {
          setFont(doc, { size: 8, color: '#666666' });
          drawLine(doc, b.sub, x2, y + 13, { rtl: true });
        }
        y += 14;
        break;
      }
      case 'table': {
        const t = measureTable(doc, b);
        const drawHeader = () => {
          doc.setFont('Cairo');
          doc.setFontSize(9.5);
          doc.setFillColor(41, 128, 185);
          doc.rect(MARGIN_MM, y, USABLE_W, t.headerH, 'F');
          let acc = PAGE_W - MARGIN_MM;
          doc.setTextColor(255, 255, 255);
          b.headers.forEach((h, i) => {
            doc.text(h, acc, y + t.headerH / 2 + 1, { align: 'right', isInputRtl: true, isSymmetricSwapping: true, maxWidth: t.colW[i] });
            acc -= t.colW[i];
          });
          y += t.headerH;
        };
        if (y + t.headerH > BOTTOM) newPage();
        drawHeader();
        for (let i = 0; i < b.rows.length; i++) {
          if (y + t.rowHeights[i] > BOTTOM) {
            newPage();
            drawHeader();
          }
          const row = b.rows[i];
          const rowH = t.rowHeights[i];
          if (i % 2 === 1) {
            doc.setFillColor(245, 245, 245);
            doc.rect(MARGIN_MM, y, USABLE_W, rowH, 'F');
          }
          doc.setDrawColor(229, 231, 235);
          doc.line(MARGIN_MM, y + rowH, PAGE_W - MARGIN_MM, y + rowH);
          doc.setTextColor(31, 41, 55);
          doc.setFontSize(9);
          let acc = PAGE_W - MARGIN_MM;
          for (let c = 0; c < b.headers.length; c++) {
            const lines = wrapLines(doc, String(row[c] ?? ''), t.colW[c] - 3);
            lines.forEach((ln, li) =>
              doc.text(ln, acc, y + 3 + li * 4.5, { align: 'right', isInputRtl: true, isSymmetricSwapping: true, maxWidth: t.colW[c] - 3 })
            );
            acc -= t.colW[c];
          }
          y += rowH;
        }
        y += 2;
        break;
      }
    }
  };

  for (const b of blocks) {
    const h = measureBlock(doc, b);
    if (y + h > BOTTOM) newPage();
    drawBlock(b);
  }

  doc.save(filename);
};
