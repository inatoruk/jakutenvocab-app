"use client";

import { X, ZoomIn, Moon, Volume2, Hash, Shuffle, Download, Upload, Trash2, Sun, Monitor } from "lucide-react";
import {
  AppSettings,
  ZoomLevel,
  ThemeMode,
  ReviewOrder,
  ReviewCount,
} from "@/lib/settings";
import { supabase } from "@/lib/supabase";

interface Props {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onClose: () => void;
}

const ZOOM_OPTIONS: { value: ZoomLevel; label: string }[] = [
  { value: 1, label: "100%" },
  { value: 1.25, label: "125%" },
  { value: 1.5, label: "150%" },
  { value: 1.75, label: "175%" },
  { value: 2, label: "200%" },
];

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "ライト", icon: <Sun size={14} /> },
  { value: "dark", label: "ダーク", icon: <Moon size={14} /> },
  { value: "system", label: "自動", icon: <Monitor size={14} /> },
];

const COUNT_OPTIONS: { value: ReviewCount; label: string }[] = [
  { value: 10, label: "10問" },
  { value: 20, label: "20問" },
  { value: 50, label: "50問" },
  { value: 9999, label: "すべて" },
];

const ORDER_OPTIONS: { value: ReviewOrder; label: string }[] = [
  { value: "random", label: "ランダム" },
  { value: "newest", label: "新しい順" },
  { value: "oldest", label: "古い順" },
];

export default function SettingsModal({ settings, onChange, onClose }: Props) {
  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  async function handleExport() {
    const { data } = await supabase.from("vocab").select("*").order("created_at", { ascending: true });
    if (!data || data.length === 0) return;
    
    const headers = ["term", "meaning", "context", "category", "status"];
    const csvRows = [headers.join(",")];
    
    for (const row of data) {
      const values = headers.map(header => {
        const val = String(row[header] || "");
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csvRows.push(values.join(","));
    }
    
    const csvString = csvRows.join("\n");
    // Add BOM for Excel UTF-8 compatibility
    const blob = new Blob(["\uFEFF" + csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `toeic-vocab-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.split("\n").map(l => l.trim()).filter(l => l);
      if (lines.length < 2) throw new Error("Invalid CSV");
      
      const headers = lines[0].split(",").map(h => h.trim());
      const rows = [];
      
      for (let i = 1; i < lines.length; i++) {
        // Split by comma ignoring commas inside quotes
        const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const row: any = {};
        headers.forEach((h, idx) => {
          let val = values[idx] || "";
          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1).replace(/""/g, '"');
          }
          if (h === "status") {
            row[h] = parseInt(val, 10) || 0;
          } else {
            row[h] = val;
          }
        });
        rows.push(row);
      }

      const { error } = await supabase.from("vocab").insert(rows);
      if (error) throw error;
      alert(`${rows.length}件をインポートしました`);
    } catch {
      alert("インポートに失敗しました。CSVファイルを確認してください。");
    }
    e.target.value = "";
  }

  async function handleReset() {
    const confirmed = confirm(
      "全ての単語データと学習記録を削除します。この操作は取り消せません。\n本当に実行しますか？"
    );
    if (!confirmed) return;
    const { error } = await supabase.from("vocab").delete().neq("id", 0);
    if (error) {
      alert("削除に失敗しました");
    } else {
      alert("データを初期化しました");
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          className="settings-modal w-full max-w-2xl rounded-2xl shadow-2xl p-5 pb-10 space-y-6 animate-slide-up"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold settings-text-primary">設定</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 settings-btn-ghost"
            aria-label="閉じる"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── 表示 ── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 settings-section-label">
            <ZoomIn size={14} />
            <span className="text-xs font-semibold tracking-wide uppercase">表示</span>
          </div>

          {/* テーマ */}
          <div>
            <label className="block text-sm font-medium settings-text-secondary mb-2">テーマ</label>
            <div className="flex gap-1.5">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => set("theme", opt.value)}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    settings.theme === opt.value
                      ? "settings-btn-active"
                      : "settings-btn-inactive"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 拡大率 */}
          <div>
            <label className="block text-sm font-medium settings-text-secondary mb-2">拡大率</label>
            <div className="flex gap-1.5 flex-wrap">
              {ZOOM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => set("zoom", opt.value)}
                  className={`flex-1 min-w-[52px] rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                    settings.zoom === opt.value
                      ? "settings-btn-active"
                      : "settings-btn-inactive"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <hr className="settings-divider" />

        {/* ── 学習・復習 ── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 settings-section-label">
            <Volume2 size={14} />
            <span className="text-xs font-semibold tracking-wide uppercase">学習・復習</span>
          </div>

          {/* 自動音声読み上げ */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium settings-text-primary">自動音声読み上げ</p>
              <p className="text-xs settings-text-muted mt-0.5">答えを見た時に単語を自動再生</p>
            </div>
            <button
              role="switch"
              aria-checked={settings.autoSpeak}
              onClick={() => set("autoSpeak", !settings.autoSpeak)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                settings.autoSpeak ? "bg-blue-500" : "settings-toggle-off"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  settings.autoSpeak ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {/* 復習枚数 */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Hash size={13} className="settings-text-muted" />
              <label className="text-sm font-medium settings-text-secondary">1回あたりの復習枚数</label>
            </div>
            <div className="flex gap-1.5">
              {COUNT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => set("reviewCount", opt.value)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                    settings.reviewCount === opt.value
                      ? "settings-btn-active"
                      : "settings-btn-inactive"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 出題順 */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Shuffle size={13} className="settings-text-muted" />
              <label className="text-sm font-medium settings-text-secondary">出題順</label>
            </div>
            <div className="flex gap-1.5">
              {ORDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => set("reviewOrder", opt.value)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                    settings.reviewOrder === opt.value
                      ? "settings-btn-active"
                      : "settings-btn-inactive"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <hr className="settings-divider" />

        {/* ── データ管理 ── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 settings-section-label">
            <Download size={14} />
            <span className="text-xs font-semibold tracking-wide uppercase">データ管理</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleExport}
              className="flex items-center justify-center gap-2 rounded-lg border settings-btn-secondary px-3 py-3 text-sm font-medium transition-colors"
            >
              <Download size={15} />
              エクスポート
            </button>
            <label className="flex items-center justify-center gap-2 rounded-lg border settings-btn-secondary px-3 py-3 text-sm font-medium transition-colors cursor-pointer">
              <Upload size={15} />
              インポート
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleImport}
              />
            </label>
          </div>

          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm font-medium text-red-600 hover:bg-red-100 transition-colors"
          >
            <Trash2 size={15} />
            データを初期化する
          </button>
          <p className="text-xs settings-text-muted text-center">
            初期化を実行すると全ての単語データが削除されます
          </p>
        </section>
        </div>
      </div>
    </div>
  );
}
