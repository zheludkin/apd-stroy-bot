const { getDuePosts, markPublishing, markPublished, markFailed } = require('./scheduledPosts');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publishToInstagram({ videoUrl, caption }) {
  const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
  const IG_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  const createRes = await fetch(`https://graph.instagram.com/v21.0/${IG_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'REELS', video_url: videoUrl, caption, access_token: TOKEN }),
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

async function processDuePosts(bot) {
  const posts = await getDuePosts();
  const results = [];
  for (const post of posts) {
    await markPublishing(post.id);
    try {
      const { mediaId, permalink } = await publishToInstagram({ videoUrl: post.video_url, caption: post.caption });
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

module.exports = { publishToInstagram, processDuePosts };
