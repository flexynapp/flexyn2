// src/lib/i18n-notifications.js
//
// Translations for the notification panel UI AND the per-event-type row
// strings written at insert time by src/lib/data/notifications.js. The
// helpers there use tFallback semantics — any missing key falls back to
// the English literal, so partial language coverage is safe.
//
// Adding a new event type:
//   1. Add a helper in src/lib/data/notifications.js
//   2. Add `notifications.row.<type>.title` (+ `.body` if needed) below
//   3. Translate to other locales as time allows (English is fallback)

const enKeys = {
  // ── Panel chrome ─────────────────────────────────────────────────────────
  'notifications.title':              'Notifications',
  'notifications.markAllRead':        'Mark all as read',
  'notifications.clearAll':           'Clear all',
  'notifications.delete':             'Delete',
  'notifications.deleteFailed':       'Could not delete — try again.',
  'notifications.clearAllFailed':     'Could not clear — try again.',
  'notifications.empty.title':        'No notifications yet',
  'notifications.empty.desc':         'When you complete quests, hit streaks, or your friends post, you\'ll see it here.',
  'notifications.empty.friendsTitle': 'No friend activity yet',
  'notifications.empty.friendsDesc':  "Follow friends and you'll see their posts and reactions here.",
  'notifications.error.title':        "Couldn't load notifications",
  'notifications.error.desc':         'Check your connection and try again.',
  'notifications.unreadBadge':        '{count} unread notification',
  'notifications.unreadBadgePlural':  '{count} unread notifications',
  'notifications.showing50':          'Showing the 50 most recent',
  'notifications.filter':             'Filter notifications',
  'notifications.tab.all':            'All',
  'notifications.tab.friends':        'Friends',

  // ── Row content per event type ───────────────────────────────────────────
  'notifications.row.quest_claimed.title':                    '🪙 +{coins} coins · {quest}',
  'notifications.row.quest_claimed.body':                     'Quest reward claimed.',

  'notifications.row.streak_milestone.workout.title':         '🔥 Workout streak: Day {day}!',
  'notifications.row.streak_milestone.login.title':           '🔥 Login streak: Day {day}!',
  'notifications.row.streak_milestone.body':                  '+{coins} coins',
  'notifications.row.streak_milestone.body_with_capsule':     '+{coins} coins + Elite Capsule',

  'notifications.row.league_promoted.title':                  '⬆️ Promoted to {tier}!',
  'notifications.row.league_promoted.body':                   '+{coins} coins',
  'notifications.row.league_promoted.body_with_capsule':      '+{coins} coins + {capsule} capsule',
  'notifications.row.league_demoted.title':                   '⬇️ Demoted to {tier}',
  'notifications.row.league_demoted.body':                    'Climb back next week!',
  'notifications.row.league_held.title':                      'Held position in {tier}',
  'notifications.row.league_held.body_coins':                 '+{coins} coins',
  'notifications.row.league_held.body_default':               'Push for promotion next week.',

  'notifications.row.friend_post.title':                      '{name} posted',
  'notifications.row.friend_follow.title':                    '{name} followed you',
  'notifications.row.friend_follow.body':                     'Tap to view their profile.',

  'notifications.row.pr_set.title':                           '🏆 New {label} PR!',

  'notifications.row.capsule_earned.title':                   '🎁 {label} Capsule earned',
  'notifications.row.capsule_earned.body_default':            'Open it from your bag.',
  'notifications.row.capsule.label.standard':                 'Standard',
  'notifications.row.capsule.label.premium':                  'Premium',
  'notifications.row.capsule.label.elite':                    'Elite',
  'notifications.row.capsule.label.mystery':                  'Mystery',

  'notifications.row.streak_break_warning.title':             '🔥 {streak}-day streak at risk',
  'notifications.row.streak_break_warning.body':              'Your streak ends at midnight. A quick workout keeps it alive.',
  'notifications.row.welcome_back.title':                     '👋 We miss you',
  'notifications.row.welcome_back.body':                      'Your progress is waiting. Quick session today?',
  'notifications.row.quest_expiry_warning.title':             '⏳ {remaining} quests left today',
  'notifications.row.quest_expiry_warning.body':              "Quests reset at midnight. Don't miss the coins!",
};

