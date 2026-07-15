require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { Telegraf, Scenes, session, Markup } = require('telegraf');

const leadForm = require('./scenes/leadForm');
const smetaWizard = require('./scenes/smetaWizard');
const { sendDailyReport } = require('./lib/report');
const { sendBackupToTelegram } = require('./lib/backup');
const { PROJECTS } = require('./lib/projects');

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
