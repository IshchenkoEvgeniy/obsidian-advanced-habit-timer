import { en } from './i18n/locales/en';
import { ru } from './i18n/locales/ru';

export const TRANSLATIONS = {
    en,
    ru
};

export type Language = keyof typeof TRANSLATIONS;
export type TranslationKey = keyof typeof TRANSLATIONS['en'];

export function t(lang: Language, key: TranslationKey, ...args: unknown[]): string {
    let translation = TRANSLATIONS[lang][key] || TRANSLATIONS.en[key] || key;
    args.forEach((arg, i) => {
        translation = translation.replace(`{${i}}`, String(arg));
    });
    return translation;
}
