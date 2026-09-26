import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;

// Registered before init() — detection can resolve the language
// synchronously, which would otherwise fire this event before a
// listener attached afterwards could catch it.
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, fr: { translation: fr } },
    supportedLngs: SUPPORTED_LANGUAGES,
    fallbackLng: 'en',
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
    interpolation: { escapeValue: false },
  });

export default i18n;
