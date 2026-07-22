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
      ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS delete_reminder_sent_at TIMESTAMPTZ;
      ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS content_track TEXT NOT NULL DEFAULT 'main';
    `);
  }
  return schemaReady;
}

// content_track различает несколько параллельных редакционных линий на одной
// площадке (например, основная Instagram-ветка с пассивным CTA и вторая
// ветка с активным CTA на отдельном аватаре — см. память
// apd-stroy-instagram-risky-track) — у каждой свой каданс и свой срок
// напоминания об удалении, при этом публикуется всё через один и тот же
// platform-паблишер (это разделение только для планирования, не для API).
async function enqueuePost({ reelSlug, videoUrl, caption, scheduledAt, platform = 'instagram', contentTrack = 'main' }) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `INSERT INTO scheduled_posts (reel_slug, video_url, caption, scheduled_at, platform, content_track) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [reelSlug, videoUrl, caption, scheduledAt, platform, contentTrack]
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
// strictly after the last scheduled/published post for that platform+track (or after now).
// Each platform's cadence is computed independently (filtered by platform) so
// Instagram and YouTube queues never compete for the same "last slot" cursor.
// contentTrack additionally separates parallel editorial lines on the same
// platform (see enqueuePost) so their cadences don't compete with each other either.
async function getNextWeekdaySlot(platform, weekdays, postHourUTC, contentTrack = 'main') {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT MAX(scheduled_at) AS last FROM scheduled_posts WHERE status IN ('pending', 'published') AND platform = $1 AND content_track = $2`,
    [platform, contentTrack]
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

// VK cadence: Пн/Ср/Пт, 3 в неделю, per Контент план\v1\1_ВКонтакте — контент-план.xlsx,
// лист "Стратегия" ("Пост + Клип" каждый раз). postHourUTC=11 -> 16:00 Пермь (UTC+5),
// в пределах указанного в плане окна для экспертного контента (10-12 и 15-17 буднями).
async function getNextMonWedFriSlot(postHourUTC = 11) {
  return getNextWeekdaySlot('vk', [1, 3, 5], postHourUTC);
}

// Вторая Instagram-ветка (активный CTA, риск 72-ФЗ принят пользователем
// 22.07.2026, см. память apd-stroy-instagram-risky-track): Пн/Ср/Пт,
// отдельный аватар, свой каданс — не пересекается по каденс-курсору с
// основной Вт/Чт-веткой (content_track='main') благодаря фильтру по track.
// postHourUTC=8 -> 13:00 Пермь (UTC+5), не совпадает по часу с ВК (11 UTC).
async function getNextInstagramRiskyTrackSlot(postHourUTC = 8) {
  return getNextWeekdaySlot('instagram', [1, 3, 5], postHourUTC, 'active_cta');
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

// Публикации, опубликованные >= daysThreshold дней назад, для которых ещё
// не отправлялось напоминание об удалении (ручном — API-удаление недоступно
// для Instagram Login токена, см. память apd-stroy-instagram-delete-reminder).
async function getPostsNeedingDeleteReminder(daysThreshold, platform = 'instagram', contentTrack = 'main') {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM scheduled_posts
     WHERE status = 'published'
       AND platform = $1
       AND content_track = $3
       AND published_at <= now() - ($2 || ' days')::interval
       AND delete_reminder_sent_at IS NULL
     ORDER BY published_at`,
    [platform, daysThreshold, contentTrack]
  );
  return rows;
}

async function markDeleteReminderSent(id) {
  await getPool().query(`UPDATE scheduled_posts SET delete_reminder_sent_at = now() WHERE id = $1`, [id]);
}

module.exports = {
  enqueuePost,
  getNextFreeSlot,
  getNextTueThuSlot,
  getNextMonFriSlot,
  getNextMonWedFriSlot,
  getNextInstagramRiskyTrackSlot,
  getDuePosts,
  markPublishing,
  markPublished,
  markFailed,
  listQueue,
  getPostsNeedingDeleteReminder,
  markDeleteReminderSent,
};
