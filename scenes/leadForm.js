const { Scenes, Markup } = require('telegraf');
const { appendLead } = require('../lib/db');
const { APPLY_PROJECT_OPTIONS, CALL_TIME_OPTIONS } = require('../lib/projects');
const { requireConsent } = require('../lib/consent');

const leadForm = new Scenes.WizardScene(
  'lead-form',
  async (ctx) => {
    ctx.wizard.state.lead = { project: ctx.scene.state?.project || '' };
    await requireConsent(ctx);
    return ctx.wizard.next();
  },
  async (ctx) => {
    const data = ctx.callbackQuery?.data;
    if (data === 'consent:no') {
      await ctx.answerCbQuery();
      await ctx.reply('Хорошо, заявку не оставляем. Если передумаете — просто начните заново.');
      return ctx.scene.leave();
    }
    if (data !== 'consent:yes') {
      await ctx.reply('Пожалуйста, нажмите «Даю согласие ✅», чтобы продолжить, или «Отмена».');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.reply('Как к вам обращаться? Напишите, пожалуйста, ваше имя.');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply('Пожалуйста, напишите имя текстом.');
      return;
    }
    ctx.wizard.state.lead.name = ctx.message.text.trim();
    await ctx.reply('Спасибо! Теперь укажите номер телефона для связи.');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply('Пожалуйста, укажите телефон текстом.');
      return;
    }
    ctx.wizard.state.lead.phone = ctx.message.text.trim();

    if (ctx.wizard.state.lead.project) {
      ctx.wizard.state.step = 'time';
      await ctx.reply(
        'В какое время вам удобно позвонить?',
        Markup.inlineKeyboard(
          CALL_TIME_OPTIONS.map((t) => [Markup.button.callback(t, `time:${t}`)])
        )
      );
      return ctx.wizard.next();
    }

    await ctx.reply(
      'Какой проект вас интересует?',
      Markup.inlineKeyboard(
        APPLY_PROJECT_OPTIONS.map((p) => [Markup.button.callback(p.label, `project:${p.key}`)])
      )
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    const data = ctx.callbackQuery?.data;
    if (!data || !data.startsWith('project:')) {
      await ctx.reply('Пожалуйста, выберите проект, нажав на кнопку выше.');
      return;
    }
    ctx.wizard.state.lead.project = data.slice('project:'.length);
    await ctx.answerCbQuery();
    await ctx.reply(
      'В какое время вам удобно позвонить?',
      Markup.inlineKeyboard(
        CALL_TIME_OPTIONS.map((t) => [Markup.button.callback(t, `time:${t}`)])
      )
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    const data = ctx.callbackQuery?.data;
    if (!data || !data.startsWith('time:')) {
      await ctx.reply('Пожалуйста, выберите время, нажав на кнопку выше.');
      return;
    }
    ctx.wizard.state.lead.callTime = data.slice('time:'.length);
    await ctx.answerCbQuery();

    const { name, phone, project, callTime } = ctx.wizard.state.lead;

    try {
      await appendLead({ name, phone, project, callTime, source: 'Telegram-бот' });
      await ctx.reply(
        'Спасибо, менеджер свяжется в течение дня.',
        Markup.inlineKeyboard([[Markup.button.callback('В главное меню', 'menu')]])
      );
    } catch (err) {
      console.error('Не удалось сохранить заявку из Telegram:', err.message);
      await ctx.reply(
        'Не получилось сохранить заявку, попробуйте, пожалуйста, ещё раз чуть позже или позвоните нам напрямую.'
      );
    }

    return ctx.scene.leave();
  }
);

leadForm.command('cancel', async (ctx) => {
  await ctx.reply('Заявка отменена.');
  return ctx.scene.leave();
});

module.exports = leadForm;
