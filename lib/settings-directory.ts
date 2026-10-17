export interface SettingsDirectoryItem {
  id: string;
  labelKey: string;
}

export const SETTINGS_DIRECTORY_GROUPS = [
  { id: "basics", labelKey: "desktop.settingsGroupBasics", ids: ["server", "display", "ui-kit", "chat"] },
  { id: "agent", labelKey: "desktop.settingsGroupAgent", ids: ["models", "skills", "plugins"] },
  { id: "application", labelKey: "desktop.settingsGroupApplication", ids: ["proxy", "features", "logs", "snippets", "usage"] },
  { id: "tools", labelKey: "desktop.settingsGroupTools", ids: ["mcp", "subagents", "tools"] },
  { id: "data", labelKey: "desktop.settingsGroupData", ids: ["backup", "import"] },
] as const;

/** Filter the directory labels, never the mounted settings content or its state. */
export function groupSettingsDirectory<T extends SettingsDirectoryItem>(
  tabs: readonly T[],
  query: string,
  translate: (key: string) => string,
): { id: string; labelKey: string; tabs: T[] }[] {
  const needle = query.trim().toLocaleLowerCase();
  return SETTINGS_DIRECTORY_GROUPS.map((group) => ({
    id: group.id,
    labelKey: group.labelKey,
    tabs: group.ids.flatMap((id) => {
      const tab = tabs.find((item) => item.id === id);
      return tab && (!needle || translate(tab.labelKey).toLocaleLowerCase().includes(needle)) ? [tab] : [];
    }),
  })).filter((group) => group.tabs.length > 0);
}
