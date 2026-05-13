// src/lib/i18n-error-boundary.js
//
// Translations for the production ErrorBoundary fallback UI. Six short
// strings shown when a section of the app crashes:
//
//   errorBoundary.title         — headline ("Something went wrong")
//   errorBoundary.desc          — body ("This section failed to load…")
//   errorBoundary.section       — section label sub-line ("Section: {label}")
//   errorBoundary.tryAgain      — primary action
//   errorBoundary.showDetails   — toggle to reveal stack
//   errorBoundary.hideDetails   — toggle to hide stack
//
// The component uses tFallback semantics, so any missing key in a
// locale falls back to the English string with {placeholder}
// interpolation. Partial coverage is safe.

const enKeys = {
  'errorBoundary.title':        'Something went wrong',
  'errorBoundary.desc':         'This section failed to load. Try refreshing the page.',
  'errorBoundary.section':      'Section: {label}',
  'errorBoundary.tryAgain':     'Try again',
  'errorBoundary.showDetails':  'Show details',
  'errorBoundary.hideDetails':  'Hide details',
};

const esKeys = {
  'errorBoundary.title':        'Algo salió mal',
  'errorBoundary.desc':         'Esta sección no se pudo cargar. Intenta actualizar la página.',
  'errorBoundary.section':      'Sección: {label}',
  'errorBoundary.tryAgain':     'Intentar de nuevo',
  'errorBoundary.showDetails':  'Mostrar detalles',
  'errorBoundary.hideDetails':  'Ocultar detalles',
};

const frKeys = {
  'errorBoundary.title':        'Une erreur est survenue',
  'errorBoundary.desc':         'Cette section n\'a pas pu se charger. Essayez de rafraîchir la page.',
  'errorBoundary.section':      'Section : {label}',
  'errorBoundary.tryAgain':     'Réessayer',
  'errorBoundary.showDetails':  'Afficher les détails',
  'errorBoundary.hideDetails':  'Masquer les détails',
};

const deKeys = {
  'errorBoundary.title':        'Etwas ist schiefgelaufen',
  'errorBoundary.desc':         'Dieser Bereich konnte nicht geladen werden. Versuche, die Seite neu zu laden.',
  'errorBoundary.section':      'Bereich: {label}',
  'errorBoundary.tryAgain':     'Erneut versuchen',
  'errorBoundary.showDetails':  'Details anzeigen',
  'errorBoundary.hideDetails':  'Details ausblenden',
};

const ptKeys = {
  'errorBoundary.title':        'Algo deu errado',
  'errorBoundary.desc':         'Esta seção não pôde ser carregada. Tente atualizar a página.',
  'errorBoundary.section':      'Seção: {label}',
  'errorBoundary.tryAgain':     'Tentar novamente',
  'errorBoundary.showDetails':  'Mostrar detalhes',
  'errorBoundary.hideDetails':  'Ocultar detalhes',
};

const itKeys = {
  'errorBoundary.title':        'Qualcosa è andato storto',
  'errorBoundary.desc':         'Impossibile caricare questa sezione. Prova ad aggiornare la pagina.',
  'errorBoundary.section':      'Sezione: {label}',
  'errorBoundary.tryAgain':     'Riprova',
  'errorBoundary.showDetails':  'Mostra dettagli',
  'errorBoundary.hideDetails':  'Nascondi dettagli',
};

const jaKeys = {
  'errorBoundary.title':        '問題が発生しました',
  'errorBoundary.desc':         'このセクションを読み込めませんでした。ページを更新してみてください。',
  'errorBoundary.section':      'セクション: {label}',
  'errorBoundary.tryAgain':     'もう一度試す',
  'errorBoundary.showDetails':  '詳細を表示',
  'errorBoundary.hideDetails':  '詳細を非表示',
};

