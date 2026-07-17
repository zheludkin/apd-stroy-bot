const { Pool } = require('pg');

let pool = null;
let schemaReady = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
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
      CREATE TABLE IF NOT EXISTS content_pipeline (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        reel_slug TEXT NOT NULL UNIQUE,
        stage TEXT NOT NULL DEFAULT 'pending',
        video_url TEXT,
        telegram_chat_id TEXT,
        telegram_message_id TEXT,
        error TEXT,
        notes TEXT
      );
      ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'instagram';
    `);
  }
  return schemaReady;
}

async function getPipelineRow(reelSlug) {
  await ensureSchema();
  const { rows } = await getPool().query(`SELECT * FROM content_pipeline WHERE reel_slug = $1`, [reelSlug]);
  return rows[0] || null;
}

async function upsertStage(reelSlug, stage, fields = {}) {
  await ensureSchema();
  const existing = await getPipelineRow(reelSlug);
  if (!existing) {
    await getPool().query(
      `INSERT INTO content_pipeline (reel_slug, stage, video_url, telegram_chat_id, telegram_message_id, error, notes, platform)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [reelSlug, stage, fields.videoUrl || null, fields.telegramChatId || null, fields.telegramMessageId || null, fields.error || null, fields.notes || null, fields.platform || 'instagram']
    );
    return;
  }
  await getPool().query(
    `UPDATE content_pipeline SET
       stage = $2,
       video_url = COALESCE($3, video_url),
       telegram_chat_id = COALESCE($4, telegram_chat_id),
       telegram_message_id = COALESCE($5, telegram_message_id),
       error = $6,
       notes = COALESCE($7, notes),
       platform = COALESCE($8, platform),
       updated_at = now()
     WHERE reel_slug = $1`,
    [reelSlug, stage, fields.videoUrl || null, fields.telegramChatId || null, fields.telegramMessageId || null, fields.error || null, fields.notes || null, fields.platform || null]
  );
}

async function getByTelegramMessage(chatId, messageId) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM content_pipeline WHERE telegram_chat_id = $1 AND telegram_message_id = $2`,
    [String(chatId), String(messageId)]
  );
  return rows[0] || null;
}

async function listPipeline() {
  await ensureSchema();
  const { rows } = await getPool().query(`SELECT reel_slug, platform, stage, updated_at, error FROM content_pipeline ORDER BY id`);
  return rows;
}

module.exports = { ensureSchema, getPipelineRow, upsertStage, getByTelegramMessage, listPipeline };
