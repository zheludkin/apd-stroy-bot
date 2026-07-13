const path = require('path');

const IMAGES_DIR = path.join(__dirname, '..', 'images');

const BASE_MODELS = {
  '75': {
    area: '75 м²',
    exterior: path.join(IMAGES_DIR, 'practik-75-exterior.png'),
    plan: path.join(IMAGES_DIR, 'practik-75-plan.png'),
    planM: path.join(IMAGES_DIR, 'practik-75m-plan.png'),
  },
  '90': {
    area: '90 м²',
    exterior: path.join(IMAGES_DIR, 'practik-90-exterior.png'),
    plan: path.join(IMAGES_DIR, 'practik-90-plan.png'),
    planM: path.join(IMAGES_DIR, 'practik-90m-plan.png'),
  },
};

function normalizeModelArg(arg) {
  const a = (arg || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = a.match(/^(75|90)(m|м)?$/);
  if (!match) return null;

  const base = match[1];
  const isM = Boolean(match[2]);
  const label = `Практик ${base}${isM ? 'м' : ''}`;
  const { planM, ...rest } = BASE_MODELS[base];

  return { base, label, ...rest, plan: isM ? planM : rest.plan };
}

module.exports = { normalizeModelArg, BASE_MODELS };
