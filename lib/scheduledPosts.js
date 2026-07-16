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
      )
    `);
  }
  return schemaReady;
}

async function enqueuePost({ reelSlug, videoUrl, caption, scheduledAt }) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `INSERT INTO scheduled_posts (reel_slug, video_url, caption, scheduled_at) VALUES ($1,$2,$3,$4) RETURNING id`,
    [reelSlug, videoUrl, caption, scheduledAt]
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

async function getDuePosts(limit = 5) {
  await ensureSchema();
  const { rows } = await getPool().query(
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
    `SELECT id, reel_slug, scheduled_at, status, permalink FROM scheduled_posts ORDER BY scheduled_at`
  );
  return rows;
}

module.exports = { enqueuePost, getNextFreeSlot, getDuePosts, markPublishing, markPublished, markFailed, listQueue };
