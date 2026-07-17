const { OAuth2Client } = require('google-auth-library');
const { getDuePosts, markPublishing, markPublished, markFailed } = require('./scheduledPosts');

function getOAuthClient() {
  const client = new OAuth2Client(process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
  return client;
}

// caption's first line becomes the title (YouTube caps titles at 100 chars);
// the whole caption becomes the description.
function splitCaption(caption) {
  const firstLine = caption.split('\n')[0].trim();
  const title = (firstLine.length > 92 ? firstLine.slice(0, 92) + '…' : firstLine) + ' #Shorts';
  return { title, description: caption };
}

async function publishToYouTube({ videoUrl, caption }) {
  const oauth2Client = getOAuthClient();
  const { token: accessToken } = await oauth2Client.getAccessToken();
  if (!accessToken) throw new Error('Failed to obtain YouTube access token from refresh token');

  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error('Failed to download source video: ' + videoRes.status);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

  const { title, description } = splitCaption(caption);

  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(videoBuffer.length),
      },
      body: JSON.stringify({
        snippet: {
          title,
          description,
          tags: ['каркасныйдомпермь', 'строительствопермь', 'домподключ', 'ижспермь'],
          categoryId: '26', // Howto & Style
        },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    }
  );
  if (!initRes.ok) {
    throw new Error('Failed to init YouTube upload session: ' + JSON.stringify(await initRes.json().catch(() => ({}))));
  }
  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube did not return an upload session URL');

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(videoBuffer.length) },
    body: videoBuffer,
  });
  const uploadJson = await uploadRes.json();
  if (!uploadJson.id) throw new Error('YouTube upload failed: ' + JSON.stringify(uploadJson));

  return { videoId: uploadJson.id, permalink: `https://youtube.com/shorts/${uploadJson.id}` };
}

async function processDuePosts(bot) {
  const posts = await getDuePosts(5, 'youtube');
  const results = [];
  for (const post of posts) {
    await markPublishing(post.id);
    try {
      const { videoId, permalink } = await publishToYouTube({ videoUrl: post.video_url, caption: post.caption });
      await markPublished(post.id, { mediaId: videoId, permalink });
      results.push({ id: post.id, ok: true, permalink });
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram
          .sendMessage(process.env.TELEGRAM_GROUP_CHAT_ID, `✅ Автопубликация (YouTube): «${post.reel_slug}» опубликован.\n${permalink}`)
          .catch(() => {});
      }
    } catch (err) {
      await markFailed(post.id, err.message);
      results.push({ id: post.id, ok: false, error: err.message });
      if (bot && process.env.TELEGRAM_GROUP_CHAT_ID) {
        await bot.telegram
          .sendMessage(process.env.TELEGRAM_GROUP_CHAT_ID, `❌ Автопубликация (YouTube) «${post.reel_slug}» НЕ удалась: ${err.message}`)
          .catch(() => {});
      }
    }
  }
  return results;
}

module.exports = { publishToYouTube, processDuePosts };
