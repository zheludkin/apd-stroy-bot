require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { Telegraf, Scenes, session, Markup } = require('telegraf');

const leadForm = require('./scenes/leadForm');
const smetaWizard = require('./scenes/smetaWizard');
const { sendDailyReport } = require('./lib/report');
const { sendBackupToTelegram } = require('./lib/backup');
const { PROJECTS } = require('./lib/projects');
const { processDuePosts } = require('./lib/instagramPublish');
const { processDuePosts: processDueYouTubePosts } = require('./lib/youtubePublish');
const { processDuePosts: processDueVkPosts } = require('./lib/vkPublish');
const { upsertStage, getByTelegramMessage, getAwaitingReview, getPipelineRow } = require('./lib/contentPipeline');
const { sendDueDeleteReminders } = require('./lib/deleteReminders');
const {
  enqueuePost,
  getNextTueThuSlot,
  getNextMonFriSlot,
  getNextMonWedFriSlot,
  getNextInstagramRiskyTrackSlot,
  getNextFreeSlot,
} = require('./lib/scheduledPosts');

function formatPermTime(date) {
  return (
    date.toLocaleString('ru-RU', {
      timeZone: 'Asia/Yekaterinburg', // UTC+5, совпадает с Пермью
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' (Пермь)'
  );
}

// Определяет каденс по platform+content_track ролика и сразу ставит его в
// scheduled_posts — раньше это одобрение только меняло stage, а реальная
// постановка в график делалась вручную отдельным скриптом (жалоба
// пользователя 23.07.2026: после нажатия кнопки не было видно, что ролик
// реально встал в график).
async function approveAndSchedule(row) {
  if (!row.video_url) {
    throw new Error('В content_pipeline нет video_url для ' + row.reel_slug);
  }
  const caption = row.notes || '';

  let scheduledAt;
  if (row.platform === 'instagram' && row.content_track === 'active_cta') {
    scheduledAt = await getNextInstagramRiskyTrackSlot();
  } else if (row.platform === 'instagram') {
    scheduledAt = await getNextTueThuSlot();
  } else if (row.platform === 'youtube') {
    scheduledAt = await getNextMonFriSlot();
  } else if (row.platform === 'vk') {
    scheduledAt = await getNextMonWedFriSlot();
  } else {
    scheduledAt = await getNextFreeSlot();
  }

  await enqueuePost({
    reelSlug: row.reel_slug,
    videoUrl: row.video_url,
    caption,
    scheduledAt,
    platform: row.platform,
    contentTrack: row.content_track,
  });
  await upsertStage(row.reel_slug, 'approved', { platform: row.platform });

  return scheduledAt;
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('Не задан TELEGRAM_BOT_TOKEN в .env');
}

const bot = new Telegraf(BOT_TOKEN);
const stage = new Scenes.Stage([leadForm, smetaWizard]);
bot.use(session());
bot.use(stage.middleware());

const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('Каталог проектов', 'catalog')],
  [Markup.button.callback('О компании', 'about')],
  [Markup.button.callback('Оставить заявку', 'apply')],
]);

const WELCOME_TEXT =
  'Здравствуйте! Мы — «АПД Строй», строим тёплые каркасные дома для семей с детьми в ' +
  'Перми и Пермском крае. Дома подходят под семейную ипотеку, а первый взнос — от ' +
  '100 000 ₽.\n\nПокажем уже построенный дом-образец вживую — просто оставьте заявку, ' +
  'и мы согласуем удобное время.\n\nВыберите, с чего начать:';

const ABOUT_TEXT =
  'Каркасный дом — это быстро (сезон вместо года), экологично (натуральные материалы, ' +
  'дышащие стены) и доступно по семейной ипотеке.\n\n' +
  'Точный адрес дома-образца и офиса пока не публикуем — оставьте заявку, и мы ' +
  'согласуем удобное время, чтобы показать дом вживую.';

bot.start(async (ctx) => {
  await ctx.reply(WELCOME_TEXT, mainMenu);
});

bot.action('menu', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Главное меню:', mainMenu);
});

bot.action('about', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(ABOUT_TEXT, mainMenu);
});

bot.action('catalog', async (ctx) => {
  await ctx.answerCbQuery();
  for (const project of PROJECTS) {
    const caption = `${project.title}\nПлощадь: ${project.area}\nЦена: ${project.price}`;
    await ctx.replyWithMediaGroup([
      { type: 'photo', media: { source: fs.createReadStream(project.exterior) }, caption },
      { type: 'photo', media: { source: fs.createReadStream(project.plan) } },
    ]);
  }
  await ctx.reply(
    'Хотите оставить заявку на просмотр?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Оставить заявку', 'apply')],
      [Markup.button.callback('В главное меню', 'menu')],
    ])
  );
});

bot.action('apply', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter('lead-form');
});

bot.action(/^pipeline_approve:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('Принято, ставлю в график');
  const reelSlug = ctx.match[1];
  try {
    const row = await getPipelineRow(reelSlug);
    if (!row) throw new Error('Не найден ролик в content_pipeline: ' + reelSlug);
    const scheduledAt = await approveAndSchedule(row);
    await ctx.reply(`✅ «${reelSlug}» одобрен и поставлен в график — публикация ${formatPermTime(scheduledAt)}.`);
  } catch (err) {
    console.error('Ошибка одобрения ролика:', err.message);
    await ctx.reply('Не получилось поставить ролик в график: ' + err.message);
  }
});

