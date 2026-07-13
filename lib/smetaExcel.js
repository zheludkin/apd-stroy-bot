const ExcelJS = require('exceljs');

async function parseSmetaExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    throw new Error('В файле нет ни одного листа.');
  }

  const rows = [];
  let total = null;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const srokRaw = row.getCell(1).value;
    const stageRaw = row.getCell(2).value;
    const sumRaw = row.getCell(3).value;

    const stage = stageRaw != null ? String(stageRaw).trim() : '';
    if (!stage) return;

    if (/^итого/i.test(stage)) {
      total = typeof sumRaw === 'number' ? sumRaw : null;
      return;
    }

    const srok = srokRaw != null ? String(srokRaw).trim() : '';

    let sum = null;
    if (typeof sumRaw === 'number') {
      sum = sumRaw;
    } else if (sumRaw != null && String(sumRaw).trim()) {
      sum = String(sumRaw).trim();
    }

    rows.push({ srok, stage, sum });
  });

  if (!rows.length) {
    throw new Error(
      'Не удалось найти строки сметы. Ожидается лист с колонками: срок / этап / сумма.'
    );
  }

  if (total == null) {
    total = rows.reduce((acc, r) => acc + (typeof r.sum === 'number' ? r.sum : 0), 0);
  }

  return { rows, total };
}

module.exports = { parseSmetaExcel };
