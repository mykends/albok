import hr from '@/locales/hr.json';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ApiError } from './api';

// Croatian only at launch; every UI string lives in locales/hr.json so more languages can be added.
i18n.use(initReactI18next).init({
  lng: 'hr',
  fallbackLng: 'hr',
  resources: { hr: { translation: hr } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;

/** Server messages are already in Croatian; only transport errors need translating. */
export function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 0) return i18n.t('errors.offline');
  return error instanceof Error ? error.message : i18n.t('errors.generic');
}
