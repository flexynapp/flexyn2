// src/lib/i18n-notifications.js
//
// Translations for the notification panel UI. The notification ROW content
// (titles/bodies) is written at insert time in src/lib/data/notifications.js
// and stored as-is — the panel chrome is what's translated here.

const enKeys = {
  'notifications.title':         'Notifications',
  'notifications.markAllRead':   'Mark all as read',
  'notifications.empty.title':   'No notifications yet',
  'notifications.empty.desc':    'When you complete quests, hit streaks, or your friends post, you\'ll see it here.',
  'notifications.showing50':     'Showing the 50 most recent',
};

const esKeys = {
  'notifications.title':         'Notificaciones',
  'notifications.markAllRead':   'Marcar todo como leído',
  'notifications.empty.title':   'Aún no hay notificaciones',
  'notifications.empty.desc':    'Cuando completes misiones, mantengas rachas o tus amigos publiquen, lo verás aquí.',
  'notifications.showing50':     'Mostrando las 50 más recientes',
};

const frKeys = {
  'notifications.title':         'Notifications',
  'notifications.markAllRead':   'Tout marquer comme lu',
  'notifications.empty.title':   'Aucune notification',
  'notifications.empty.desc':    'Lorsque vous complétez des quêtes, atteignez des séries ou que vos amis publient, vous le verrez ici.',
  'notifications.showing50':     'Affichage des 50 plus récentes',
};

const deKeys = {
  'notifications.title':         'Benachrichtigungen',
  'notifications.markAllRead':   'Alle als gelesen markieren',
  'notifications.empty.title':   'Noch keine Benachrichtigungen',
  'notifications.empty.desc':    'Wenn du Quests abschließt, Serien erreichst oder deine Freunde posten, siehst du es hier.',
  'notifications.showing50':     'Die 50 neuesten werden angezeigt',
};

const ptKeys = {
  'notifications.title':         'Notificações',
  'notifications.markAllRead':   'Marcar tudo como lido',
  'notifications.empty.title':   'Sem notificações ainda',
  'notifications.empty.desc':    'Quando completar missões, manter sequências ou seus amigos postarem, você verá aqui.',
  'notifications.showing50':     'Mostrando as 50 mais recentes',
};

const jaKeys = {
  'notifications.title':         '通知',
  'notifications.markAllRead':   'すべて既読にする',
  'notifications.empty.title':   '通知はまだありません',
  'notifications.empty.desc':    'クエスト完了、連続記録、フォロー中のユーザーの投稿があると、ここに表示されます。',
  'notifications.showing50':     '最新の50件を表示',
};

export const notificationsI18n = {
  en: enKeys,
  es: esKeys,
  fr: frKeys,
  de: deKeys,
  pt: ptKeys,
  ja: jaKeys,
  // Fallback to English for the remaining 9
  it: enKeys, ko: enKeys, zh: enKeys, ar: enKeys, hi: enKeys,
  ru: enKeys, tr: enKeys, pl: enKeys, nl: enKeys,
};
