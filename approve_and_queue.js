require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { upsertStage, getPipelineRow } = require('./lib/contentPipeline');
const { enqueuePost, getNextDailySlot } = require('./lib/scheduledPosts');

const reelSlugs = ['reel-09-pzz-uchastok', 'reel-10-tyoplyi-pol'];

(async () => {
  for (const reelSlug of reelSlugs) {
    const row = await getPipelineRow(reelSlug);
    if (!row || !row.video_url) throw new Error('No video_url for ' + reelSlug);

    await upsertStage(reelSlug, 'approved', { platform: 'instagram' });

    const captionPath = path.join(
      'C:\\Users\\Влад\\Desktop\\АПД строй\\content',
      reelSlug,
      'caption.txt'
    );
    const caption = fs.readFileSync(captionPath, 'utf8').trim();

    const scheduledAt = await getNextDailySlot();
    const postId = await enqueuePost({ reelSlug, videoUrl: row.video_url, caption, scheduledAt, platform: 'instagram' });

    console.log(`[${reelSlug}] approved, queued id=${postId} for ${scheduledAt.toISOString()}`);
  }
})().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