bot.action(/^pipeline_reject:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('Отмечено, публиковать не будем');
  const reelSlug = ctx.match[1];
  try {
    await upsertStage(reelSlug, 'rejected');
    await ctx.reply(`❌ «${reelSlug}» отклонён — не будет опубликован автоматически, разберём вручную.`);
  } catch (err) {
    console.error('Ошибка отклонения ролика:', err.message);
    await ctx.reply('Не получилось сохранить решение, попробуйте ещё раз.');
  }
});

// Текстовый fallback для одобрения/отклонения роликов — на случай, если
// inline-кнопки не срабатывают (жалоба пользователя 23.07.2026). Работает и
// как ответ (Reply) на конкретное сообщение с видео, и как обычное
// сообщение, если ждёт решения ровно один ролик.
const APPROVE_WORDS = ['ок', 'окей', 'ok', 'да', 'одобряю', 'одобрить', 'approve'];
const REJECT_WORDS = ['отмена', 'отклонить', 'отклоняю', 'нет', 'cancel', 'reject'];

function decisionFromText(text) {
  const t = (text || '').trim().toLowerCase();
  if (APPROVE_WORDS.includes(t)) return 'approved';
  if (REJECT_WORDS.includes(t)) return 'rejected';
  return null;
}

bot.on('text', async (ctx, next) => {
  const decision = decisionFromText(ctx.message.text);
  if (!decision) return next();

  try {
    let row = null;
    const replyTo = ctx.message.reply_to_message;
    if (replyTo) {
      row = await getByTelegramMessage(String(ctx.chat.id), String(replyTo.message_id));
    }
    if (!row) {
      const pending = await getAwaitingReview(ctx.chat.id);
      if (pending.length === 1) {
        row = pending[0];
      } else if (pending.length > 1) {
        const list = pending.map((p) => `• ${p.reel_slug}`).join('\n');
        await ctx.reply(
          `Ждут решения сразу несколько роликов, не понимаю, к какому это относится:\n${list}\n\nОтветьте (Reply) прямо на сообщение с нужным видео словом «ок» или «отмена».`
        );
        return;
      }
    }
    if (!row) {
      return next();
    }
    if (row.stage !== 'awaiting_review') {
      await ctx.reply(`«${row.reel_slug}» уже в статусе «${row.stage}», ничего не меняю.`);
      return;
    }

    if (decision === 'approved') {
      const scheduledAt = await approveAndSchedule(row);
      await ctx.reply(`✅ «${row.reel_slug}» одобрен и поставлен в график — публикация ${formatPermTime(scheduledAt)}.`);
    } else {
      await upsertStage(row.reel_slug, 'rejected');
      await ctx.reply(`❌ «${row.reel_slug}» отклонён — не будет опубликован автоматически, разберём вручную.`);
    }
  } catch (err) {
    console.error('Ошибка текстового одобрения/отклонения:', err.message);
    await ctx.reply('Не получилось сохранить решение: ' + err.message);
  }
});

bot.command('smeta', async (ctx) => {
  const modelArg = ctx.message.text.split(' ').slice(1).join(' ').trim();
  await ctx.scene.enter('smeta-wizard', { modelArg });
});

bot.catch((err, ctx) => {
  console.error('Ошибка обработки апдейта Telegram:', err);
  ctx.reply('Что-то пошло не так, попробуйте, пожалуйста, ещё раз.').catch(() => {});
});

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('АПД Строй бот работает'));

const WEBHOOK_PATH = `/telegraf/${BOT_TOKEN}`;
app.use(bot.webhookCallback(WEBHOOK_PATH));

app.get('/cron/daily-report', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).send('Forbidden');
  }
  try {
    const result = await sendDailyReport(bot);
    await sendBackupToTelegram(bot).catch((err) =>
      console.error('Ошибка отправки резервного файла:', err.message)
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Ошибка формирования ежедневного отчёта:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/cron/scheduled-publish', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).send('Forbidden');
  }
  const results = [];
  let hadError = false;
  try {
    results.push(...(await processDuePosts(bot)));
  } catch (err) {
    hadError = true;
    console.error('Ошибка автопубликации (Instagram):', err.message);
    results.push({ platform: 'instagram', ok: false, error: err.message });
  }
  try {
    results.push(...(await processDueYouTubePosts(bot)));
  } catch (err) {
    hadError = true;
    console.error('Ошибка автопубликации (YouTube):', err.message);
    results.push({ platform: 'youtube', ok: false, error: err.message });
  }
  try {
    results.push(...(await processDueVkPosts(bot)));
  } catch (err) {
    hadError = true;
    console.error('Ошибка автопубликации (VK):', err.message);
    results.push({ platform: 'vk', ok: false, error: err.message });
  }
  try {
    results.push(...(await sendDueDeleteReminders(bot, 'instagram')));
  } catch (err) {
    hadError = true;
    console.error('Ошибка напоминаний об удалении (Instagram):', err.message);
    results.push({ platform: 'instagram', task: 'delete-reminder', ok: false, error: err.message });
  }
  res.status(hadError ? 500 : 200).json({ ok: !hadError, results });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`АПД Строй бот запущен: порт ${PORT}`);

  const webhookUrl = process.env.WEBHOOK_URL;
  if (webhookUrl) {
    await bot.telegram.setWebhook(`${webhookUrl}${WEBHOOK_PATH}`);
    console.log(`Webhook установлен: ${webhookUrl}${WEBHOOK_PATH}`);
  } else {
    console.log('WEBHOOK_URL не задан — бот запущен в режиме long polling.');
    bot.launch();
  }
});
