const { Scenes, Markup } = require('telegraf');
const { parseSmetaExcel } = require('../lib/smetaExcel');
const { buildSmetaPdf, formatSum } = require('../lib/smetaPdf');
const { normalizeModelArg } = require('../lib/smetaModels');

const MODEL_BUTTONS = [
  ['«Практик 75»', 'smetamodel:75'],
  ['«Практик 75м»', 'smetamodel:75m'],
  ['«Практик 90»', 'smetamodel:90'],
  ['«Практик 90м»', 'smetamodel:90m'],
];

function isExcelDocument(document) {
  if (!document) return false;
  const name = (document.file_name || '').toLowerCase();
  const mime = document.mime_type || '';
  return (
    name.endsWith('.xlsx') ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

const smetaWizard = new Scenes.WizardScene(
  'smeta-wizard',

  async (ctx) => {
    ctx.wizard.state.smeta = ctx.wizard.state.smeta || {};

    if (!ctx.wizard.state.smeta.model) {
      const modelArg = ctx.scene.state?.modelArg;
      const fromArg = normalizeModelArg(modelArg);
      if (fromArg) {
        ctx.wizard.state.smeta.model = fromArg;
      } else {
        const data = ctx.callbackQuery?.data;
        if (data && data.startsWith('smetamodel:')) {
          const picked = normalizeModelArg(data.slice('smetamodel:'.length));
          if (picked) {
            ctx.wizard.state.smeta.model = picked;
            await ctx.answerCbQuery();
          }
        }
      }
    }

    if (!ctx.wizard.state.smeta.model) {
      await ctx.reply(
        'Для какой модели дома формируем смету?',
        Markup.inlineKeyboard(MODEL_BUTTONS.map(([label, data]) => [Markup.button.callback(label, data)]))
      );
      return;
    }

    await ctx.reply('Как зовут заказчика? Напишите ФИО или имя.');
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply('Пожалуйста, напишите ФИО заказчика текстом.');
      return;
    }
    ctx.wizard.state.smeta.customerName = ctx.message.text.trim();
    await ctx.reply('Укажите телефон заказчика.');
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply('Пожалуйста, укажите телефон текстом.');
      return;
    }
    ctx.wizard.state.smeta.phone = ctx.message.text.trim();
    await ctx.reply(
      'Пришлите, пожалуйста, Excel-файл (.xlsx) со сметой — колонки «срок», «этап», «сумма».'
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const document = ctx.message?.document;
    if (!isExcelDocument(document)) {
      await ctx.reply('Нужен именно .xlsx файл. Пришлите, пожалуйста, Excel-файл со сметой.');
      return;
    }

    try {
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const response = await fetch(fileLink.href);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { rows, total } = await parseSmetaExcel(buffer);
      const { model, customerName, phone } = ctx.wizard.state.smeta;

      const pdfBuffer = await buildSmetaPdf({ model, customerName, phone, rows, total });

      const phoneDigits = phone.replace(/\D/g, '') || 'unknown';
      const dateSlug = new Date().toISOString().slice(0, 10);
      const filename = `smeta_${phoneDigits}_${dateSlug}.pdf`;

      await ctx.replyWithDocument(
        { source: pdfBuffer, filename },
        { caption: `Смета «${model.label}» готова.` }
      );

      const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID;
      if (groupChatId) {
        const caption =
          `Новая смета\n` +
          `Заказчик: ${customerName}\n` +
          `Телефон: ${phone}\n` +
          `Модель: «${model.label}»\n` +
          `Итого: ${formatSum(total)}`;
        await ctx.telegram
          .sendDocument(groupChatId, { source: pdfBuffer, filename }, { caption })
          .catch((err) => console.error('Не удалось отправить смету в группу:', err.message));
      }

      await ctx.reply(
        'Готово!',
        Markup.inlineKeyboard([[Markup.button.callback('В главное меню', 'menu')]])
      );
    } catch (err) {
      console.error('Ошибка формирования сметы:', err.message);
      await ctx.reply(
        `Не получилось сформировать смету: ${err.message}\nПроверьте файл и пришлите, пожалуйста, ещё раз.`
      );
      return;
    }

    return ctx.scene.leave();
  }
);

smetaWizard.command('cancel', async (ctx) => {
  await ctx.reply('Формирование сметы отменено.');
  return ctx.scene.leave();
});

module.exports = smetaWizard;
