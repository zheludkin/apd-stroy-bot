const fs = require('fs');
const path = require('path');

function readGlobalInstructions() {
  try {
    return fs.readFileSync(
      path.join(__dirname, '..', 'claude-global-instructions.md'),
      'utf8'
    );
  } catch (e) {
    return '(файл claude-global-instructions.md не найден в репозитории)';
  }
}

function nowLabel() {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function val(name) {
  return process.env[name] || '(не задано)';
}

function buildBackupText() {
  const sheetId = val('GOOGLE_SHEET_ID');

  return `АПД Строй — резервная информация
Сформировано: ${nowLabel()} (МСК)

Этот файл нужен, чтобы полностью восстановить сайт и бота на новом
компьютере или после переустановки Claude Code. Держите его в надёжном
месте — здесь ключи от всех сервисов.

=== GitHub (аккаунт zheludkin) ===
Сайт:  https://github.com/zheludkin/apd-stroy-site
Бот:   https://github.com/zheludkin/apd-stroy-bot

=== Render.com (аккаунт zheludkin@gmail.com) ===
Сайт:        apd-stroy-site — https://apd-stroy-site.onrender.com
Бот:         apd-stroy-bot  — https://apd-stroy-bot.onrender.com
API-ключ:    ${val('RENDER_API_KEY')}
(API-ключ даёт полный доступ к аккаунту Render — им можно пересоздать
и настроить сервисы через API без ручных кликов.)

=== Google Таблица с заявками ===
Ссылка:              https://docs.google.com/spreadsheets/d/${sheetId}/edit
GOOGLE_SHEET_ID:                ${sheetId}
GOOGLE_SERVICE_ACCOUNT_EMAIL:   ${val('GOOGLE_SERVICE_ACCOUNT_EMAIL')}
GOOGLE_PRIVATE_KEY:
${val('GOOGLE_PRIVATE_KEY')}
(Тот же сервисный аккаунт используется и сайтом, и ботом.)

=== Telegram-бот ===
Username:               @apd59_bot
TELEGRAM_BOT_TOKEN:     ${val('TELEGRAM_BOT_TOKEN')}
Группа «Заявки АПД Строй»
TELEGRAM_GROUP_CHAT_ID: ${val('TELEGRAM_GROUP_CHAT_ID')}

=== Ежедневный отчёт ===
CRON_SECRET: ${val('CRON_SECRET')}
Отчёт запускается по расписанию GitHub Actions в репозитории бота
(.github/workflows/daily-report.yml), обращается на
${val('WEBHOOK_URL')}/cron/daily-report?secret=...

=== Почта (SMTP, сейчас не работает — Render блокирует SMTP-порты) ===
SMTP_HOST: ${val('SMTP_HOST')}
SMTP_PORT: ${val('SMTP_PORT')}
SMTP_USER: ${val('SMTP_USER')}
SMTP_PASS: ${val('SMTP_PASS')}
REPORT_EMAIL_TO: ${val('REPORT_EMAIL_TO')}

=== Домен ===
апд59.рф (punycode: xn--59-6kcq8c.xn--p1ai)
Регистратор: reg.ru (аккаунт mz.59@yandex.ru)
DNS: Cloudflare (аккаунт zheludkin@gmail.com)
NS-серверы: clay.ns.cloudflare.com, maisie.ns.cloudflare.com

=== Как восстановить с нуля ===
1. Установить Node.js (LTS) и git.
2. git clone обоих репозиториев (ссылки выше).
3. В каждой папке создать файл .env и вставить туда переменные из
   соответствующих разделов этого файла (для сайта — раздел Google
   Таблицы; для бота — всё, кроме GitHub/Render).
4. npm install в каждой папке.
5. Если нужно пересоздать сервисы на Render — использовать RENDER_API_KEY
   из раздела выше через Render API (POST /v1/services), либо создать
   вручную в панели Render и подключить эти же GitHub-репозитории.
6. Проверить вебхук бота: GOOGLE-таблица и Telegram должны совпадать со
   значениями выше.

=== Личные инструкции для Claude Code (~/.claude/CLAUDE.md) ===
Эти правила действуют во всех проектах на компьютере пользователя.
Чтобы Claude Code на новом компьютере работал так же — скопируйте текст
ниже в файл ~/.claude/CLAUDE.md (Windows: C:\\Users\\<имя>\\.claude\\CLAUDE.md).

${readGlobalInstructions()}
`;
}

async function sendBackupToTelegram(bot) {
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (!chatId) {
    console.error('TELEGRAM_GROUP_CHAT_ID не задан — бэкап не отправлен.');
    return;
  }
  const text = buildBackupText();
  const filename = `backup-apd-stroy-${new Date().toISOString().slice(0, 10)}.txt`;
  await bot.telegram.sendDocument(
    chatId,
    { source: Buffer.from(text, 'utf8'), filename },
    { caption: 'Резервная информация для восстановления сайта и бота' }
  );
}

module.exports = { buildBackupText, sendBackupToTelegram };
