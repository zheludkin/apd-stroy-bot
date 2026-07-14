const { Markup } = require('telegraf');

const CONSENT_TEXT =
  'Прежде чем продолжить — короткое уведомление.\n\n' +
  'Персональные данные (имя и телефон) обрабатываются исключительно в следующих целях ' +
  'и хранятся не более 1 мес:\n' +
  '— обратная связь по оставленной заявке.\n\n' +
  'Федеральный закон от 27.07.2006 № 152-ФЗ «О персональных данных».\n' +
  'Полный текст политики: https://апд59.рф/politika.html\n\n' +
  'Нажимая «Даю согласие», вы соглашаетесь с Политикой обработки персональных данных ' +
  'и даёте согласие на обработку своих персональных данных.';

const CONSENT_KEYBOARD = Markup.inlineKeyboard([
  [Markup.button.callback('Даю согласие ✅', 'consent:yes')],
  [Markup.button.callback('Отмена', 'consent:no')],
]);

async function requireConsent(ctx) {
  await ctx.reply(CONSENT_TEXT, CONSENT_KEYBOARD);
}

module.exports = { CONSENT_TEXT, CONSENT_KEYBOARD, requireConsent };
