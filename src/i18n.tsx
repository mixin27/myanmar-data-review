import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import myanmar from "./locales/my.json";
const messages: Record<string, string> = myanmar;
type Language = "en" | "my";
const LanguageContext = createContext({
  language: "en" as Language,
  setLanguage: (value: Language) => {
    void value;
  },
  t: (text: string) => text,
});
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const t = (text: string) => {
    if (language === "en") return text;
    const translation = messages[text.trim()];
    return translation === undefined
      ? text
      : text.replace(text.trim(), translation);
  };
  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
export const useI18n = () => useContext(LanguageContext);
export function LanguagePicker() {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className="language-picker">
      {t("Language")}
      <select
        aria-label="Language / ဘာသာစကား"
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
      >
        <option value="en">English</option>
        <option value="my">မြန်မာ</option>
      </select>
    </label>
  );
}
