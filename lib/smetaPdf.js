const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_DIR = path.join(__dirname, '..', 'node_modules', 'dejavu-fonts-ttf', 'ttf');
const FONT_REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const IMAGES_DIR = path.join(__dirname, '..', 'images');
const LOGO_PATH = path.join(IMAGES_DIR, 'logo-full.png');

const COLORS = {
  woodDark: '#5c3a24',
  wood: '#a9744e',
  woodLight: '#e8d5ba',
  accent: '#4a7856',
  accentDark: '#345940',
  text: '#2e2419',
  textSoft: '#6b5c4c',
  white: '#ffffff',
};

const PHONES = '+7 908 277-91-07  •  +7 922 330-91-00';
const COMPANY_NAME = 'АПД Строй';

const PAGE_MARGIN = 40;
const COL_WIDTHS = { srok: 100, stage: 300, sum: 100 };
const TABLE_WIDTH = COL_WIDTHS.srok + COL_WIDTHS.stage + COL_WIDTHS.sum;
const ROW_PADDING = 8;
const HEADER_ROW_HEIGHT = 26;

function formatSum(value) {
  if (typeof value === 'number') {
    return `${value.toLocaleString('ru-RU')} ₽`;
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return '';
}

function smetaNumber(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}${mm}${yy}-${hh}${min}`;
}

function formatDate(date) {
  return date.toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function drawHeader(doc) {
  const top = PAGE_MARGIN;
  try {
    doc.image(LOGO_PATH, PAGE_MARGIN, top, { height: 34 });
  } catch (e) {
    doc.font(FONT_BOLD).fontSize(16).fillColor(COLORS.woodDark).text(COMPANY_NAME, PAGE_MARGIN, top);
  }
  doc
    .font(FONT_REGULAR)
    .fontSize(9)
    .fillColor(COLORS.textSoft)
    .text(PHONES, PAGE_MARGIN, top + 40, { width: TABLE_WIDTH, align: 'left' });

  doc
    .moveTo(PAGE_MARGIN, top + 62)
    .lineTo(PAGE_MARGIN + TABLE_WIDTH, top + 62)
    .strokeColor(COLORS.woodLight)
    .lineWidth(1)
    .stroke();

  return top + 74;
}

function drawFooter(doc) {
  const y = doc.page.height - PAGE_MARGIN - 20;
  doc
    .font(FONT_REGULAR)
    .fontSize(8)
    .fillColor(COLORS.textSoft)
    .text(`${COMPANY_NAME}  •  ${PHONES}`, PAGE_MARGIN, y, {
      width: TABLE_WIDTH,
      align: 'center',
    });
}

function buildSmetaPdf({ model, customerName, phone, rows, total }) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const now = new Date();
  const number = smetaNumber(now);
  const dateStr = formatDate(now);

  // --- Page 1: overview ---
  let y = drawHeader(doc);

  doc
    .font(FONT_BOLD)
    .fontSize(20)
    .fillColor(COLORS.woodDark)
    .text(`Смета № ${number} от ${dateStr}`, PAGE_MARGIN, y, { width: TABLE_WIDTH });
  y = doc.y + 14;

  doc
    .font(FONT_REGULAR)
    .fontSize(11)
    .fillColor(COLORS.text)
    .text(`Заказчик: ${customerName}`, PAGE_MARGIN, y);
  y = doc.y + 4;
  doc.text(`Телефон: ${phone}`, PAGE_MARGIN, y);
  y = doc.y + 20;

  doc
    .font(FONT_BOLD)
    .fontSize(16)
    .fillColor(COLORS.accentDark)
    .text(`«${model.label}» — ${model.area}`, PAGE_MARGIN, y);
  y = doc.y + 14;

  const imgWidth = TABLE_WIDTH;
  const imgMaxHeight = doc.page.height - PAGE_MARGIN - y - 40;
  doc.image(model.exterior, PAGE_MARGIN, y, { fit: [imgWidth, imgMaxHeight], align: 'center' });

  drawFooter(doc);

  // --- Page 2: floor plan ---
  doc.addPage();
  y = drawHeader(doc);
  doc
    .font(FONT_BOLD)
    .fontSize(14)
    .fillColor(COLORS.woodDark)
    .text('Планировка', PAGE_MARGIN, y);
  y = doc.y + 10;
  const planMaxHeight = doc.page.height - PAGE_MARGIN - y - 40;
  doc.image(model.plan, PAGE_MARGIN, y, { fit: [TABLE_WIDTH, planMaxHeight], align: 'center' });
  drawFooter(doc);

  // --- Page 3+: cost table ---
  doc.addPage();
  y = drawHeader(doc);
  doc
    .font(FONT_BOLD)
    .fontSize(14)
    .fillColor(COLORS.woodDark)
    .text('Смета на строительство', PAGE_MARGIN, y);
  y = doc.y + 12;

  function drawTableHeader(startY) {
    doc.rect(PAGE_MARGIN, startY, TABLE_WIDTH, HEADER_ROW_HEIGHT).fill(COLORS.woodDark);
    doc.font(FONT_BOLD).fontSize(10).fillColor(COLORS.white);
    doc.text('Срок', PAGE_MARGIN + ROW_PADDING, startY + 8, { width: COL_WIDTHS.srok - ROW_PADDING * 2 });
    doc.text('Этап', PAGE_MARGIN + COL_WIDTHS.srok + ROW_PADDING, startY + 8, {
      width: COL_WIDTHS.stage - ROW_PADDING * 2,
    });
    doc.text('Сумма', PAGE_MARGIN + COL_WIDTHS.srok + COL_WIDTHS.stage + ROW_PADDING, startY + 8, {
      width: COL_WIDTHS.sum - ROW_PADDING * 2,
      align: 'right',
    });
    return startY + HEADER_ROW_HEIGHT;
  }

  y = drawTableHeader(y);

  const bottomLimit = doc.page.height - PAGE_MARGIN - 40;

  rows.forEach((row, idx) => {
    doc.font(FONT_REGULAR).fontSize(9.5);
    const stageHeight = doc.heightOfString(row.stage, { width: COL_WIDTHS.stage - ROW_PADDING * 2 });
    const srokHeight = row.srok
      ? doc.heightOfString(row.srok, { width: COL_WIDTHS.srok - ROW_PADDING * 2 })
      : 0;
    const rowHeight = Math.max(stageHeight, srokHeight, 14) + ROW_PADDING * 2;

    if (y + rowHeight > bottomLimit) {
      drawFooter(doc);
      doc.addPage();
      y = drawHeader(doc);
      y = drawTableHeader(y);
    }

    if (idx % 2 === 1) {
      doc.rect(PAGE_MARGIN, y, TABLE_WIDTH, rowHeight).fill(COLORS.woodLight);
    }

    doc.font(FONT_REGULAR).fontSize(9.5).fillColor(COLORS.textSoft);
    doc.text(row.srok || '', PAGE_MARGIN + ROW_PADDING, y + ROW_PADDING, {
      width: COL_WIDTHS.srok - ROW_PADDING * 2,
    });

    doc.fillColor(COLORS.text);
    doc.text(row.stage, PAGE_MARGIN + COL_WIDTHS.srok + ROW_PADDING, y + ROW_PADDING, {
      width: COL_WIDTHS.stage - ROW_PADDING * 2,
    });

    doc.fillColor(COLORS.text);
    doc.text(
      formatSum(row.sum),
      PAGE_MARGIN + COL_WIDTHS.srok + COL_WIDTHS.stage + ROW_PADDING,
      y + ROW_PADDING,
      { width: COL_WIDTHS.sum - ROW_PADDING * 2, align: 'right' }
    );

    doc
      .moveTo(PAGE_MARGIN, y + rowHeight)
      .lineTo(PAGE_MARGIN + TABLE_WIDTH, y + rowHeight)
      .strokeColor(COLORS.woodLight)
      .lineWidth(0.5)
      .stroke();

    y += rowHeight;
  });

  const totalRowHeight = 28;
  if (y + totalRowHeight > bottomLimit) {
    drawFooter(doc);
    doc.addPage();
    y = drawHeader(doc);
  }

  doc.rect(PAGE_MARGIN, y, TABLE_WIDTH, totalRowHeight).fill(COLORS.accent);
  doc.font(FONT_BOLD).fontSize(12).fillColor(COLORS.white);
  doc.text('Итого', PAGE_MARGIN + ROW_PADDING, y + 8, { width: COL_WIDTHS.srok + COL_WIDTHS.stage });
  doc.text(formatSum(total), PAGE_MARGIN + COL_WIDTHS.srok + COL_WIDTHS.stage + ROW_PADDING, y + 8, {
    width: COL_WIDTHS.sum - ROW_PADDING * 2,
    align: 'right',
  });

  drawFooter(doc);

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { buildSmetaPdf, smetaNumber, formatSum };
