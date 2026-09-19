const { getDuePosts, markPublishing, markPublished, markFailed } = require('./scheduledPosts');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// isTrial=true -> Instagram Trial Reels (см. память apd-stroy-series-c-igor-dark-humor):
// ролик показывается сначала только не-подписчикам, graduation_strategy=MANUAL
// означает, что в общую ленту подписчиков он НЕ попадёт автоматически — только
// если кто-то вручную "выпустит" его из режима трайла в приложении Instagram.
// Официально Meta не публикует порог по подписчикам для доступа к фиче — если
// аккаунт не соответствует требованиям, API должен просто вернуть ошибку на
// создание контейнера (тогда пост уйдёт в status='failed', это ожидаемо).
async function publishToInstagram({ videoUrl, caption, isTrial = false }) {
  const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
  const IG_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  const createBody = { media_type: 'REELS', video_url: videoUrl, caption, access_token: TOKEN };
  if (isTrial) {
    createBody.trial_params = JSON.stringify({ graduation_strategy: 'MANUAL' });
  }
  const createRes = await fetch(`https://graph.instagram.com/v21.0/${IG_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createBody),
  });
  const createJson = await createRes.json();
  if (!createJson.id) throw new Error('Container creation failed: ' + JSON.stringify(createJson));
  const containerId = createJson.id;

  let statusCode = 'IN_PROGRESS';
  for (let i = 0; i < 20 && statusCode === 'IN_PROGRESS'; i++) {
    await sleep(6000);
    const statusRes = await fetch(
      `https://graph.instagram.com/v21.0/${containerId}?fields=status_code&access_token=${TOKEN}`
    );
    const statusJson = await statusRes.json();
    statusCode = statusJson.status_code;
  }
  if (statusCode !== 'FINISHED') {
    throw new Error('Container did not finish processing, status: ' + statusCode);
  }

  const publishRes = await fetch(`https://graph.instagram.com/v21.0/${IG_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: TOKEN }),
  });
  const publishJson = await publishRes.json();
  if (!publishJson.id) throw new Error('Publish failed: ' + JSON.stringify(publishJson));
  const mediaId = publishJson.id;

  const permalinkRes = await fetch(
    `https://graph.instagram.com/v21.0/${mediaId}?fields=permalink&access_token=${TOKEN}`
  );
  const permalinkJson = await permalinkRes.json();

  return { mediaId, permalink: permalinkJson.permalink };
}

// Карусель (несколько картинок, media_type='carousel' в scheduled_posts —
// post.video_url хранит JSON.stringify(imageUrls), см. lib/scheduledPosts.js).
// Технический процесс задокументирован в памяти apd-stroy-instagram-norms-carousel-series.
async function publishCarouselToInstagram({ imageUrls, caption }) {
  const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
  const IG_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  const childIds = [];
  for (const imageUrl of imageUrls) {
    const itemRes = await fetch(`https://graph.instagram.com/v21.0/${IG_ID}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, is_carousel_item: true, access_token: TOKEN }),
    });
    const itemJson = await itemRes.json();
    if (!itemJson.id) throw new Error('Carousel item creation failed: ' + JSON.stringify(itemJson));
    childIds.push(itemJson.id);
  }

  const containerRes = await fetch(`https://graph.instagram.com/v21.0/${IG_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'CAROUSEL', children: childIds.join(','), caption, access_token: TOKEN }),
  });
  const containerJson = await containerRes.json();
  if (!containerJson.id) throw new Error('Carousel container creation failed: ' + JSON.stringify(containerJson));
  const containerId = containerJson.id;

  let statusCode = 'IN_PROGRESS';
  for (let i = 0; i < 20 && statusCode === 'IN_PROGRESS'; i++) {
    await sleep(2000);
    const statusRes = await fetch(
      `https://graph.instagram.com/v21.0/${containerId}?fields=status_code&access_token=${TOKEN}`
    );
    const statusJson = await statusRes.json();
    statusCode = statusJson.status_code;
  }
  if (statusCode !== 'FINISHED') {
    throw new Error('Carousel container did not finish processing, status: ' + statusCode);
  }

  const publishRes = await fetch(`https://graph.instagram.com/v21.0/${IG_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: TOKEN }),
  });
  const publishJson = await publishRes.json();
  if (!publishJson.id) throw new Error('Carousel publish failed: ' + JSON.stringify(publishJson));
  const mediaId = publishJson.id;

  const permalinkRes = await fetch(
    `https://graph.instagram.com/v21.0/${mediaId}?fields=permalink&access_token=${TOKEN}`
  );
  const permalinkJson = await permalinkRes.json();

  return { mediaId, permalink: permalinkJson.permalink };
}

async function processDuePosts(bot) {
  const posts = await getDuePosts(5, 'instagram');
  const results = [];
  for (const post of posts) {
    await markPublishing(post.id);
    try {
      const { mediaId, permalink } =
        post.media_type === 'carousel'
          ? await publishCarouselToInstagram({ imageUrls: JSON.parse(post.video_url), caption: post.caption })
          : await publishToInstagram({ videoUrl: post.video_url, caption: post.caption, isTrial: post.is_trial });
      await markPublished(post.id, { mediaId, permalink });
      results.push({ id: post.id, ok: true, permalink });
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram
          .sendMessage(process.env.TELEGRAM_GROUP_CHAT_ID, `✅ Автопубликация: «${post.reel_slug}» опубликован.\n${permalink}`)
          .catch(() => {});
      }
    } catch (err) {
      await markFailed(post.id, err.message);
      results.push({ id: post.id, ok: false, error: err.message });
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram
          .sendMessage(process.env.TELEGRAM_GROUP_CHAT_ID, `❌ Автопубликация «${post.reel_slug}» НЕ удалась: ${err.message}`)
          .catch(() => {});
      }
    }
  }
  return results;
}

module.exports = { publishToInstagram, publishCarouselToInstagram, processDuePosts };
