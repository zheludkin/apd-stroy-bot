const { getPostsNeedingDeleteReminder, markDeleteReminderSent } = require('./scheduledPosts');

// Ролики удаляются вручную (авто-удаление через API недоступно для
// Instagram Login токена — нужен отдельный Facebook Login, от которого
// решили отказаться). Вместо этого бот напоминает в Telegram, когда пора
// удалить ролик, спустя DELETE_REMINDER_DAYS дней после публикации.
const DELETE_REMINDER_DAYS = Number(process.env.INSTAGRAM_DELETE_REMINDER_DAYS || 8);

async function sendDueDeleteReminders(bot, platform = 'instagram') {
  const posts = await getPostsNeedingDeleteReminder(DELETE_REMINDER_DAYS, platform);
  const results = [];
  for (const post of posts) {
    try {
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram.sendMessage(
          process.env.TELEGRAM_GROUP_CHAT_ID,
          `🗑 Пора удалить ролик «${post.reel_slug}» — опубликован ${DELETE_REMINDER_DAYS}+ дней назад.\n${post.permalink || ''}`.trim()
        );
      }
      await markDeleteReminderSent(post.id);
      results.push({ id: post.id, reelSlug: post.reel_slug, ok: true });
    } catch (err) {
      results.push({ id: post.id, reelSlug: post.reel_slug, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = { sendDueDeleteReminders };
