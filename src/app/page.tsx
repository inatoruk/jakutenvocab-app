"use client";

import { useState, useEffect } from "react";
import InputView from "@/components/InputView";
import ReviewView from "@/components/ReviewView";
import WordListView from "@/components/WordListView";
import SettingsModal from "@/components/SettingsModal";
import { PenLine, BookOpen, List, Settings } from "lucide-react";
import { AppSettings, loadSettings, saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";

type Tab = "input" | "review" | "list";

export default function Home() {
  const [tab, setTab] = useState<Tab>("input");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // localStorage から設定を読み込む（クライアントサイドのみ）
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  // 設定変更時: 保存 + ズーム/テーマを即時適用
  useEffect(() => {
    saveSettings(settings);
    applyZoom(settings.zoom);
    applyTheme(settings.theme);
  }, [settings]);

  function applyZoom(zoom: number) {
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      document.body.style.zoom = String(zoom);
      document.documentElement.style.zoom = "";
    } else {
      document.documentElement.style.zoom = String(zoom);
      document.body.style.zoom = "";
    }
  }

  function applyTheme(theme: AppSettings["theme"]) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function handleTabChange(next: Tab) {
    window.scrollTo(0, 0);
    setTab(next);
  }

  function handleSettingsChange(next: AppSettings) {
    setSettings(next);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="relative flex items-center justify-center">
          <h1 className="text-center text-lg font-bold text-gray-800">
            弱点単語集
          </h1>
          <button
            id="settings-button"
            onClick={() => setShowSettings(true)}
            aria-label="設定を開く"
            className="absolute right-0 rounded-full p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 py-6">
        <div style={{ display: tab === "input" ? "block" : "none" }}>
          <InputView />
        </div>
        <div style={{ display: tab === "list" ? "block" : "none" }}>
          <WordListView active={tab === "list"} />
        </div>
        <div style={{ display: tab === "review" ? "block" : "none" }}>
          <ReviewView
            active={tab === "review"}
            settings={settings}
          />
        </div>
      </main>

      {/* タブナビゲーション */}
      <nav className="bg-white border-t border-gray-200 sticky bottom-0">
        <div className="mx-auto max-w-lg flex">
          <button
            onClick={() => handleTabChange("input")}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${tab === "input"
              ? "text-blue-600"
              : "text-gray-400 hover:text-gray-600"
              }`}
          >
            <PenLine size={20} />
            登録
          </button>
          <button
            onClick={() => handleTabChange("list")}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${tab === "list"
              ? "text-blue-600"
              : "text-gray-400 hover:text-gray-600"
              }`}
          >
            <List size={20} />
            一覧
          </button>
          <button
            onClick={() => handleTabChange("review")}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${tab === "review"
              ? "text-blue-600"
              : "text-gray-400 hover:text-gray-600"
              }`}
          >
            <BookOpen size={20} />
            復習
          </button>
        </div>
      </nav>

      {/* 設定モーダル */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
