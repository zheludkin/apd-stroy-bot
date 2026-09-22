// Резервный канал публикации через сторонний сервис Postproxy (api.postproxy.dev),
// который публикует со своей (не-российской) инфраструктуры — используется только
// как fallback, когда прямой fetch к graph.instagram.com/api.telegram.org падает
// с сетевой ошибкой "fetch failed" (см. память apd-stroy-instagram-network-issue-and-local-relay).
// Подключено 22.09.2026: Instagram-профиль (GWU3V4) уже связан и рабочий,
// Telegram-профиль (8qUdk1, бот @apd59_bot) зарегистрирован, но канал @apd59perm
// появится в placements только после того как бота один раз снимут/вернут
// админом в канале (Telegram шлёт webhook только на изменение, не задним числом).

const POSTPROXY_BASE = 'https://api.postproxy.dev/api';
const PROFILE_IDS = { instagram: 'GWU3V4', telegram: '8qUdk1' };

function headers() {
  return { Authorization: `Bearer ${process.env.POSTPROXY_API_KEY}`, 'Content-Type': 'application/json' };
}

async function createPost({ profile, caption, media, platformParams }) {
  const res = await fetch(`${POSTPROXY_BASE}/posts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      post: { body: caption },
      profiles: [PROFILE_IDS[profile]],
      media,
      platforms: { [profile]: platformParams },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('Postproxy create failed: ' + JSON.stringify(json));
  return json;
}

async function pollPost(id, { attempts = 25, delayMs = 6000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    const res = await fetch(`${POSTPROXY_BASE}/posts/${id}`, { headers: headers() });
    const json = await res.json();
    const p = (json.platforms || [])[0];
    if (p?.status === 'published') return { mediaId: json.id, permalink: p.permalink };
    if (p?.status === 'failed') throw new Error('Postproxy platform publish failed: ' + (p.error || 'unknown'));
  }
  throw new Error('Postproxy post did not finish processing in time');
}

async function publishReelViaPostproxy({ videoUrl, caption }) {
  const created = await createPost({ profile: 'instagram', caption, media: [videoUrl], platformParams: { format: 'reel' } });
  return pollPost(created.id);
}

async function publishCarouselViaPostproxy({ imageUrls, caption }) {
  const created = await createPost({ profile: 'instagram', caption, media: imageUrls, platformParams: { format: 'post' } });
  return pollPost(created.id);
}

async function getTelegramChatId() {
  const res = await fetch(`${POSTPROXY_BASE}/profiles/${PROFILE_IDS.telegram}/placements`, { headers: headers() });
  const json = await res.json();
  const channelUsername = (process.env.TELEGRAM_CHANNEL_USERNAME || '@apd59perm').replace('@', '');
  const match = (json.data || []).find((p) => p.username === channelUsername || p.name?.includes(channelUsername));
  if (!match) throw new Error('Telegram channel placement not found on Postproxy yet (нужно один раз снять/вернуть бота админом в канале)');
  return match.chat_id;
}

async function publishTelegramVideoViaPostproxy({ videoUrl, caption }) {
  const chatId = await getTelegramChatId();
  const created = await createPost({ profile: 'telegram', caption, media: [videoUrl], platformParams: { chat_id: chatId } });
  return pollPost(created.id);
}

async function publishTelegramCarouselViaPostproxy({ imageUrls, caption }) {
  const chatId = await getTelegramChatId();
  const created = await createPost({ profile: 'telegram', caption, media: imageUrls, platformParams: { chat_id: chatId } });
  return pollPost(created.id);
}

module.exports = {
  publishReelViaPostproxy,
  publishCarouselViaPostproxy,
  publishTelegramVideoViaPostproxy,
  publishTelegramCarouselViaPostproxy,
  getTelegramChatId,
};
