require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { upsertStage } = require('./lib/contentPipeline');

const apiKey = process.env.HEYGEN_API_KEY;
const tgToken = process.env.TELEGRAM_BOT_TOKEN;
const tgChatId = process.env.TELEGRAM_GROUP_CHAT_ID;

const reelSlug = process.argv[2];
const renderPath = process.argv[3];
const captionPath = process.argv[4];
const contentTrack = process.argv[5] || 'main';

if (!reelSlug || !renderPath || !captionPath) {
  console.error('Usage: node submit_reel.js <reelSlug> <renderPath> <captionFilePath> [contentTrack]');
  process.exit(1);
}

const caption = fs.readFileSync(captionPath, 'utf8').trim();

async function uploadToHeygen(filePath) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], { type: 'video/mp4' });
  const form = new FormData();
  form.append('file', blob, path.basename(filePath));
  const res = await fetch('https://api.heygen.com/v3/assets', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: form,
  });
  return res.json();
}

async function sendToTelegram(videoPath, tgCaption, slug) {
  const buf = fs.readFileSync(videoPath);
  const blob = new Blob([buf], { type: 'video/mp4' });
  const form = new FormData();
  form.append('chat_id', tgChatId);
  form.append('video', blob, path.basename(videoPath));
  form.append('caption', tgCaption);
  form.append(
    'reply_markup',
    JSON.stringify({
      inline_keyboard: [
        [
          { text: '✅ Одобрить и в очередь', callback_data: `pipeline_approve:${slug}` },
          { text: '❌ Не публиковать', callback_data: `pipeline_reject:${slug}` },
        ],
      ],
    })
  );
  const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendVideo`, {
    method: 'POST',
    body: form,
  });
  return res.json();
}

(async () => {
  console.log(`[${reelSlug}] Uploading to HeyGen assets...`);
  const uploadResult = await uploadToHeygen(renderPath);
  const videoUrl = uploadResult.data && uploadResult.data.url;
  if (!videoUrl) {
    console.error('FAILED to get video URL from HeyGen upload:', JSON.stringify(uploadResult));
    process.exit(1);
  }
  console.log(`[${reelSlug}] HeyGen video_url:`, videoUrl);

  console.log(`[${reelSlug}] Sending to Telegram...`);
  const trackLabel = contentTrack === 'active_cta' ? ', ветка с активным CTA' : '';
  const tgCaption = `Ролик «${reelSlug}» (instagram${trackLabel}) готов — проверьте и решите.`;
  const tgResult = await sendToTelegram(renderPath, tgCaption, reelSlug);
  if (!tgResult.ok) {
    console.error('FAILED to send to Telegram:', JSON.stringify(tgResult));
    process.exit(1);
  }
  const messageId = tgResult.result.message_id;
  console.log(`[${reelSlug}] Telegram message_id:`, messageId);

  await upsertStage(reelSlug, 'awaiting_review', {
    videoUrl,
    telegramChatId: tgChatId,
    telegramMessageId: String(messageId),
    platform: 'instagram',
    contentTrack,
    notes: caption,
  });
  console.log(`[${reelSlug}] content_pipeline updated: awaiting_review`);
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