const koKeys = {
  'errorBoundary.title':        '문제가 발생했습니다',
  'errorBoundary.desc':         '이 섹션을 불러올 수 없습니다. 페이지를 새로 고쳐 보세요.',
  'errorBoundary.section':      '섹션: {label}',
  'errorBoundary.tryAgain':     '다시 시도',
  'errorBoundary.showDetails':  '자세히 보기',
  'errorBoundary.hideDetails':  '자세히 숨기기',
};

const zhKeys = {
  'errorBoundary.title':        '出错了',
  'errorBoundary.desc':         '此部分加载失败。请尝试刷新页面。',
  'errorBoundary.section':      '部分：{label}',
  'errorBoundary.tryAgain':     '重试',
  'errorBoundary.showDetails':  '显示详细信息',
  'errorBoundary.hideDetails':  '隐藏详细信息',
};

const arKeys = {
  'errorBoundary.title':        'حدث خطأ ما',
  'errorBoundary.desc':         'تعذّر تحميل هذا القسم. حاول تحديث الصفحة.',
  'errorBoundary.section':      'القسم: {label}',
  'errorBoundary.tryAgain':     'إعادة المحاولة',
  'errorBoundary.showDetails':  'عرض التفاصيل',
  'errorBoundary.hideDetails':  'إخفاء التفاصيل',
};

const hiKeys = {
  'errorBoundary.title':        'कुछ गलत हो गया',
  'errorBoundary.desc':         'यह सेक्शन लोड नहीं हो सका। पेज को रिफ़्रेश करके देखें।',
  'errorBoundary.section':      'सेक्शन: {label}',
  'errorBoundary.tryAgain':     'फिर से कोशिश करें',
  'errorBoundary.showDetails':  'विवरण दिखाएँ',
  'errorBoundary.hideDetails':  'विवरण छिपाएँ',
};

const ruKeys = {
  'errorBoundary.title':        'Что-то пошло не так',
  'errorBoundary.desc':         'Не удалось загрузить этот раздел. Попробуйте обновить страницу.',
  'errorBoundary.section':      'Раздел: {label}',
  'errorBoundary.tryAgain':     'Повторить',
  'errorBoundary.showDetails':  'Показать подробности',
  'errorBoundary.hideDetails':  'Скрыть подробности',
};

const trKeys = {
  'errorBoundary.title':        'Bir şeyler ters gitti',
  'errorBoundary.desc':         'Bu bölüm yüklenemedi. Sayfayı yenilemeyi dene.',
  'errorBoundary.section':      'Bölüm: {label}',
  'errorBoundary.tryAgain':     'Tekrar dene',
  'errorBoundary.showDetails':  'Ayrıntıları göster',
  'errorBoundary.hideDetails':  'Ayrıntıları gizle',
};

const plKeys = {
  'errorBoundary.title':        'Coś poszło nie tak',
  'errorBoundary.desc':         'Nie udało się załadować tej sekcji. Spróbuj odświeżyć stronę.',
  'errorBoundary.section':      'Sekcja: {label}',
  'errorBoundary.tryAgain':     'Spróbuj ponownie',
  'errorBoundary.showDetails':  'Pokaż szczegóły',
  'errorBoundary.hideDetails':  'Ukryj szczegóły',
};

const nlKeys = {
  'errorBoundary.title':        'Er ging iets mis',
  'errorBoundary.desc':         'Dit gedeelte kon niet worden geladen. Probeer de pagina te vernieuwen.',
  'errorBoundary.section':      'Gedeelte: {label}',
  'errorBoundary.tryAgain':     'Opnieuw proberen',
  'errorBoundary.showDetails':  'Details tonen',
  'errorBoundary.hideDetails':  'Details verbergen',
};

export const errorBoundaryI18n = {
  en: enKeys, es: esKeys, fr: frKeys, de: deKeys, pt: ptKeys,
  it: itKeys, ja: jaKeys, ko: koKeys, zh: zhKeys, ar: arKeys,
  hi: hiKeys, ru: ruKeys, tr: trKeys, pl: plKeys, nl: nlKeys,
};
