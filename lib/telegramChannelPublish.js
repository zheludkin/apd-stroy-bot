const { getDuePosts, markPublishing, markPublished, markFailed } = require('./scheduledPosts');
const { publishTelegramVideoViaPostproxy, publishTelegramCarouselViaPostproxy } = require('./postproxy');

// см. тот же комментарий в lib/instagramPublish.js — api.telegram.org страдает
// от той же периодической сетевой проблемы с российского сервера.
function isNetworkError(err) {
  return err instanceof TypeError && /fetch failed/i.test(err.message);
}

// Публикация в публичный Telegram-канал (@apd59perm), отдельно от группового
// чата с уведомлениями (TELEGRAM_GROUP_CHAT_ID) и от лид-бота. Канал добавлен
// 15.09.2026 как содержательная площадка — кросс-постинг того же контента,
// что идёт в Instagram/YouTube/VK. Telegram Bot API нативно поддерживает и
// видео, и карусели (sendMediaGroup) без танцев с OAuth, в отличие от VK/Meta —
// самая простая площадка технически.

const CHANNEL = process.env.TELEGRAM_CHANNEL_USERNAME || '@apd59perm';

async function tgCall(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
  return json.result;
}

async function publishVideoToChannelDirect({ videoUrl, caption }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const result = await tgCall(token, 'sendVideo', {
    chat_id: CHANNEL,
    video: videoUrl,
    caption,
    supports_streaming: true,
  });
  const permalink = result.chat?.username
    ? `https://t.me/${result.chat.username}/${result.message_id}`
    : null;
  return { mediaId: String(result.message_id), permalink };
}

async function publishCarouselToChannelDirect({ imageUrls, caption }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const media = imageUrls.map((url, i) => ({
    type: 'photo',
    media: url,
    ...(i === 0 ? { caption } : {}),
  }));
  const results = await tgCall(token, 'sendMediaGroup', { chat_id: CHANNEL, media });
  const first = results[0];
  const permalink = first?.chat?.username
    ? `https://t.me/${first.chat.username}/${first.message_id}`
    : null;
  return { mediaId: String(first.message_id), permalink };
}

async function publishVideoToChannel({ videoUrl, caption }) {
  try {
    return await publishVideoToChannelDirect({ videoUrl, caption });
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return publishTelegramVideoViaPostproxy({ videoUrl, caption });
  }
}

async function publishCarouselToChannel({ imageUrls, caption }) {
  try {
    return await publishCarouselToChannelDirect({ imageUrls, caption });
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return publishTelegramCarouselViaPostproxy({ imageUrls, caption });
  }
}

async function processDuePosts(bot) {
  const posts = await getDuePosts(5, 'telegram_channel');
  const results = [];
  for (const post of posts) {
    await markPublishing(post.id);
    try {
      let mediaId, permalink;
      if (post.media_type === 'carousel') {
        const imageUrls = JSON.parse(post.video_url);
        ({ mediaId, permalink } = await publishCarouselToChannel({ imageUrls, caption: post.caption }));
      } else {
        ({ mediaId, permalink } = await publishVideoToChannel({ videoUrl: post.video_url, caption: post.caption }));
      }
      await markPublished(post.id, { mediaId, permalink });
      results.push({ id: post.id, ok: true, permalink });
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram
          .sendMessage(process.env.TELEGRAM_GROUP_CHAT_ID, `✅ Автопубликация (Telegram-канал): «${post.reel_slug}» опубликован.${permalink ? '\n' + permalink : ''}`)
          .catch(() => {});
      }
    } catch (err) {
      await markFailed(post.id, err.message);
      results.push({ id: post.id, ok: false, error: err.message });
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram
          .sendMessage(process.env.TELEGRAM_GROUP_CHAT_ID, `❌ Автопубликация (Telegram-канал) «${post.reel_slug}» НЕ удалась: ${err.message}`)
          .catch(() => {});
      }
    }
  }
  return results;
}

module.exports = { publishVideoToChannel, publishCarouselToChannel, processDuePosts };
