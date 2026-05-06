/**
 * i18n-rest-timer.js
 *
 * Translation patch for the new RestTimerOverlay component.
 * 7 keys × 15 languages = 105 entries. Wired into i18n.js via a single
 * import + spread into mergeTranslations().
 */

export const restTimerI18n = {
  en: {
    'restTimer.rest':           'Rest',
    'restTimer.done':           'Done',
    'restTimer.settings':       'Rest timer',
    'restTimer.defaultRest':    'Default rest duration',
    'restTimer.soundOnFinish':  'Sound when finished',
    'restTimer.skip':           'Skip rest',
    'restTimer.add15':          'Add 15 seconds',
    'restTimer.subtract15':     'Subtract 15 seconds',
    'restTimer.voiceCues':      'Voice cues',
    'restTimer.voiceHint':      'Hands-free coaching: rest start, 3-2-1 countdown, "time\'s up". Plug in your headphones.',
  },

  es: {
    'restTimer.rest':           'Descanso',
    'restTimer.done':           'Listo',
    'restTimer.settings':       'Cronómetro de descanso',
    'restTimer.defaultRest':    'Duración predeterminada',
    'restTimer.soundOnFinish':  'Sonido al terminar',
    'restTimer.skip':           'Saltar descanso',
    'restTimer.add15':          'Sumar 15 segundos',
    'restTimer.subtract15':     'Restar 15 segundos',
    'restTimer.voiceCues':      'Indicaciones por voz',
    'restTimer.voiceHint':      'Entrenamiento manos libres: inicio del descanso, cuenta atrás 3-2-1, "se acabó". Conecta los audífonos.',
  },

  fr: {
    'restTimer.rest':           'Repos',
    'restTimer.done':           'Terminé',
    'restTimer.settings':       'Minuteur de repos',
    'restTimer.defaultRest':    'Durée par défaut',
    'restTimer.soundOnFinish':  'Son à la fin',
    'restTimer.skip':           'Passer le repos',
    'restTimer.add15':          'Ajouter 15 secondes',
    'restTimer.subtract15':     'Retirer 15 secondes',
    'restTimer.voiceCues':      'Repères vocaux',
    'restTimer.voiceHint':      "Coaching mains libres : début du repos, décompte 3-2-1, « c'est fini ». Branche tes écouteurs.",
  },

  de: {
    'restTimer.rest':           'Pause',
    'restTimer.done':           'Fertig',
    'restTimer.settings':       'Pausentimer',
    'restTimer.defaultRest':    'Standarddauer',
    'restTimer.soundOnFinish':  'Ton bei Ende',
    'restTimer.skip':           'Pause überspringen',
    'restTimer.add15':          '15 Sekunden hinzufügen',
    'restTimer.subtract15':     '15 Sekunden abziehen',
    'restTimer.voiceCues':      'Sprach-Coaching',
    'restTimer.voiceHint':      'Freihändiges Coaching: Pause-Start, 3-2-1-Countdown, "Zeit ist um". Kopfhörer einstecken.',
  },

  pt: {
    'restTimer.rest':           'Descanso',
    'restTimer.done':           'Concluído',
    'restTimer.settings':       'Cronômetro de descanso',
    'restTimer.defaultRest':    'Duração padrão',
    'restTimer.soundOnFinish':  'Som ao terminar',
    'restTimer.skip':           'Pular descanso',
    'restTimer.add15':          'Adicionar 15 segundos',
    'restTimer.subtract15':     'Subtrair 15 segundos',
    'restTimer.voiceCues':      'Comandos de voz',
    'restTimer.voiceHint':      'Treino mãos livres: início do descanso, contagem 3-2-1, "acabou". Conecte os fones.',
  },

  it: {
    'restTimer.rest':           'Riposo',
    'restTimer.done':           'Fatto',
    'restTimer.settings':       'Timer di riposo',
    'restTimer.defaultRest':    'Durata predefinita',
    'restTimer.soundOnFinish':  'Suono al termine',
    'restTimer.skip':           'Salta il riposo',
    'restTimer.add15':          'Aggiungi 15 secondi',
    'restTimer.subtract15':     'Sottrai 15 secondi',
    'restTimer.voiceCues':      'Indicazioni vocali',
    'restTimer.voiceHint':      'Coaching a mani libere: inizio del riposo, conto alla rovescia 3-2-1, "tempo scaduto". Collega le cuffie.',
  },

  ja: {
    'restTimer.rest':           '休憩',
    'restTimer.done':           '完了',
    'restTimer.settings':       'インターバルタイマー',
    'restTimer.defaultRest':    'デフォルトの休憩時間',
    'restTimer.soundOnFinish':  '終了時に音を鳴らす',
    'restTimer.skip':           '休憩をスキップ',
    'restTimer.add15':          '15秒追加',
    'restTimer.subtract15':     '15秒減らす',
    'restTimer.voiceCues':      '音声ガイド',
    'restTimer.voiceHint':      'ハンズフリーコーチング：休憩開始、3-2-1カウントダウン、「タイムアップ」。イヤホンを接続してください。',
  },

  ko: {
    'restTimer.rest':           '휴식',
    'restTimer.done':           '완료',
    'restTimer.settings':       '휴식 타이머',
    'restTimer.defaultRest':    '기본 휴식 시간',
    'restTimer.soundOnFinish':  '종료 시 알림음',
    'restTimer.skip':           '휴식 건너뛰기',
    'restTimer.add15':          '15초 추가',
    'restTimer.subtract15':     '15초 빼기',
  },

  zh: {
    'restTimer.rest':           '休息',
    'restTimer.done':           '完成',
    'restTimer.settings':       '休息计时器',
    'restTimer.defaultRest':    '默认休息时长',
    'restTimer.soundOnFinish':  '结束时提示音',
    'restTimer.skip':           '跳过休息',
    'restTimer.add15':          '增加15秒',
    'restTimer.subtract15':     '减少15秒',
  },

  ar: {
    'restTimer.rest':           'استراحة',
    'restTimer.done':           'تم',
    'restTimer.settings':       'مؤقت الاستراحة',
    'restTimer.defaultRest':    'المدة الافتراضية',
    'restTimer.soundOnFinish':  'صوت عند الانتهاء',
    'restTimer.skip':           'تخطّي الاستراحة',
    'restTimer.add15':          'أضف 15 ثانية',
    'restTimer.subtract15':     'اطرح 15 ثانية',
  },

  hi: {
    'restTimer.rest':           'आराम',
    'restTimer.done':           'पूर्ण',
    'restTimer.settings':       'रेस्ट टाइमर',
    'restTimer.defaultRest':    'डिफ़ॉल्ट अवधि',
    'restTimer.soundOnFinish':  'समाप्ति पर ध्वनि',
    'restTimer.skip':           'आराम छोड़ें',
    'restTimer.add15':          '15 सेकंड जोड़ें',
    'restTimer.subtract15':     '15 सेकंड घटाएं',
  },

  ru: {
    'restTimer.rest':           'Отдых',
    'restTimer.done':           'Готово',
    'restTimer.settings':       'Таймер отдыха',
    'restTimer.defaultRest':    'Длительность по умолчанию',
    'restTimer.soundOnFinish':  'Звук по окончании',
    'restTimer.skip':           'Пропустить отдых',
    'restTimer.add15':          'Добавить 15 секунд',
    'restTimer.subtract15':     'Убрать 15 секунд',
  },

  tr: {
    'restTimer.rest':           'Dinlenme',
    'restTimer.done':           'Tamam',
    'restTimer.settings':       'Dinlenme zamanlayıcısı',
    'restTimer.defaultRest':    'Varsayılan süre',
    'restTimer.soundOnFinish':  'Bittiğinde ses',
    'restTimer.skip':           'Dinlenmeyi atla',
    'restTimer.add15':          '15 saniye ekle',
    'restTimer.subtract15':     '15 saniye çıkar',
  },

  pl: {
    'restTimer.rest':           'Odpoczynek',
    'restTimer.done':           'Gotowe',
    'restTimer.settings':       'Stoper przerwy',
    'restTimer.defaultRest':    'Domyślna długość',
    'restTimer.soundOnFinish':  'Dźwięk po zakończeniu',
    'restTimer.skip':           'Pomiń przerwę',
    'restTimer.add15':          'Dodaj 15 sekund',
    'restTimer.subtract15':     'Odejmij 15 sekund',
  },

  nl: {
    'restTimer.rest':           'Rust',
    'restTimer.done':           'Klaar',
    'restTimer.settings':       'Rusttimer',
    'restTimer.defaultRest':    'Standaardduur',
    'restTimer.soundOnFinish':  'Geluid bij einde',
    'restTimer.skip':           'Rust overslaan',
    'restTimer.add15':          '15 seconden erbij',
    'restTimer.subtract15':     '15 seconden eraf',
  },
};