// Ветка "УДАЧНАЯ" (Instagram, активный CTA, риск 72-ФЗ принят пользователем
// 22.07.2026, content_track='active_cta' в БД) — аватар Nicholas, группа
// 309bab597036410b9a40319905af3ce3. Каждый следующий ролик этой ветки берёт
// новый "look" по кругу для визуального разнообразия (по аналогии с тем, как
// у робота-аватара менялся фон между клипами).
const AVATAR_GROUP_ID = '309bab597036410b9a40319905af3ce3';

const LOOKS = [
  '04fb9c5194b64b288d209087d7e3987f',
  '12e38b95856c4ea39bd683b330bd92fc',
  '2e97f38cb5c349619d0ca64987708c67',
  '33b008ff64df48d0886745a2db55b416',
  '3af34d25482a40358fd6fa6e6a13867d',
  '412d4395e4bd4c6aa33404e165c86695',
  '621ee8289484412e9eaa03464c403f66',
  'b866fbc1983f4394887b427630e9c132',
  'be8f736e95c84ffc94c8b42d50f31c37',
  'ca7f6df444044340a393cfe0c0c998f2',
  'cc143447e1cc48b9b67dc4d113748984',
  'cf1665c7ef6d4021beeebc3e09ac27e7',
  'ef107d87cc6946b9b6d206ca4b9821e3',
];

function lookForIndex(topicIndex) {
  return LOOKS[topicIndex % LOOKS.length];
}

module.exports = { AVATAR_GROUP_ID, LOOKS, lookForIndex };
