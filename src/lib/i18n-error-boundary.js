// src/lib/i18n-error-boundary.js
//
// Translations for the production ErrorBoundary fallback UI. Strings
// shown when a section of the app crashes:
//
//   errorBoundary.title         — headline ("Something went wrong")
//   errorBoundary.desc          — body ("This section failed to load.")
//   errorBoundary.section       — section label sub-line ("Section: {label}")
//   errorBoundary.goHome        — primary recovery (navigates to Dashboard)
//   errorBoundary.tryAgain      — secondary recovery (resets boundary)
//   errorBoundary.copyDetails   — copy stack to clipboard for support
//   errorBoundary.copied        — transient confirmation after Copy
//   errorBoundary.showDetails   — disclosure label for technical details
//   errorBoundary.hideDetails   — (kept for back-compat; current
//                                 component uses <details> open state
//                                 instead of an explicit hide button)
//
// The component uses tFallback semantics, so any missing key in a
// locale falls back to the English string with {placeholder}
// interpolation. Partial coverage is safe.

const enKeys = {
  'errorBoundary.title':        'Something went wrong',
  'errorBoundary.desc':         'This section failed to load.',
  'errorBoundary.section':      'Section: {label}',
  'errorBoundary.goHome':       'Go to Home',
  'errorBoundary.tryAgain':     'Try again',
  'errorBoundary.copyDetails':  'Copy details',
  'errorBoundary.copied':       'Copied!',
  'errorBoundary.showDetails':  'Show details',
  'errorBoundary.hideDetails':  'Hide details',
};

const esKeys = {
  'errorBoundary.title':        'Algo salió mal',
  'errorBoundary.desc':         'Esta sección no se pudo cargar.',
  'errorBoundary.section':      'Sección: {label}',
  'errorBoundary.goHome':       'Ir al Inicio',
  'errorBoundary.tryAgain':     'Intentar de nuevo',
  'errorBoundary.copyDetails':  'Copiar detalles',
  'errorBoundary.copied':       '¡Copiado!',
  'errorBoundary.showDetails':  'Mostrar detalles',
  'errorBoundary.hideDetails':  'Ocultar detalles',
};

const frKeys = {
  'errorBoundary.title':        'Une erreur est survenue',
  'errorBoundary.desc':         "Cette section n'a pas pu se charger.",
  'errorBoundary.section':      'Section : {label}',
  'errorBoundary.goHome':       "Aller à l'accueil",
  'errorBoundary.tryAgain':     'Réessayer',
  'errorBoundary.copyDetails':  'Copier les détails',
  'errorBoundary.copied':       'Copié !',
  'errorBoundary.showDetails':  'Afficher les détails',
  'errorBoundary.hideDetails':  'Masquer les détails',
};

const deKeys = {
  'errorBoundary.title':        'Etwas ist schiefgelaufen',
  'errorBoundary.desc':         'Dieser Bereich konnte nicht geladen werden.',
  'errorBoundary.section':      'Bereich: {label}',
  'errorBoundary.goHome':       'Zur Startseite',
  'errorBoundary.tryAgain':     'Erneut versuchen',
  'errorBoundary.copyDetails':  'Details kopieren',
  'errorBoundary.copied':       'Kopiert!',
  'errorBoundary.showDetails':  'Details anzeigen',
  'errorBoundary.hideDetails':  'Details ausblenden',
};

const ptKeys = {
  'errorBoundary.title':        'Algo deu errado',
  'errorBoundary.desc':         'Esta seção não pôde ser carregada.',
  'errorBoundary.section':      'Seção: {label}',
  'errorBoundary.goHome':       'Ir para Início',
  'errorBoundary.tryAgain':     'Tentar novamente',
  'errorBoundary.copyDetails':  'Copiar detalhes',
  'errorBoundary.copied':       'Copiado!',
  'errorBoundary.showDetails':  'Mostrar detalhes',
  'errorBoundary.hideDetails':  'Ocultar detalhes',
};

const itKeys = {
  'errorBoundary.title':        'Qualcosa è andato storto',
  'errorBoundary.desc':         'Impossibile caricare questa sezione.',
  'errorBoundary.section':      'Sezione: {label}',
  'errorBoundary.goHome':       'Vai alla Home',
  'errorBoundary.tryAgain':     'Riprova',
  'errorBoundary.copyDetails':  'Copia dettagli',
  'errorBoundary.copied':       'Copiato!',
  'errorBoundary.showDetails':  'Mostra dettagli',
  'errorBoundary.hideDetails':  'Nascondi dettagli',
};

const jaKeys = {
  'errorBoundary.title':        '問題が発生しました',
  'errorBoundary.desc':         'このセクションを読み込めませんでした。',
  'errorBoundary.section':      'セクション: {label}',
  'errorBoundary.goHome':       'ホームへ',
  'errorBoundary.tryAgain':     'もう一度試す',
  'errorBoundary.copyDetails':  '詳細をコピー',
  'errorBoundary.copied':       'コピーしました',
  'errorBoundary.showDetails':  '詳細を表示',
  'errorBoundary.hideDetails':  '詳細を非表示',
};

