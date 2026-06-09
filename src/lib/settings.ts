export type ZoomLevel = 1 | 1.25 | 1.5 | 1.75 | 2;
export type ReviewOrder = "random" | "newest" | "oldest";
export type ReviewCount = 10 | 20 | 50 | 9999;
export type ThemeMode = "light" | "dark" | "system";

export interface AppSettings {
  zoom: ZoomLevel;
  theme: ThemeMode;
  autoSpeak: boolean;
  reviewCount: ReviewCount;
  reviewOrder: ReviewOrder;
}

export const DEFAULT_SETTINGS: AppSettings = {
  zoom: 1.5,
  theme: "system",
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
