"use client";

import { useState, useEffect } from "react";
import InputView from "@/components/InputView";
import ReviewView from "@/components/ReviewView";
import WordListView from "@/components/WordListView";
import SettingsModal from "@/components/SettingsModal";
import LoginView from "@/components/LoginView";
import { PenLine, BookOpen, List, Settings } from "lucide-react";
import { AppSettings, loadSettings, saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { supabase } from "@/lib/supabase";
import { User } from "@supabase/supabase-js";

type Tab = "input" | "review" | "list";

export default function Home() {
  const [tab, setTab] = useState<Tab>("input");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [vocabVersion, setVocabVersion] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // 認証状態の監視
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  function handleVocabMutated() {
    setVocabVersion((v) => v + 1);
  }

  // localStorage から設定を読み込む（クライアントサイドのみ）
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  // 設定変更時: 保存 + テーマを即時適用
  useEffect(() => {
    saveSettings(settings);
    applyTheme(settings.theme);
  }, [settings]);

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

  if (loading) {
    return (
      <div className="h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  return (
    <div className="h-dvh flex flex-col">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 shrink-0 z-40">
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
      <main className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {/* 登録/一覧タブのコンテンツ (非表示時は完全に計算から除外) */}
        <div style={{ display: tab !== "review" ? "block" : "none" }}>
          <div className="mx-auto w-full max-w-2xl px-4 py-5">
            <div style={{ display: tab === "input" ? "block" : "none" }}>
              <InputView onAdded={handleVocabMutated} />
            </div>
            <div style={{ display: tab === "list" ? "block" : "none" }}>
              <WordListView active={tab === "list"} onMutated={handleVocabMutated} />
            </div>
          </div>
        </div>

        {/* 復習タブのコンテンツ (表示時のみ flex になり、高さを確保) */}
        <div 
          style={{ display: tab === "review" ? "flex" : "none" }} 
          className="flex-1 flex-col mx-auto w-full max-w-2xl px-4 py-5"
        >
          <ReviewView
            active={tab === "review"}
            settings={settings}
            vocabVersion={vocabVersion}
          />
        </div>
      </main>

      {/* タブナビゲーション */}
      <nav className="bg-white border-t border-gray-200 shrink-0 z-40">
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
          user={user}
        />
      )}
    </div>
  );
}
