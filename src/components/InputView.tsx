"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { speak } from "@/lib/speech";
import { Category, CATEGORIES } from "@/types/vocab";
import { Plus, Volume2, Upload, CheckCircle, AlertCircle } from "lucide-react";

type InputMode = "single" | "bulk";
type Delimiter = "tab" | "comma" | "semicolon";

const DELIMITER_OPTIONS: { value: Delimiter; label: string; char: string }[] = [
    { value: "tab", label: "タブ", char: "\t" },
    { value: "comma", label: "カンマ", char: "," },
    { value: "semicolon", label: "セミコロン", char: ";" },
];

type ParsedRow = { term: string; meaning: string; context: string };

function parseRows(text: string, delimiter: Delimiter): ParsedRow[] {
    const sep = DELIMITER_OPTIONS.find((d) => d.value === delimiter)!.char;
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const parts = line.split(sep).map((p) => p.trim());
            if (parts.length < 2 || !parts[0] || !parts[1]) return null;
            return {
                term: parts[0],
                meaning: parts[1],
                context: parts[2] || "",
            };
        })
        .filter((row): row is ParsedRow => row !== null);
}

export default function InputView() {
    const [mode, setMode] = useState<InputMode>("single");

    // Single mode states
    const [term, setTerm] = useState("");
    const [meaning, setMeaning] = useState("");
    const [context, setContext] = useState("");
    const [category, setCategory] = useState<Category>("Vocab");
    const [loading, setLoading] = useState(false);
    const [singleResult, setSingleResult] = useState<{
        type: "success" | "error";
        message: string;
    } | null>(null);

    // Bulk mode states
    const [bulkText, setBulkText] = useState("");
    const [bulkCategory, setBulkCategory] = useState<Category>("Vocab");
    const [delimiter, setDelimiter] = useState<Delimiter>("tab");
    const [bulkLoading, setBulkLoading] = useState(false);
    const [bulkResult, setBulkResult] = useState<{
        type: "success" | "error";
        message: string;
    } | null>(null);

    // 既存単語の取得（重複チェック用）
    const [existingTerms, setExistingTerms] = useState<Set<string>>(new Set());

    const fetchExistingTerms = useCallback(async () => {
        const { data } = await supabase.from("vocab").select("term");
        if (data) {
            setExistingTerms(new Set(data.map((d: { term: string }) => d.term.toLowerCase())));
        }
    }, []);

    useEffect(() => {
        if (mode === "bulk") {
            fetchExistingTerms();
        }
    }, [mode, fetchExistingTerms]);

    const parsedRows = parseRows(bulkText, delimiter);
    const duplicateRows = parsedRows.filter((row) =>
        existingTerms.has(row.term.toLowerCase())
    );

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!term.trim() || !meaning.trim()) return;
        setLoading(true);
        setSingleResult(null);
        const { error } = await supabase.from("vocab").insert({
            term: term.trim(),
            meaning: meaning.trim(),
            context: context.trim(),
            category,
            status: 0,
        });
        setLoading(false);
        if (error) {
            setSingleResult({ type: "error", message: "登録に失敗しました" });
        } else {
            setSingleResult({ type: "success", message: "登録しました" });
            setTerm("");
            setMeaning("");
            setContext("");
            setCategory("Vocab");
            setTimeout(() => setSingleResult(null), 2000);
        }
    }

    async function handleBulkSubmit() {
        if (parsedRows.length === 0) return;
        setBulkLoading(true);
        setBulkResult(null);
        const rows = parsedRows.map((row) => ({
            term: row.term,
            meaning: row.meaning,
            context: row.context,
            category: bulkCategory,
            status: 0,
        }));
        const { error } = await supabase.from("vocab").insert(rows);
        setBulkLoading(false);
        if (error) {
            setBulkResult({ type: "error", message: "登録に失敗しました" });
        } else {
            setBulkResult({
                type: "success",
                message: `${rows.length}件を登録しました`,
            });
            setBulkText("");
        }
    }



    return (
        <div className="space-y-6">
            {/* モード切替 */}
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                <button
                    type="button"
                    onClick={() => {
                        setMode("single");
                        setBulkResult(null);
                    }}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${mode === "single"
                        ? "bg-white text-gray-800 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                        }`}
                >
                    1件ずつ
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setMode("bulk");
                        setBulkResult(null);
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${mode === "bulk"
                        ? "bg-white text-gray-800 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                        }`}
                >
                    <Upload size={14} />
                    一括登録
                </button>
            </div>

            {mode === "single" ? (
                /* ── 1件ずつモード（既存） ── */
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* 単語 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            単語・熟語
                        </label>
                        <input
                            type="text"
                            value={term}
                            onChange={(e) => setTerm(e.target.value)}
                            // placeholder="例: compromise"
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>

                    {/* 意味 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            意味
                        </label>
                        <input
                            type="text"
                            value={meaning}
                            onChange={(e) => setMeaning(e.target.value)}
                            // placeholder="例: 妥協する、歩み寄る"
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>

                    {/* 例文 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            例文
                        </label>
                        <textarea
                            value={context}
                            onChange={(e) => setContext(e.target.value)}
                            // placeholder="例: They had to compromise on the budget."
                            rows={3}
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                        />
                        <button
                            type="button"
                            onClick={() => speak(context)}
                            disabled={!context.trim()}
                            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Volume2 size={16} />
                            例文の読み上げ確認
                        </button>
                    </div>

                    {/* カテゴリ */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            カテゴリ
                        </label>
                        <select
                            value={category}
                            onChange={(e) =>
                                setCategory(e.target.value as Category)
                            }
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                        >
                            {CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* 結果メッセージ */}
                    {singleResult && (
                        <div
                            className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${singleResult.type === "success"
                                ? "bg-green-50 text-green-700 border border-green-200"
                                : "bg-red-50 text-red-700 border border-red-200"
                                }`}
                        >
                            {singleResult.type === "success" ? (
                                <CheckCircle size={16} />
                            ) : (
                                <AlertCircle size={16} />
                            )}
                            {singleResult.message}
                        </div>
                    )}

                    {/* 登録ボタン */}
                    <button
                        type="submit"
                        disabled={loading || !term.trim() || !meaning.trim()}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-base font-medium text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus size={18} />
                        {loading ? "登録中..." : "登録"}
                    </button>
                </form>
            ) : (
                /* ── 一括登録モード ── */
                <div className="space-y-4">
                    {/* 区切り文字 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            列の区切り文字
                        </label>
                        <div className="flex gap-1.5">
                            {DELIMITER_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setDelimiter(opt.value)}
                                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${delimiter === opt.value
                                        ? "bg-gray-800 text-white border-gray-800"
                                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* テキストエリア */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            データを貼り付け
                        </label>
                        <textarea
                            value={bulkText}
                            onChange={(e) => {
                                setBulkText(e.target.value);
                                setBulkResult(null);
                            }}
                            /* placeholder={
                                delimiter === "tab"
                                    ? "スプレッドシートからコピペ\n（単語  意味  例文 の3列）"
                                    : delimiter === "comma"
                                        ? "compromise,妥協する,They had to compromise.\nrevenue,収益,The revenue increased."
                                        : "compromise;妥協する;They had to compromise.\nrevenue;収益;The revenue increased."
                            } */
                            rows={6}
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                        />
                        {/* <p className="mt-1 text-xs text-gray-400">
                            1行 = 1単語。各行に「単語{DELIMITER_OPTIONS.find((d) => d.value === delimiter)!.label}意味{DELIMITER_OPTIONS.find((d) => d.value === delimiter)!.label}例文」の順で入力（例文は省略可）
                        </p> */}
                    </div>

                    {/* カテゴリ */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            カテゴリ（全件に適用）
                        </label>
                        <select
                            value={bulkCategory}
                            onChange={(e) =>
                                setBulkCategory(e.target.value as Category)
                            }
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                        >
                            {CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* プレビュー */}
                    {parsedRows.length > 0 && (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <p className="text-xs font-medium text-gray-500 mb-2">
                                プレビュー（{parsedRows.length}件）
                            </p>
                            {duplicateRows.length > 0 && (
                                <p className="text-xs text-orange-600 mb-2">
                                    ⚠ {duplicateRows.length}件が既に登録済み
                                </p>
                            )}
                            <ul className="space-y-1.5">
                                {parsedRows.slice(0, 5).map((row, i) => {
                                    const isDup = existingTerms.has(row.term.toLowerCase());
                                    return (
                                        <li
                                            key={i}
                                            className="text-sm text-gray-700"
                                        >
                                            <span className="font-semibold">
                                                {row.term}
                                            </span>
                                            {isDup && (
                                                <span className="ml-1.5 inline-block rounded-full bg-orange-100 text-orange-600 border border-orange-200 px-1.5 py-0 text-[10px] font-medium">
                                                    重複
                                                </span>
                                            )}
                                            <span className="text-gray-400 mx-1.5">
                                                →
                                            </span>
                                            <span>{row.meaning}</span>
                                            {row.context && (
                                                <span className="text-gray-400 text-xs ml-2">
                                                    ({row.context})
                                                </span>
                                            )}
                                        </li>
                                    );
                                })}
                                {parsedRows.length > 5 && (
                                    <li className="text-xs text-gray-400">
                                        ...他 {parsedRows.length - 5} 件
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}

                    {/* 結果メッセージ */}
                    {bulkResult && (
                        <div
                            className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${bulkResult.type === "success"
                                ? "bg-green-50 text-green-700 border border-green-200"
                                : "bg-red-50 text-red-700 border border-red-200"
                                }`}
                        >
                            {bulkResult.type === "success" ? (
                                <CheckCircle size={16} />
                            ) : (
                                <AlertCircle size={16} />
                            )}
                            {bulkResult.message}
                        </div>
                    )}

                    {/* 登録ボタン */}
                    <button
                        type="button"
                        onClick={handleBulkSubmit}
                        disabled={bulkLoading || parsedRows.length === 0}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-base font-medium text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Upload size={18} />
                        {bulkLoading
                            ? "登録中..."
                            : parsedRows.length > 0
                                ? `${parsedRows.length}件を一括登録`
                                : "一括登録"}
                    </button>
                </div>
            )}
        </div>
    );
}
