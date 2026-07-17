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
      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        reel_slug TEXT NOT NULL,
        video_url TEXT NOT NULL,
        caption TEXT NOT NULL,
        scheduled_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        media_id TEXT,
        permalink TEXT,
        error TEXT,
        published_at TIMESTAMPTZ
      );
      ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'instagram';
    `);
  }
  return schemaReady;
}

async function enqueuePost({ reelSlug, videoUrl, caption, scheduledAt, platform = 'instagram' }) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `INSERT INTO scheduled_posts (reel_slug, video_url, caption, scheduled_at, platform) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [reelSlug, videoUrl, caption, scheduledAt, platform]
  );
  return rows[0].id;
}

async function getNextFreeSlot(intervalDays = 2) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT MAX(scheduled_at) AS last FROM scheduled_posts WHERE status IN ('pending', 'published')`
  );
  const last = rows[0].last ? new Date(rows[0].last) : new Date();
  const next = new Date(Math.max(last.getTime(), Date.now()) + intervalDays * 24 * 60 * 60 * 1000);
  return next;
}

// Shared helper: next slot on one of `weekdays` (JS getUTCDay(), Sun=0) at postHourUTC,
// strictly after the last scheduled/published post for that platform (or after now).
// Each platform's cadence is computed independently (filtered by platform) so
// Instagram and YouTube queues never compete for the same "last slot" cursor.
async function getNextWeekdaySlot(platform, weekdays, postHourUTC) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT MAX(scheduled_at) AS last FROM scheduled_posts WHERE status IN ('pending', 'published') AND platform = $1`,
    [platform]
  );
  const last = rows[0].last ? new Date(rows[0].last) : null;
  const cursor = new Date(Math.max(last ? last.getTime() : 0, Date.now()));
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  cursor.setUTCHours(0, 0, 0, 0);
  while (!weekdays.includes(cursor.getUTCDay())) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  cursor.setUTCHours(postHourUTC, 0, 0, 0);
  return cursor;
}

// Instagram cadence: strictly Tue/Thu, 2 posts/week, per the approved
// content plan (Контент план\v1\2_Instagram — контент-план.xlsx, лист "Стратегия").
// postHourUTC=7 -> 12:00 Пермь (UTC+5).
async function getNextTueThuSlot(postHourUTC = 7) {
  return getNextWeekdaySlot('instagram', [2, 4], postHourUTC);
}

// YouTube Shorts cadence: Пн/Пт, 2 в неделю, дни намеренно НЕ пересекаются с
// Instagram (Вт/Чт) — чтобы не перегружать один и тот же ИИ-оркестратор
// одновременной готовностью контента для двух площадок в один день (решение
// пользователя 17.07.2026). Только Shorts — длинные видео (1/нед) отложены,
// т.к. требуют реальных материалов от клиента, которые ИИ не может сгенерировать.
async function getNextMonFriSlot(postHourUTC = 10) {
  return getNextWeekdaySlot('youtube', [1, 5], postHourUTC);
}

async function getDuePosts(limit = 5, platform = null) {
  await ensureSchema();
  const { rows } = platform
    ? await getPool().query(
        `SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= now() AND platform = $2 ORDER BY scheduled_at LIMIT $1`,
        [limit, platform]
      )
    : await getPool().query(
        `SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT $1`,
        [limit]
      );
  return rows;
}

async function markPublishing(id) {
  await getPool().query(`UPDATE scheduled_posts SET status = 'publishing' WHERE id = $1`, [id]);
}

async function markPublished(id, { mediaId, permalink }) {
  await getPool().query(
    `UPDATE scheduled_posts SET status = 'published', media_id = $2, permalink = $3, published_at = now() WHERE id = $1`,
    [id, mediaId, permalink]
  );
}

async function markFailed(id, error) {
  await getPool().query(`UPDATE scheduled_posts SET status = 'failed', error = $2 WHERE id = $1`, [id, String(error).slice(0, 2000)]);
}

async function listQueue() {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, reel_slug, platform, scheduled_at, status, permalink FROM scheduled_posts ORDER BY scheduled_at`
  );
  return rows;
}

module.exports = { enqueuePost, getNextFreeSlot, getNextTueThuSlot, getNextMonFriSlot, getDuePosts, markPublishing, markPublished, markFailed, listQueue };
