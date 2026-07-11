const path = require('path');

const IMAGES_DIR = path.join(__dirname, '..', 'images');

const PROJECTS = [
  {
    key: 'Практик 75',
    title: '«Практик 75»',
    area: '75 м²',
    price: '3 540 000 ₽',
    exterior: path.join(IMAGES_DIR, 'practik-75-exterior.png'),
    plan: path.join(IMAGES_DIR, 'practik-75-plan.png'),
  },
  {
    key: 'Практик 90',
    title: '«Практик 90»',
    area: '90 м²',
    price: '3 950 000 ₽',
    exterior: path.join(IMAGES_DIR, 'practik-90-exterior.png'),
    plan: path.join(IMAGES_DIR, 'practik-90-plan.png'),
  },
];

const APPLY_PROJECT_OPTIONS = [
  { key: 'Практик 75', label: '«Практик 75» — 75 м², 3 540 000 ₽' },
  { key: 'Практик 75м', label: '«Практик 75м» — 75 м², 3 540 000 ₽' },
  { key: 'Практик 90', label: '«Практик 90» — 90 м², 3 950 000 ₽' },
  { key: 'Практик 90м', label: '«Практик 90м» — 90 м², 3 950 000 ₽' },
];

const CALL_TIME_OPTIONS = [
  'Утром (9:00–12:00)',
  'Днём (12:00–15:00)',
  'После обеда (15:00–18:00)',
  'Вечером (18:00–21:00)',
];

module.exports = { PROJECTS, APPLY_PROJECT_OPTIONS, CALL_TIME_OPTIONS };
