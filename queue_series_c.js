require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { enqueuePost, getActiveScheduleForReel } = require('./lib/scheduledPosts');

const HEYGEN_KEY = process.env.HEYGEN_API_KEY;

async function uploadToHeygen(localPath) {
  const buf = fs.readFileSync(localPath);
  const blob = new Blob([buf], { type: 'video/mp4' });
  const form = new FormData();
  form.append('file', blob, path.basename(localPath));
  const res = await fetch('https://api.heygen.com/v3/assets', {
    method: 'POST',
    headers: { 'x-api-key': HEYGEN_KEY },
    body: form,
  });
  const j = await res.json();
  if (!j?.data?.url) throw new Error('HeyGen upload failed: ' + JSON.stringify(j));
  return j.data.url;
}

function buildCaption({ topic }) {
  const tags = ['#юмор', '#ии', '#gpt', '#клод'];
  if (topic === 'stroika') tags.push('#стройка', '#апдстрой');
  return `ИИ отвечает на вопросы кожаных 🤖\n\n${tags.join(' ')}\n\n🤖 Текст и озвучка ролика созданы с помощью ИИ.`;
}

// 13:20 Пермь = 08:20 UTC, 18:20 Пермь = 13:20 UTC (Пермь = UTC+5)
const SLOTS = {
  slot1320: { hourUTC: 8, minuteUTC: 20 },
  slot1820: { hourUTC: 13, minuteUTC: 20 },
};

function slotDate(dayOffset, slotName) {
  const { hourUTC, minuteUTC } = SLOTS[slotName];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hourUTC, minuteUTC, 0, 0);
  return d;
}

// 'max_channel' — платформенная строка, которую фильтрует getDuePosts(5, 'max_channel')
// в lib/maxChannelPublish.js; 'max' здесь не работает (баг найден 19.09.2026 —
// эпизоды 1-2 зависли в MAX со статусом 'pending' навсегда, воркер их не видел).
const PLATFORMS = ['instagram', 'youtube', 'ok', 'max_channel'];

// dayOffset: 0 = сегодня, 1 = завтра, ...
// slotName: 'slot1320' | 'slot1820'
// isTrial: только имеет эффект для platform='instagram', остальные игнорируют
async function queueEpisode({ slug, localPath, topic, dayOffset, slotName, isTrial }) {
  const videoUrl = await uploadToHeygen(localPath);
  console.log(slug, '-> uploaded:', videoUrl);
  const caption = buildCaption({ topic });
  const scheduledAt = slotDate(dayOffset, slotName);
  const results = [];
  for (const platform of PLATFORMS) {
    const reelSlug = `${slug}-${platform}`;
    const already = await getActiveScheduleForReel(reelSlug);
    if (already && already.status !== 'failed') {
      console.log('SKIP (already queued, status=' + already.status + '):', reelSlug);
      results.push({ platform, skipped: true, status: already.status });
      continue;
    }
    const id = await enqueuePost({
      reelSlug,
      videoUrl,
      caption,
      scheduledAt,
      platform,
      contentTrack: 'series_c',
      mediaType: 'video',
      isTrial: platform === 'instagram' ? Boolean(isTrial) : false,
    });
    results.push({ platform, id, scheduledAt: scheduledAt.toISOString() });
  }
  return results;
}

module.exports = { queueEpisode, uploadToHeygen, buildCaption, slotDate };
