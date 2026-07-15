
export type ReviewOrder = "random" | "newest" | "oldest";
export type ReviewCount = 10 | 20 | 50 | 9999;
export type ThemeMode = "light" | "dark";

export interface AppSettings {
  theme: ThemeMode;
  autoSpeak: boolean;
  reviewCount: ReviewCount;
  reviewOrder: ReviewOrder;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  autoSpeak: true,
  reviewCount: 20,
  reviewOrder: "random",
};

const STORAGE_KEY = "toeic-app-settings";

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
