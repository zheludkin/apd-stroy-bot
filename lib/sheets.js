const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const HEADERS = ['Дата', 'Источник', 'Имя', 'Телефон', 'Проект', 'Время звонка'];
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let sheetPromise = null;

function getServiceAccountAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email || !key) {
    throw new Error('Не заданы GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY в .env');
  }

  return new JWT({ email, key, scopes: SCOPES });
}

async function loadLeadsSheet() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    throw new Error('Не задан GOOGLE_SHEET_ID в .env');
  }

  const doc = new GoogleSpreadsheet(sheetId, getServiceAccountAuth());
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];

  try {
    await sheet.loadHeaderRow();
  } catch {
    await sheet.setHeaderRow(HEADERS);
  }

  return sheet;
}

function getLeadsSheet() {
  if (!sheetPromise) {
    sheetPromise = loadLeadsSheet().catch((err) => {
      sheetPromise = null;
      throw err;
    });
  }
  return sheetPromise;
}

async function appendLead({ name, phone, project, callTime, source }) {
  const date = new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const sheet = await getLeadsSheet();
  await sheet.addRow(
    {
      'Дата': date,
      'Источник': source || 'Telegram-бот',
      'Имя': name.trim(),
      'Телефон': phone.trim(),
      'Проект': project ? project.trim() : '',
      'Время звонка': callTime ? callTime.trim() : '',
    },
    { raw: true }
  );
}

async function getTodaysLeadRows() {
  const sheet = await getLeadsSheet();
  const rows = await sheet.getRows();

  const todayStr = new Date().toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return rows
    .filter((row) => (row.get('Дата') || '').startsWith(todayStr))
    .map((row) => HEADERS.map((h) => row.get(h) || ''));
}

module.exports = { HEADERS, appendLead, getTodaysLeadRows };