const esKeys = {
  'notifications.title':              'Notificaciones',
  'notifications.markAllRead':        'Marcar todo como leído',
  'notifications.clearAll':           'Borrar todo',
  'notifications.delete':             'Eliminar',
  'notifications.deleteFailed':       'No se pudo eliminar — inténtalo de nuevo.',
  'notifications.clearAllFailed':     'No se pudo borrar — inténtalo de nuevo.',
  'notifications.empty.title':        'Aún no hay notificaciones',
  'notifications.empty.desc':         'Cuando completes misiones, mantengas rachas o tus amigos publiquen, lo verás aquí.',
  'notifications.empty.friendsTitle': 'Aún no hay actividad de amigos',
  'notifications.empty.friendsDesc':  'Sigue a tus amigos y verás sus publicaciones y reacciones aquí.',
  'notifications.error.title':        'No se pudieron cargar las notificaciones',
  'notifications.error.desc':         'Comprueba tu conexión e inténtalo de nuevo.',
  'notifications.unreadBadge':        '{count} notificación sin leer',
  'notifications.unreadBadgePlural':  '{count} notificaciones sin leer',
  'notifications.showing50':          'Mostrando las 50 más recientes',
  'notifications.filter':             'Filtrar notificaciones',
  'notifications.tab.all':            'Todas',
  'notifications.tab.friends':        'Amigos',

  'notifications.row.quest_claimed.title':                    '🪙 +{coins} monedas · {quest}',
  'notifications.row.quest_claimed.body':                     'Recompensa de misión reclamada.',

  'notifications.row.streak_milestone.workout.title':         '🔥 Racha de entrenamiento: ¡Día {day}!',
  'notifications.row.streak_milestone.login.title':           '🔥 Racha de inicio: ¡Día {day}!',
  'notifications.row.streak_milestone.body':                  '+{coins} monedas',
  'notifications.row.streak_milestone.body_with_capsule':     '+{coins} monedas + Cápsula Élite',

  'notifications.row.league_promoted.title':                  '⬆️ ¡Promovido a {tier}!',
  'notifications.row.league_promoted.body':                   '+{coins} monedas',
  'notifications.row.league_promoted.body_with_capsule':      '+{coins} monedas + cápsula {capsule}',
  'notifications.row.league_demoted.title':                   '⬇️ Descendido a {tier}',
  'notifications.row.league_demoted.body':                    '¡Vuelve a subir la próxima semana!',
  'notifications.row.league_held.title':                      'Mantuviste tu posición en {tier}',
  'notifications.row.league_held.body_coins':                 '+{coins} monedas',
  'notifications.row.league_held.body_default':               'Apunta a la promoción la próxima semana.',

  'notifications.row.friend_post.title':                      '{name} publicó',
  'notifications.row.friend_follow.title':                    '{name} te sigue',
  'notifications.row.friend_follow.body':                     'Toca para ver su perfil.',

  'notifications.row.pr_set.title':                           '🏆 ¡Nuevo récord de {label}!',

  'notifications.row.capsule_earned.title':                   '🎁 Cápsula {label} obtenida',
  'notifications.row.capsule_earned.body_default':            'Ábrela desde tu bolsa.',
  'notifications.row.capsule.label.standard':                 'Estándar',
  'notifications.row.capsule.label.premium':                  'Premium',
  'notifications.row.capsule.label.elite':                    'Élite',
  'notifications.row.capsule.label.mystery':                  'Misteriosa',

  'notifications.row.streak_break_warning.title':             '🔥 Racha de {streak} días en riesgo',
  'notifications.row.streak_break_warning.body':              'Tu racha termina a medianoche. Un entrenamiento rápido la mantiene viva.',
  'notifications.row.welcome_back.title':                     '👋 Te echamos de menos',
  'notifications.row.welcome_back.body':                      'Tu progreso te espera. ¿Una sesión rápida hoy?',
  'notifications.row.quest_expiry_warning.title':             '⏳ {remaining} misiones por terminar',
  'notifications.row.quest_expiry_warning.body':              'Las misiones se reinician a medianoche. ¡No pierdas las monedas!',
};

