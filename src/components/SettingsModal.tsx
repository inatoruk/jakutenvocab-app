"use client";

import { useState } from "react";
import { X, Moon, Volume2, Hash, Shuffle, Download, Upload, Trash2, Sun, Monitor } from "lucide-react";
import { User } from "@supabase/supabase-js";
import {
  AppSettings,
  ThemeMode,
  ReviewOrder,
  ReviewCount,
} from "@/lib/settings";
import { supabase } from "@/lib/supabase";
import { Category, CATEGORIES } from "@/types/vocab";
import { fetchExistingTerms, filterDuplicates } from "@/lib/vocab";

interface Props {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onClose: () => void;
  user: User | null;
}


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

export default function SettingsModal({ settings, onChange, onClose, user }: Props) {
  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  // アニメーション用ステート
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 250);
  };

  // エクスポートモーダル
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExportClosing, setIsExportClosing] = useState(false);
  const [exportCategories, setExportCategories] = useState<Set<Category>>(new Set(CATEGORIES));

  const handleOpenExport = () => {
    setShowExportModal(true);
    setIsExportClosing(false);
  };

  const handleCloseExport = () => {
    setIsExportClosing(true);
    setTimeout(() => {
      setShowExportModal(false);
      setIsExportClosing(false);
    }, 250);
  };

  async function handleLogout() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      handleClose();
    } catch (error: any) {
      alert("ログアウトに失敗しました: " + (error.message || error));
    }
  }

  function toggleExportCategory(cat: Category) {
    setExportCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }

  function toggleAllExportCategories() {
    setExportCategories(prev =>
      prev.size === CATEGORIES.length ? new Set() : new Set(CATEGORIES)
    );
  }

  async function handleExport() {
    handleCloseExport();
    let query = supabase.from("vocab").select("*").order("created_at", { ascending: true });
    if (exportCategories.size < CATEGORIES.length) {
      query = query.in("category", Array.from(exportCategories));
    }
    const { data } = await query;
    if (!data || data.length === 0) {
      alert("該当するカードがありません");
      return;
    }

    // id を先頭に追加（グループインポート時の照合用）
    const headers = ["id", "term", "meaning", "context", "category", "status"];
    const csvRows = [headers.join(",")];

    for (const row of data) {
      const values = headers.map(header => {
        const val = String(row[header] ?? "");
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csvRows.push(values.join(","));
    }

    const csvString = csvRows.join("\n");
    const blob = new Blob(["\uFEFF" + csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // ファイル名にカテゴリを反映
    const catLabel = exportCategories.size === CATEGORIES.length
      ? "all"
      : Array.from(exportCategories).join("-").toLowerCase();
    a.download = `vocab-${catLabel}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text
        .replace(/^\uFEFF/, "") // BOM 除去
        .split("\n")
        .map(l => l.trim())
        .filter(l => l);
      if (lines.length < 2) throw new Error("Invalid CSV");

      const headers = lines[0].split(",").map(h => h.trim());

      // CSV をオブジェクト配列にパース（共通処理）
      function parseRows() {
        const result = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
          const row: any = {};
          headers.forEach((h, idx) => {
            let val = values[idx] || "";
            if (val.startsWith('"') && val.endsWith('"')) {
              val = val.slice(1, -1).replace(/""/g, '"');
            }
            row[h] = h === "status" ? (parseInt(val, 10) || 0) : val;
          });
          result.push(row);
        }
        return result;
      }

      // ── グループインポートモード（id + group_id 列がある場合）──
      if (headers.includes("id") && headers.includes("group_id")) {
        const rows = parseRows();
        const groupRows = rows
          .filter(r => r.id && r.group_id)
          .map(r => ({ vocab_id: r.id, group_id: r.group_id }));

        if (groupRows.length === 0) throw new Error("有効なグループデータがありません");

        const { error } = await supabase
          .from("paraphrase_groups")
          .upsert(groupRows, { onConflict: "vocab_id" });
        if (error) throw error;
        alert(`${groupRows.length}件のグループ情報をインポートしました`);

      // ── 通常インポートモード（新規カード追加）──
      } else {
        const rows = parseRows();
        // id 列があっても vocab insert 時は除外
        const insertCandidates = rows.map(({ id: _id, group_id: _gid, ...rest }) => rest) as {
          term: string;
          meaning: string;
          context: string;
          category: string;
          status: number;
        }[];

        // Writing 以外は重複チェックを適用
        const existingTerms = await fetchExistingTerms();
        const { toInsert, skipped } = filterDuplicates(insertCandidates, existingTerms);

        if (toInsert.length === 0) {
          const msg = skipped.length > 0
            ? `全 ${skipped.length} 件が既に登録済みのためインポートをスキップしました`
            : "インポートする data がありません";
          alert(msg);
          e.target.value = "";
          return;
        }

        const { error } = await supabase.from("vocab").insert(toInsert);
        if (error) throw error;

        const skipMsg = skipped.length > 0
          ? `（${skipped.length}件は重複のためスキップ）`
          : "";
        alert(`${toInsert.length}件をインポートしました${skipMsg}`);
      }
    } catch (err: any) {
      alert(err?.message?.includes("有効な") ? err.message : "インポートに失敗しました。CSVファイルを確認してください。");
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
      handleClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm ${
          isClosing ? "animate-fade-out" : "animate-fade-in"
        }`}
        onClick={handleClose}
      />
      <div
        className={`relative z-10 settings-modal w-full max-w-2xl max-h-full flex flex-col rounded-2xl shadow-2xl ${
          isClosing ? "animate-slide-down" : "animate-slide-up"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-5 pb-4 border-b settings-divider">
          <h2 className="text-base font-bold settings-text-primary">設定</h2>
          <button
            onClick={handleClose}
            className="rounded-full p-1.5 settings-btn-ghost"
            aria-label="閉じる"
          >
            <X size={18} />
          </button>
        </div>

        {/* スクロール可能なコンテンツ */}
        <div className="overflow-y-auto p-5 pb-10 space-y-6 flex-1">
          {/* ユーザーアカウント情報 */}
          {user && (
            <div className="settings-user-card flex items-center justify-between p-3.5 rounded-xl border">
              <div className="flex items-center gap-3">
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt={user.user_metadata.full_name || "User Avatar"}
                    className="w-10 h-10 rounded-full border settings-avatar-border"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full settings-avatar-fallback flex items-center justify-center font-bold text-sm">
                    {user.email?.charAt(0).toUpperCase() || "U"}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold settings-user-name truncate">
                    {user.user_metadata?.full_name || "ユーザー"}
                  </p>
                  <p className="text-xs settings-user-email truncate">
                    {user.email}
                  </p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="settings-btn-danger px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                ログアウト
              </button>
            </div>
          )}

          {/* ── 表示 ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 settings-section-label">
              <Moon size={14} />
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
                className={`relative inline-flex h-6 w-11 items-center rounded-full p-1 transition-colors focus:outline-none ${
                  settings.autoSpeak ? "bg-blue-500" : "settings-toggle-off"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    settings.autoSpeak ? "translate-x-5" : "translate-x-0"
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
                onClick={handleOpenExport}
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

            {/* エクスポート カテゴリ選択モーダル */}
            {showExportModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                <div
                  className={`absolute inset-0 bg-black/50 backdrop-blur-sm ${
                    isExportClosing ? "animate-fade-out" : "animate-fade-in"
                  }`}
                  onClick={handleCloseExport}
                />
                <div
                  className={`relative z-10 w-full max-w-xs bg-white rounded-2xl shadow-2xl p-5 space-y-4 ${
                    isExportClosing ? "animate-slide-down" : "animate-slide-up"
                  }`}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-800">エクスポート対象を選択</h3>
                    <button
                      onClick={toggleAllExportCategories}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {exportCategories.size === CATEGORIES.length ? "すべて解除" : "すべて選択"}
                    </button>
                  </div>

                  <ul className="space-y-1">
                    {CATEGORIES.map(cat => (
                      <li key={cat}>
                        <label className="flex items-center gap-3 px-1 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={exportCategories.has(cat)}
                            onChange={() => toggleExportCategory(cat)}
                            className="w-4 h-4 rounded accent-blue-600"
                          />
                          <span className="text-sm text-gray-700">{cat}</span>
                        </label>
                      </li>
                    ))}
                  </ul>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleCloseExport}
                      className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={handleExport}
                      disabled={exportCategories.size === 0}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                      <Download size={14} />
                      ダウンロード
                    </button>
                  </div>
                </div>
              </div>
            )}

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
