const crypto = require('crypto');
const { getDuePosts, markPublishing, markPublished, markFailed } = require('./scheduledPosts');

// Одноклассники (ОК) — подключено 15.09.2026. Классический REST API (fb.do),
// подпись запроса: sig = md5(sorted_params_concat + md5(access_token + session_secret_key)).
// Права GROUP_CONTENT/PHOTO_CONTENT/PUBLISH_TO_STREAM выданы самостоятельно через
// форму "Права доступа" приложения (опция "Обязательно") — модерация/письмо в
// api-support НЕ понадобились, вопреки сторонним гайдам. Токен — "вечный
// access_token" из формы приложения (apiok.ru → Игры → В разработке → моё
// приложение → Инструменты разработчика → Access token).

const API_BASE = 'https://api.ok.ru/fb.do';

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function sign(params) {
  const token = process.env.OK_SESSION_KEY;
  const secret = process.env.OK_SESSION_SECRET_KEY;
  const paramsStr = Object.keys(params).sort().map((k) => k + '=' + params[k]).join('');
  const secretKey = md5(token + secret);
  return md5(paramsStr + secretKey);
}

async function okCall(method, extraParams, httpMethod = 'GET', body = null) {
  const params = {
    application_key: process.env.OK_PUBLIC_KEY,
    format: 'json',
    method,
    ...extraParams,
  };
  const sig = sign(params);
  const url = new URL(API_BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('sig', sig);
  url.searchParams.set('access_token', process.env.OK_SESSION_KEY);

  const res = await fetch(url, { method: httpMethod, body });
  const json = await res.json();
  if (json.error_code) throw new Error(`OK ${method} failed: ${JSON.stringify(json)}`);
  return json;
}

// Скачивает картинку по URL и загружает её в ОК через photosV2.getUploadUrl →
// multipart upload. Для фото в постах ГРУППЫ photosV2.commit делать НЕ нужно
// (в документации метода прямо написано: "не должен использоваться для фото,
// публикуемых в групповых медиатопиках") — сырой upload-токен передаётся
// напрямую в attachment.media[].list[].id у mediatopic.post.
async function uploadPhoto(imageUrl) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error('Failed to download image: ' + imageUrl);
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  const uploadUrlRes = await okCall('photosV2.getUploadUrl', { count: 1, gid: process.env.OK_GROUP_ID });
  const uploadUrl = uploadUrlRes.upload_url;

  const form = new FormData();
  form.append('pic1', new Blob([buffer]), 'photo.jpg');
  const uploadRes = await fetch(uploadUrl, { method: 'POST', body: form });
  const uploadJson = await uploadRes.json();
  const photoEntry = Object.values(uploadJson.photos || {})[0];
  if (!photoEntry || !photoEntry.token) throw new Error('Photo upload failed: ' + JSON.stringify(uploadJson));

  return photoEntry.token;
}

async function publishTextToGroup({ text }) {
  const attachment = JSON.stringify({ media: [{ type: 'text', text }] });
  const mediatopicId = await okCall(
    'mediatopic.post',
    { gid: process.env.OK_GROUP_ID, type: 'GROUP_THEME', onBehalfOfGroup: 'true', attachment },
    'POST'
  );
  return { mediaId: String(mediatopicId), permalink: `https://ok.ru/group/${process.env.OK_GROUP_ID}/topic/${mediatopicId}` };
}

async function publishCarouselToGroup({ imageUrls, caption }) {
  const photoIds = [];
  for (const url of imageUrls) {
    photoIds.push(await uploadPhoto(url));
  }
  const media = [{ type: 'photo', list: photoIds.map((id) => ({ id })) }];
  if (caption) media.push({ type: 'text', text: caption });
  const attachment = JSON.stringify({ media });
  const mediatopicId = await okCall(
    'mediatopic.post',
    { gid: process.env.OK_GROUP_ID, type: 'GROUP_THEME', onBehalfOfGroup: 'true', attachment },
    'POST'
  );
  return { mediaId: String(mediatopicId), permalink: `https://ok.ru/group/${process.env.OK_GROUP_ID}/topic/${mediatopicId}` };
}

async function processDuePosts(bot) {
  const posts = await getDuePosts(5, 'ok');
  const results = [];
  for (const post of posts) {
    await markPublishing(post.id);
    try {
      let mediaId, permalink;
      if (post.media_type === 'carousel') {
        const imageUrls = JSON.parse(post.video_url);
        ({ mediaId, permalink } = await publishCarouselToGroup({ imageUrls, caption: post.caption }));
      } else {
        ({ mediaId, permalink } = await publishTextToGroup({ text: post.caption }));
      }
      await markPublished(post.id, { mediaId, permalink });
      results.push({ id: post.id, ok: true, permalink });
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram
          .sendMessage(process.env.TELEGRAM_GROUP_CHAT_ID, `✅ Автопубликация (ОК): «${post.reel_slug}» опубликован.\n${permalink}`)
          .catch(() => {});
      }
    } catch (err) {
      await markFailed(post.id, err.message);
      results.push({ id: post.id, ok: false, error: err.message });
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram
          .sendMessage(process.env.TELEGRAM_GROUP_CHAT_ID, `❌ Автопубликация (ОК) «${post.reel_slug}» НЕ удалась: ${err.message}`)
          .catch(() => {});
      }
    }
  }
  return results;
}

module.exports = { publishTextToGroup, publishCarouselToGroup, processDuePosts };