const frKeys = {
  'notifications.title':       'Notifications',
  'notifications.markAllRead': 'Tout marquer comme lu',
  'notifications.empty.title': 'Aucune notification',
  'notifications.empty.desc':  'Lorsque vous complétez des quêtes, atteignez des séries ou que vos amis publient, vous le verrez ici.',
  'notifications.showing50':   'Affichage des 50 plus récentes',

  'notifications.row.quest_claimed.title':                    '🪙 +{coins} pièces · {quest}',
  'notifications.row.quest_claimed.body':                     'Récompense de quête réclamée.',

  'notifications.row.streak_milestone.workout.title':         '🔥 Série d\'entraînement : Jour {day} !',
  'notifications.row.streak_milestone.login.title':           '🔥 Série de connexion : Jour {day} !',
  'notifications.row.streak_milestone.body':                  '+{coins} pièces',
  'notifications.row.streak_milestone.body_with_capsule':     '+{coins} pièces + Capsule Élite',

  'notifications.row.league_promoted.title':                  '⬆️ Promu à {tier} !',
  'notifications.row.league_promoted.body':                   '+{coins} pièces',
  'notifications.row.league_promoted.body_with_capsule':      '+{coins} pièces + capsule {capsule}',
  'notifications.row.league_demoted.title':                   '⬇️ Rétrogradé à {tier}',
  'notifications.row.league_demoted.body':                    'Remontez la semaine prochaine !',
  'notifications.row.league_held.title':                      'Position maintenue en {tier}',
  'notifications.row.league_held.body_coins':                 '+{coins} pièces',
  'notifications.row.league_held.body_default':               'Visez la promotion la semaine prochaine.',

  'notifications.row.friend_post.title':                      '{name} a publié',
  'notifications.row.friend_follow.title':                    '{name} vous suit',
  'notifications.row.friend_follow.body':                     'Touchez pour voir son profil.',

  'notifications.row.pr_set.title':                           '🏆 Nouveau record de {label} !',

  'notifications.row.capsule_earned.title':                   '🎁 Capsule {label} obtenue',
  'notifications.row.capsule_earned.body_default':            'Ouvrez-la depuis votre sac.',
  'notifications.row.capsule.label.standard':                 'Standard',
  'notifications.row.capsule.label.premium':                  'Premium',
  'notifications.row.capsule.label.elite':                    'Élite',
  'notifications.row.capsule.label.mystery':                  'Mystère',

  'notifications.row.streak_break_warning.title':             '🔥 Série de {streak} jours en péril',
  'notifications.row.streak_break_warning.body':              'Votre série se termine à minuit. Un entraînement rapide la sauve.',
  'notifications.row.welcome_back.title':                     '👋 Vous nous manquez',
  'notifications.row.welcome_back.body':                      'Vos progrès vous attendent. Une séance rapide aujourd\'hui ?',
  'notifications.row.quest_expiry_warning.title':             '⏳ {remaining} quêtes à terminer',
  'notifications.row.quest_expiry_warning.body':              'Les quêtes se réinitialisent à minuit. Ne perdez pas les pièces !',
};

