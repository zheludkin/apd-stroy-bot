const { getDuePosts, markPublishing, markPublished, markFailed } = require('./scheduledPosts');

// Публичный канал в MAX (business.max.ru, https://max.ru/id590606851561_biz),
// подключён 17.09.2026. Тот же бот-токен, что уже используется для уведомлений
// о заявках/чата (MAX_BOT_TOKEN) — бот просто добавлен админом канала, отдельный
// токен не нужен. Требует NODE_EXTRA_CA_CERTS (российский корневой сертификат,
// см. apd-stroy-site-live-chat-relay) — уже задан в env для этого приложения.
//
// Формат загрузки медиа (эмпирически подтверждено, в официальной документации
// не расписано целиком): POST /uploads?type=image|video -> {url, token?} ->
// POST файла на url -> для video token уже был в первом ответе, для image
// ответ на загрузку содержит {photos: {...}} — этот объект passes ВЕРБАТИМ
// в attachment.payload.photos. Несколько image-attachments в одном сообщении
// работают как альбом/карусель (проверено вживую, 5 фото в одном сообщении).

const CHANNEL_CHAT_ID = process.env.MAX_CHANNEL_CHAT_ID;
const CHANNEL_LINK = 'https://max.ru/id590606851561_biz';

async function uploadImage(url) {
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error('Failed to download image: ' + url);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const upRes = await fetch('https://platform-api2.max.ru/uploads?type=image', {
    method: 'POST',
    headers: { Authorization: process.env.MAX_BOT_TOKEN },
  });
  const upJson = await upRes.json();
  const form = new FormData();
  form.append('data', new Blob([buf]), 'image.png');
  const fileRes = await fetch(upJson.url, { method: 'POST', body: form });
  const fileJson = await fileRes.json();
  if (!fileJson.photos) throw new Error('MAX image upload failed: ' + JSON.stringify(fileJson));
  return { type: 'image', payload: { photos: fileJson.photos } };
}

async function uploadVideo(url) {
  const videoRes = await fetch(url);
  if (!videoRes.ok) throw new Error('Failed to download video: ' + url);
  const buf = Buffer.from(await videoRes.arrayBuffer());
  const upRes = await fetch('https://platform-api2.max.ru/uploads?type=video', {
    method: 'POST',
    headers: { Authorization: process.env.MAX_BOT_TOKEN },
  });
  const upJson = await upRes.json();
  const form = new FormData();
  form.append('data', new Blob([buf]), 'video.mp4');
  const fileRes = await fetch(upJson.url, { method: 'POST', body: form });
  await fileRes.text();
  if (!upJson.token) throw new Error('MAX video upload failed: no token in upload endpoint response');
  return { type: 'video', payload: { token: upJson.token } };
}

// MAX может не успеть обработать вложение к моменту отправки сообщения —
// в этом случае sendMessage возвращает ошибку "не готово", повтор без
// повторной загрузки файла решает проблему (задокументированное поведение).
// Формулировка кода ошибки у MAX непостоянна — на видео 20.09.2026 реально
// пришло {"code":"attachment.not.ready","message":"...video.not.processed"}
// (точки, не подчёркивание) вместо ожидавшегося "not_ready" — из-за чего
// проверка не сработала и пост ушёл в failed вместо повтора (эп.3 "апельсины"
// в MAX 20.09.2026). Проверка расширена под оба варианта написания.
const NOT_READY_RE = /not[_.]?ready|not[_.]?processed/i;
async function sendToChannel(text, attachments, attempt = 1) {
  const res = await fetch(`https://platform-api2.max.ru/messages?chat_id=${CHANNEL_CHAT_ID}`, {
    method: 'POST',
    headers: { Authorization: process.env.MAX_BOT_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, attachments }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    if (NOT_READY_RE.test(bodyText) && attempt < 6) {
      await new Promise((r) => setTimeout(r, 3000));
      return sendToChannel(text, attachments, attempt + 1);
    }
    throw new Error(`MAX sendMessage failed: ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

async function publishVideoToChannel({ videoUrl, caption }) {
  if (!CHANNEL_CHAT_ID) throw new Error('MAX_CHANNEL_CHAT_ID не задан');
  const attachment = await uploadVideo(videoUrl);
  const result = await sendToChannel(caption, [attachment]);
  return { mediaId: result.message?.body?.mid || null, permalink: CHANNEL_LINK };
}

async function publishCarouselToChannel({ imageUrls, caption }) {
  if (!CHANNEL_CHAT_ID) throw new Error('MAX_CHANNEL_CHAT_ID не задан');
  const attachments = [];
  for (const url of imageUrls) {
    attachments.push(await uploadImage(url));
  }
  const result = await sendToChannel(caption, attachments);
  return { mediaId: result.message?.body?.mid || null, permalink: CHANNEL_LINK };
}

// Уведомление об успехе/провале — через MAX (личный чат MAX_CHAT_ID), а не
// Telegram-группу как у остальных publish-модулей: api.telegram.org
// заблокирован у Timeweb на сетевом уровне (см. apd-stroy-lead-instant-notify),
// поэтому там эти уведомления и так молча не доходят. MAX работает надёжно.
async function notifyOwner(text) {
  if (!process.env.MAX_CHAT_ID) return;
  await fetch(`https://platform-api2.max.ru/messages?chat_id=${process.env.MAX_CHAT_ID}`, {
    method: 'POST',
    headers: { Authorization: process.env.MAX_BOT_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(() => {});
}

async function processDuePosts() {
  const posts = await getDuePosts(5, 'max_channel');
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
      await notifyOwner(`✅ Автопубликация (MAX-канал): «${post.reel_slug}» опубликован.\n${permalink}`);
    } catch (err) {
      await markFailed(post.id, err.message);
      results.push({ id: post.id, ok: false, error: err.message });
      await notifyOwner(`❌ Автопубликация (MAX-канал) «${post.reel_slug}» НЕ удалась: ${err.message}`);
    }
  }
  return results;
}

module.exports = { publishVideoToChannel, publishCarouselToChannel, processDuePosts };
