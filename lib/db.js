const { Pool } = require('pg');

const HEADERS = ['Дата', 'Источник', 'Имя', 'Телефон', 'Проект', 'Время звонка'];

let pool = null;
let schemaReady = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Не задан DATABASE_URL в .env');
    }
    pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 8000,
      statement_timeout: 8000,
      query_timeout: 8000,
    });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        source TEXT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        project TEXT,
        call_time TEXT
      )
    `);
  }
  return schemaReady;
}

function formatDate(date) {
  return date.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function appendLead({ name, phone, project, callTime, source }) {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO leads (source, name, phone, project, call_time) VALUES ($1, $2, $3, $4, $5)`,
    [
      source || 'Telegram-бот',
      name.trim(),
      phone.trim(),
      project ? project.trim() : '',
      callTime ? callTime.trim() : '',
    ]
  );
}

async function getTodaysLeadRows() {
  await ensureSchema();
  const { rows } = await getPool().query(`
    SELECT created_at, source, name, phone, project, call_time
    FROM leads
    WHERE (created_at AT TIME ZONE 'Europe/Moscow')::date = (now() AT TIME ZONE 'Europe/Moscow')::date
    ORDER BY created_at
  `);

  return rows.map((row) => [
    formatDate(new Date(row.created_at)),
    row.source || '',
    row.name || '',
    row.phone || '',
    row.project || '',
    row.call_time || '',
  ]);
}

module.exports = { HEADERS, appendLead, getTodaysLeadRows };
