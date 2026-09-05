import { enLocale } from "./messages/en";
import { zhCNLocale } from "./messages/zh-CN";
import type { Locale, LocalePlugin } from "./types";

const localePlugins = new Map<Locale, LocalePlugin>();

export function registerLocale(plugin: LocalePlugin): void {
  if (!plugin.id.trim()) throw new Error("Locale id must not be empty");
  if (localePlugins.has(plugin.id)) throw new Error(`Locale already registered: ${plugin.id}`);
  localePlugins.set(plugin.id, plugin);
}

export function getLocalePlugin(id: string): LocalePlugin | undefined {
  return localePlugins.get(id as Locale);
}

export function getSupportedLocales(): Locale[] {
  return [...localePlugins.keys()];
}

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "zh-CN";
}

export function resolveBrowserLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
    if (normalized === "zh" || normalized === "zh-cn" || normalized.startsWith("zh-cn-")
      || normalized === "zh-sg" || normalized.startsWith("zh-sg-")
      || normalized === "zh-hans" || normalized.startsWith("zh-hans-")) return "zh-CN";
    if (normalized === "zh-tw" || normalized.startsWith("zh-tw-")
      || normalized === "zh-hk" || normalized.startsWith("zh-hk-")
      || normalized === "zh-mo" || normalized.startsWith("zh-mo-")
      || normalized === "zh-hant" || normalized.startsWith("zh-hant-")) return "zh-CN";
    if (normalized.startsWith("zh-")) return "zh-CN";
  }
  return "en";
}

// 内置语言随模块加载自注册（fork 双语架构）。
registerLocale(enLocale);
registerLocale(zhCNLocale);
