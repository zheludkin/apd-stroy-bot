// Временный обходной путь (01.08.2026): Timeweb (ru-3) периодически не может
// достучаться до graph.instagram.com / api.telegram.org (connect timeout),
// хотя эта локальная машина видит оба хоста без проблем. Пока проблема на
// стороне Timeweb не решена (см. обращение в поддержку), эта машина по
// расписанию (Windows Task Scheduler, см. setup_local_publish_task.ps1)
// публикует накопившиеся Instagram-посты напрямую, в обход облака.
//
// Использует ту же БД (DATABASE_URL) и ту же логику публикации, что и
// сервер — просто выполняет её локально вместо Timeweb.
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { processDuePosts } = require('./lib/instagramPublish');
const { processDuePosts: processDueYouTubePosts } = require('./lib/youtubePublish');
const { sendDueDeleteReminders } = require('./lib/deleteReminders');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

(async () => {
  log('local_publish_relay: старт');
  try {
    const results = await processDuePosts(bot);
    log('Instagram:', JSON.stringify(results));
  } catch (e) {
    log('Instagram FAILED:', e.message);
  }
  try {
    const ytResults = await processDueYouTubePosts(bot);
    log('YouTube:', JSON.stringify(ytResults));
  } catch (e) {
    log('YouTube FAILED:', e.message);
  }
  try {
    const reminders = await sendDueDeleteReminders(bot, 'instagram');
    log('Напоминания об удалении:', JSON.stringify(reminders));
  } catch (e) {
    log('Напоминания FAILED:', e.message);
  }
  log('local_publish_relay: конец');
  process.exit(0);
})().catch((e) => {
  log('FATAL', e.message);
  process.exit(1);
});
