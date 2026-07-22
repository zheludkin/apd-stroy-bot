const { getPostsNeedingDeleteReminder, markDeleteReminderSent } = require('./scheduledPosts');

// Ролики удаляются вручную (авто-удаление через API недоступно для
// Instagram Login токена — нужен отдельный Facebook Login, от которого
// решили отказаться). Вместо этого бот напоминает в Telegram, когда пора
// удалить ролик. Разные редакционные ветки — разный срок:
// - main: основная ветка (пассивный CTA) — 8 дней по умолчанию
// - active_cta: вторая ветка (активный CTA, риск 72-ФЗ принят 22.07.2026,
//   см. память apd-stroy-instagram-risky-track) — 10 дней, выше риск контента
const REMINDER_DAYS_BY_TRACK = {
  main: Number(process.env.INSTAGRAM_DELETE_REMINDER_DAYS || 8),
  active_cta: Number(process.env.INSTAGRAM_RISKY_TRACK_DELETE_REMINDER_DAYS || 10),
};

async function sendReminderForTrack(bot, platform, contentTrack, daysThreshold) {
  const posts = await getPostsNeedingDeleteReminder(daysThreshold, platform, contentTrack);
  const results = [];
  for (const post of posts) {
    try {
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram.sendMessage(
          process.env.TELEGRAM_GROUP_CHAT_ID,
          `🗑 Пора удалить ролик «${post.reel_slug}» — опубликован ${daysThreshold}+ дней назад.\n${post.permalink || ''}`.trim()
        );
      }
      await markDeleteReminderSent(post.id);
      results.push({ id: post.id, reelSlug: post.reel_slug, contentTrack, ok: true });
    } catch (err) {
      results.push({ id: post.id, reelSlug: post.reel_slug, contentTrack, ok: false, error: err.message });
    }
  }
  return results;
}

async function sendDueDeleteReminders(bot, platform = 'instagram') {
  const results = [];
  for (const [contentTrack, days] of Object.entries(REMINDER_DAYS_BY_TRACK)) {
    results.push(...(await sendReminderForTrack(bot, platform, contentTrack, days)));
  }
  return results;
}

module.exports = { sendDueDeleteReminders };