const koKeys = {
  'errorBoundary.title':        '문제가 발생했습니다',
  'errorBoundary.desc':         '이 섹션을 불러올 수 없습니다.',
  'errorBoundary.section':      '섹션: {label}',
  'errorBoundary.goHome':       '홈으로 이동',
  'errorBoundary.tryAgain':     '다시 시도',
  'errorBoundary.copyDetails':  '세부 정보 복사',
  'errorBoundary.copied':       '복사됨!',
  'errorBoundary.showDetails':  '자세히 보기',
  'errorBoundary.hideDetails':  '자세히 숨기기',
};

const zhKeys = {
  'errorBoundary.title':        '出错了',
  'errorBoundary.desc':         '此部分加载失败。',
  'errorBoundary.section':      '部分：{label}',
  'errorBoundary.goHome':       '返回首页',
  'errorBoundary.tryAgain':     '重试',
  'errorBoundary.copyDetails':  '复制详细信息',
  'errorBoundary.copied':       '已复制！',
  'errorBoundary.showDetails':  '显示详细信息',
  'errorBoundary.hideDetails':  '隐藏详细信息',
};

const arKeys = {
  'errorBoundary.title':        'حدث خطأ ما',
  'errorBoundary.desc':         'تعذّر تحميل هذا القسم.',
  'errorBoundary.section':      'القسم: {label}',
  'errorBoundary.goHome':       'العودة إلى الصفحة الرئيسية',
  'errorBoundary.tryAgain':     'إعادة المحاولة',
  'errorBoundary.copyDetails':  'نسخ التفاصيل',
  'errorBoundary.copied':       'تم النسخ!',
  'errorBoundary.showDetails':  'عرض التفاصيل',
  'errorBoundary.hideDetails':  'إخفاء التفاصيل',
};

const hiKeys = {
  'errorBoundary.title':        'कुछ गलत हो गया',
  'errorBoundary.desc':         'यह सेक्शन लोड नहीं हो सका।',
  'errorBoundary.section':      'सेक्शन: {label}',
  'errorBoundary.goHome':       'होम पर जाएँ',
  'errorBoundary.tryAgain':     'फिर से कोशिश करें',
  'errorBoundary.copyDetails':  'विवरण कॉपी करें',
  'errorBoundary.copied':       'कॉपी हो गया!',
  'errorBoundary.showDetails':  'विवरण दिखाएँ',
  'errorBoundary.hideDetails':  'विवरण छिपाएँ',
};

const ruKeys = {
  'errorBoundary.title':        'Что-то пошло не так',
  'errorBoundary.desc':         'Не удалось загрузить этот раздел.',
  'errorBoundary.section':      'Раздел: {label}',
  'errorBoundary.goHome':       'На главную',
  'errorBoundary.tryAgain':     'Повторить',
  'errorBoundary.copyDetails':  'Копировать подробности',
  'errorBoundary.copied':       'Скопировано!',
  'errorBoundary.showDetails':  'Показать подробности',
  'errorBoundary.hideDetails':  'Скрыть подробности',
};

const trKeys = {
  'errorBoundary.title':        'Bir şeyler ters gitti',
  'errorBoundary.desc':         'Bu bölüm yüklenemedi.',
  'errorBoundary.section':      'Bölüm: {label}',
  'errorBoundary.goHome':       'Ana Sayfaya Git',
  'errorBoundary.tryAgain':     'Tekrar dene',
  'errorBoundary.copyDetails':  'Ayrıntıları kopyala',
  'errorBoundary.copied':       'Kopyalandı!',
  'errorBoundary.showDetails':  'Ayrıntıları göster',
  'errorBoundary.hideDetails':  'Ayrıntıları gizle',
};

const plKeys = {
  'errorBoundary.title':        'Coś poszło nie tak',
  'errorBoundary.desc':         'Nie udało się załadować tej sekcji.',
  'errorBoundary.section':      'Sekcja: {label}',
  'errorBoundary.goHome':       'Strona główna',
  'errorBoundary.tryAgain':     'Spróbuj ponownie',
  'errorBoundary.copyDetails':  'Kopiuj szczegóły',
  'errorBoundary.copied':       'Skopiowano!',
  'errorBoundary.showDetails':  'Pokaż szczegóły',
  'errorBoundary.hideDetails':  'Ukryj szczegóły',
};

const nlKeys = {
  'errorBoundary.title':        'Er ging iets mis',
  'errorBoundary.desc':         'Dit gedeelte kon niet worden geladen.',
  'errorBoundary.section':      'Gedeelte: {label}',
  'errorBoundary.goHome':       'Naar Home',
  'errorBoundary.tryAgain':     'Opnieuw proberen',
  'errorBoundary.copyDetails':  'Details kopiëren',
  'errorBoundary.copied':       'Gekopieerd!',
  'errorBoundary.showDetails':  'Details tonen',
  'errorBoundary.hideDetails':  'Details verbergen',
};

export const errorBoundaryI18n = {
  en: enKeys, es: esKeys, fr: frKeys, de: deKeys, pt: ptKeys,
  it: itKeys, ja: jaKeys, ko: koKeys, zh: zhKeys, ar: arKeys,
  hi: hiKeys, ru: ruKeys, tr: trKeys, pl: plKeys, nl: nlKeys,
};
