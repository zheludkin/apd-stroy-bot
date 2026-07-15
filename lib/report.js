const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const { HEADERS, getTodaysLeadRows } = require('./db');

async function buildReportBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Заявки за день');
  sheet.addRow(HEADERS);
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(row));
  return workbook.xlsx.writeBuffer();
}

function todayLabel() {
  return new Date().toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

async function sendToTelegramGroup(bot, buffer, caption) {
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (!chatId) {
    console.error('TELEGRAM_GROUP_CHAT_ID не задан — отчёт в группу не отправлен.');
    return;
  }
  await bot.telegram.sendDocument(
    chatId,
    { source: buffer, filename: `Заявки ${todayLabel()}.xlsx` },
    { caption }
  );
}

async function sendByEmail(buffer, caption) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, REPORT_EMAIL_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !REPORT_EMAIL_TO) {
    console.error('SMTP не настроен — отчёт на почту не отправлен.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 465,
    secure: Number(SMTP_PORT) !== 587,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_USER,
    to: REPORT_EMAIL_TO,
    subject: `АПД Строй — заявки за ${todayLabel()}`,
    text: caption,
    attachments: [
      {
        filename: `Заявки ${todayLabel()}.xlsx`,
        content: buffer,
      },
    ],
  });
}

async function sendDailyReport(bot) {
  const rows = await getTodaysLeadRows();
  const caption =
    rows.length > 0
      ? `За ${todayLabel()} новых заявок: ${rows.length}`
      : `За ${todayLabel()} новых заявок нет`;

  const buffer = await buildReportBuffer(rows);

  await Promise.all([
    sendToTelegramGroup(bot, buffer, caption).catch((err) =>
      console.error('Ошибка отправки отчёта в Telegram:', err.message)
    ),
    sendByEmail(buffer, caption).catch((err) =>
      console.error('Ошибка отправки отчёта на почту:', err.message)
    ),
  ]);

  return { count: rows.length, caption };
}

module.exports = { sendDailyReport };