const deKeys = {
  'notifications.title':       'Benachrichtigungen',
  'notifications.markAllRead': 'Alle als gelesen markieren',
  'notifications.empty.title': 'Noch keine Benachrichtigungen',
  'notifications.empty.desc':  'Wenn du Quests abschließt, Serien erreichst oder deine Freunde posten, siehst du es hier.',
  'notifications.showing50':   'Die 50 neuesten werden angezeigt',

  'notifications.row.quest_claimed.title':                    '🪙 +{coins} Münzen · {quest}',
  'notifications.row.quest_claimed.body':                     'Quest-Belohnung abgeholt.',

  'notifications.row.streak_milestone.workout.title':         '🔥 Trainings-Streak: Tag {day}!',
  'notifications.row.streak_milestone.login.title':           '🔥 Login-Streak: Tag {day}!',
  'notifications.row.streak_milestone.body':                  '+{coins} Münzen',
  'notifications.row.streak_milestone.body_with_capsule':     '+{coins} Münzen + Elite-Kapsel',

  'notifications.row.league_promoted.title':                  '⬆️ Aufgestiegen zu {tier}!',
  'notifications.row.league_promoted.body':                   '+{coins} Münzen',
  'notifications.row.league_promoted.body_with_capsule':      '+{coins} Münzen + {capsule}-Kapsel',
  'notifications.row.league_demoted.title':                   '⬇️ Abgestiegen zu {tier}',
  'notifications.row.league_demoted.body':                    'Nächste Woche zurückklettern!',
  'notifications.row.league_held.title':                      'Position in {tier} gehalten',
  'notifications.row.league_held.body_coins':                 '+{coins} Münzen',
  'notifications.row.league_held.body_default':               'Strebe nächste Woche den Aufstieg an.',

  'notifications.row.friend_post.title':                      '{name} hat gepostet',
  'notifications.row.friend_follow.title':                    '{name} folgt dir jetzt',
  'notifications.row.friend_follow.body':                     'Tippe, um das Profil zu sehen.',

  'notifications.row.pr_set.title':                           '🏆 Neuer {label}-Rekord!',

  'notifications.row.capsule_earned.title':                   '🎁 {label}-Kapsel erhalten',
  'notifications.row.capsule_earned.body_default':            'Öffne sie aus deiner Tasche.',
  'notifications.row.capsule.label.standard':                 'Standard',
  'notifications.row.capsule.label.premium':                  'Premium',
  'notifications.row.capsule.label.elite':                    'Elite',
  'notifications.row.capsule.label.mystery':                  'Mysteriös',

  'notifications.row.streak_break_warning.title':             '🔥 {streak}-Tage-Streak in Gefahr',
  'notifications.row.streak_break_warning.body':              'Dein Streak endet um Mitternacht. Ein schnelles Training rettet ihn.',
  'notifications.row.welcome_back.title':                     '👋 Wir vermissen dich',
  'notifications.row.welcome_back.body':                      'Dein Fortschritt wartet. Heute eine kurze Einheit?',
  'notifications.row.quest_expiry_warning.title':             '⏳ {remaining} Quests offen',
  'notifications.row.quest_expiry_warning.body':              'Quests werden um Mitternacht zurückgesetzt. Hol dir die Münzen!',
};

const ptKeys = {
  'notifications.title':       'Notificações',
  'notifications.markAllRead': 'Marcar tudo como lido',
  'notifications.empty.title': 'Sem notificações ainda',
  'notifications.empty.desc':  'Quando completar missões, manter sequências ou seus amigos postarem, você verá aqui.',
  'notifications.showing50':   'Mostrando as 50 mais recentes',

  'notifications.row.quest_claimed.title':                    '🪙 +{coins} moedas · {quest}',
  'notifications.row.quest_claimed.body':                     'Recompensa da missão coletada.',

  'notifications.row.streak_milestone.workout.title':         '🔥 Sequência de treino: Dia {day}!',
  'notifications.row.streak_milestone.login.title':           '🔥 Sequência de login: Dia {day}!',
  'notifications.row.streak_milestone.body':                  '+{coins} moedas',
  'notifications.row.streak_milestone.body_with_capsule':     '+{coins} moedas + Cápsula Elite',

  'notifications.row.league_promoted.title':                  '⬆️ Promovido para {tier}!',
  'notifications.row.league_promoted.body':                   '+{coins} moedas',
  'notifications.row.league_promoted.body_with_capsule':      '+{coins} moedas + cápsula {capsule}',
  'notifications.row.league_demoted.title':                   '⬇️ Rebaixado para {tier}',
  'notifications.row.league_demoted.body':                    'Suba de novo na próxima semana!',
  'notifications.row.league_held.title':                      'Manteve a posição em {tier}',
  'notifications.row.league_held.body_coins':                 '+{coins} moedas',
  'notifications.row.league_held.body_default':               'Mire na promoção na próxima semana.',

  'notifications.row.friend_post.title':                      '{name} publicou',
  'notifications.row.friend_follow.title':                    '{name} te seguiu',
  'notifications.row.friend_follow.body':                     'Toque para ver o perfil.',

  'notifications.row.pr_set.title':                           '🏆 Novo recorde de {label}!',

  'notifications.row.capsule_earned.title':                   '🎁 Cápsula {label} conquistada',
  'notifications.row.capsule_earned.body_default':            'Abra-a na sua bolsa.',
  'notifications.row.capsule.label.standard':                 'Padrão',
  'notifications.row.capsule.label.premium':                  'Premium',
  'notifications.row.capsule.label.elite':                    'Elite',
  'notifications.row.capsule.label.mystery':                  'Misteriosa',

  'notifications.row.streak_break_warning.title':             '🔥 Sequência de {streak} dias em risco',
  'notifications.row.streak_break_warning.body':              'Sua sequência termina à meia-noite. Um treino rápido a salva.',
  'notifications.row.welcome_back.title':                     '👋 Sentimos sua falta',
  'notifications.row.welcome_back.body':                      'Seu progresso espera. Um treino rápido hoje?',
  'notifications.row.quest_expiry_warning.title':             '⏳ {remaining} missões pendentes',
  'notifications.row.quest_expiry_warning.body':              'As missões reiniciam à meia-noite. Não perca as moedas!',
};

