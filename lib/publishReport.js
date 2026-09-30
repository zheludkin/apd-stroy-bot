// Ежедневная сводка по автопубликациям (30.09.2026, по просьбе пользователя):
// вместо сообщения в группу на каждую публикацию — одно сообщение вечером,
// чтобы заявки в группе не терялись среди уведомлений.
// Окно — последние 24 часа (отчёт уходит раз в сутки, так ничего не выпадает).
const { getPool } = require('./scheduledPosts');
const { withTimeout } = require('./withTimeout');

const PLATFORM_LABELS = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  vk: 'VK',
  ok: 'Одноклассники',
  telegram_channel: 'Telegram-канал',
  max_channel: 'MAX-канал',
};

function label(platform) {
  return PLATFORM_LABELS[platform] || platform;
}

async function buildPublishReportText() {
  const pool = getPool();
  const published = await pool.query(
    `SELECT platform, count(*)::int AS n FROM scheduled_posts
     WHERE status = 'published' AND published_at > now() - interval '24 hours'
     GROUP BY platform ORDER BY n DESC`
  );
  const failed = await pool.query(
    `SELECT platform, reel_slug, error FROM scheduled_posts
     WHERE status = 'failed' AND scheduled_at > now() - interval '24 hours'
     ORDER BY platform, scheduled_at`
  );
  const tomorrow = await pool.query(
    `SELECT platform, count(*)::int AS n FROM scheduled_posts
     WHERE status = 'pending' AND scheduled_at <= now() + interval '24 hours'
     GROUP BY platform ORDER BY n DESC`
  );

  const total = published.rows.reduce((s, r) => s + r.n, 0);
  const lines = [`📊 Публикации за сутки: ${total}`];
  if (published.rows.length === 0) {
    lines.push('Ничего не опубликовано.');
  } else {
    for (const r of published.rows) lines.push(`• ${label(r.platform)} — ${r.n}`);
  }

  if (failed.rows.length > 0) {
    lines.push('', `❌ Не удалось: ${failed.rows.length}`);
    for (const r of failed.rows) {
      lines.push(`• ${label(r.platform)}: ${r.reel_slug} — ${String(r.error || '').slice(0, 120)}`);
    }
  }

  if (tomorrow.rows.length > 0) {
    lines.push('', 'В очереди на ближайшие сутки:');
    for (const r of tomorrow.rows) lines.push(`• ${label(r.platform)} — ${r.n}`);
  } else {
    lines.push('', '⚠️ На ближайшие сутки в очереди ничего нет.');
  }

  return lines.join('\n');
}

// Шлём в группу Telegram; если Telegram недоступен (сеть Timeweb) — в MAX.
async function sendPublishReport(bot) {
  const text = await buildPublishReportText();
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (bot && chatId) {
    try {
      await withTimeout(bot.telegram.sendMessage(chatId, text), 15000, 'отправка сводки публикаций в Telegram');
      return { sent: 'telegram' };
    } catch (err) {
      console.error('Сводка публикаций в Telegram не ушла:', err.message);
    }
  }
  if (process.env.MAX_BOT_TOKEN && process.env.MAX_CHAT_ID) {
    const res = await fetch(`https://platform-api2.max.ru/messages?chat_id=${process.env.MAX_CHAT_ID}`, {
      method: 'POST',
      headers: { Authorization: process.env.MAX_BOT_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`MAX HTTP ${res.status}`);
    return { sent: 'max' };
  }
  return { sent: false };
}

module.exports = { buildPublishReportText, sendPublishReport };
