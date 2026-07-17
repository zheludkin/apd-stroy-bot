const { getDuePosts, markPublishing, markPublished, markFailed } = require('./scheduledPosts');

const VK_API_VERSION = '5.199';

async function vkCall(method, params) {
  const url = new URL(`https://api.vk.com/method/${method}`);
  url.searchParams.set('access_token', process.env.VK_COMMUNITY_TOKEN);
  url.searchParams.set('v', VK_API_VERSION);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`VK ${method} failed: ${JSON.stringify(json.error)}`);
  return json.response;
}

// НАТИВНОЕ видео через video.save НЕ работает с токеном сообщества
// (проверено 17.07.2026: video.save/video.get/wall.get/groups.getSettings все
// возвращают error_code:5 "invalid token type" — этот метод требует личный
// пользовательский токен, которого сейчас нет и который VK стало сложно
// получить после отключения Implicit Flow в 2024 и перевода OAuth на VK ID
// (login-only, без scope video/wall/groups). См. память apd-stroy-vk-video-blocker.
// wall.post С ТЕКСТОМ И ССЫЛКОЙ на видео — работает, проверено живой публикацией
// (https://vk.com/wall-228739607_216). Публикуем в этом формате, пока video-токен не решён.
async function publishToVk({ videoUrl, caption }) {
  const groupId = process.env.VK_GROUP_ID;

  const message = `${caption}\n\nВидео: ${videoUrl}`;

  const wallRes = await vkCall('wall.post', {
    owner_id: -Number(groupId),
    from_group: 1,
    message,
  });
  const postId = wallRes.post_id;
  const permalink = `https://vk.com/wall-${groupId}_${postId}`;

  return { postId, permalink };
}

async function processDuePosts(bot) {
  const posts = await getDuePosts(5, 'vk');
  const results = [];
  for (const post of posts) {
    await markPublishing(post.id);
    try {
      const { postId, permalink } = await publishToVk({ videoUrl: post.video_url, caption: post.caption });
      await markPublished(post.id, { mediaId: String(postId), permalink });
      results.push({ id: post.id, ok: true, permalink });
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram
          .sendMessage(process.env.TELEGRAM_GROUP_CHAT_ID, `✅ Автопубликация (VK): «${post.reel_slug}» опубликован.\n${permalink}`)
          .catch(() => {});
      }
    } catch (err) {
      await markFailed(post.id, err.message);
      results.push({ id: post.id, ok: false, error: err.message });
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram
          .sendMessage(process.env.TELEGRAM_GROUP_CHAT_ID, `❌ Автопубликация (VK) «${post.reel_slug}» НЕ удалась: ${err.message}`)
          .catch(() => {});
      }
    }
  }
  return results;
}

module.exports = { publishToVk, processDuePosts };