const jaKeys = {
  'notifications.title':       '通知',
  'notifications.markAllRead': 'すべて既読にする',
  'notifications.empty.title': '通知はまだありません',
  'notifications.empty.desc':  'クエスト完了、連続記録、フォロー中のユーザーの投稿があると、ここに表示されます。',
  'notifications.showing50':   '最新の50件を表示',

  'notifications.row.quest_claimed.title':                    '🪙 +{coins}コイン · {quest}',
  'notifications.row.quest_claimed.body':                     'クエスト報酬を受け取りました。',

  'notifications.row.streak_milestone.workout.title':         '🔥 ワークアウト連続: {day}日目！',
  'notifications.row.streak_milestone.login.title':           '🔥 ログイン連続: {day}日目！',
  'notifications.row.streak_milestone.body':                  '+{coins}コイン',
  'notifications.row.streak_milestone.body_with_capsule':     '+{coins}コイン + エリートカプセル',

  'notifications.row.league_promoted.title':                  '⬆️ {tier}に昇格！',
  'notifications.row.league_promoted.body':                   '+{coins}コイン',
  'notifications.row.league_promoted.body_with_capsule':      '+{coins}コイン + {capsule}カプセル',
  'notifications.row.league_demoted.title':                   '⬇️ {tier}に降格',
  'notifications.row.league_demoted.body':                    '来週、また登りましょう！',
  'notifications.row.league_held.title':                      '{tier}で順位維持',
  'notifications.row.league_held.body_coins':                 '+{coins}コイン',
  'notifications.row.league_held.body_default':               '来週は昇格を狙いましょう。',

  'notifications.row.friend_post.title':                      '{name}が投稿しました',
  'notifications.row.friend_follow.title':                    '{name}があなたをフォローしました',
  'notifications.row.friend_follow.body':                     'タップしてプロフィールを見る。',

  'notifications.row.pr_set.title':                           '🏆 {label}の新記録！',

  'notifications.row.capsule_earned.title':                   '🎁 {label}カプセル獲得',
  'notifications.row.capsule_earned.body_default':            'バッグから開封してください。',
  'notifications.row.capsule.label.standard':                 'スタンダード',
  'notifications.row.capsule.label.premium':                  'プレミアム',
  'notifications.row.capsule.label.elite':                    'エリート',
  'notifications.row.capsule.label.mystery':                  'ミステリー',

  'notifications.row.streak_break_warning.title':             '🔥 {streak}日連続記録が危険',
  'notifications.row.streak_break_warning.body':              '深夜にストリークが途切れます。短い運動で維持できます。',
  'notifications.row.welcome_back.title':                     '👋 お久しぶりです',
  'notifications.row.welcome_back.body':                      '進捗が待っています。今日少しだけ運動しませんか？',
  'notifications.row.quest_expiry_warning.title':             '⏳ {remaining}個のクエスト未達成',
  'notifications.row.quest_expiry_warning.body':              '深夜にリセットされます。コインを取り逃さないで！',
};

export const notificationsI18n = {
  en: enKeys,
  es: esKeys,
  fr: frKeys,
  de: deKeys,
  pt: ptKeys,
  ja: jaKeys,
  // Fallback to English for the remaining 9 — partial coverage is safe
  // because notifications.js uses tFallback() semantics: any missing
  // key returns the English template with {placeholder} substitution.
  it: enKeys, ko: enKeys, zh: enKeys, ar: enKeys, hi: enKeys,
  ru: enKeys, tr: enKeys, pl: enKeys, nl: enKeys,
};
