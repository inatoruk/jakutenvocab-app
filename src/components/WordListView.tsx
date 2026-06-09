"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Vocab, Category, CATEGORIES, Status } from "@/types/vocab";
import { Search, X, Check, Loader2 } from "lucide-react";
const STATUS_LABELS: Record<Status, string> = {
    0: "未学習",
    1: "学習中",
    2: "習得済み",
};
const STATUS_STYLES: Record<Status, string> = {
    0: "bg-red-50 text-red-600 border-red-200",
    1: "bg-orange-50 text-orange-600 border-orange-200",
    2: "bg-green-50 text-green-600 border-green-200",
};
const CATEGORY_STYLES: Record<Category, string> = {
    Vocab: "bg-blue-50 text-blue-600 border-blue-200",
    Paraphrase: "bg-purple-50 text-purple-600 border-purple-200",
    Listening: "bg-teal-50 text-teal-600 border-teal-200",
    Writing: "bg-pink-50 text-pink-600 border-pink-200",
};

type FilterCategory = Category | "all";
type FilterStatus = Status | "all";

export default function WordListView({ active }: { active: boolean }) {
    const [words, setWords] = useState<Vocab[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");
    const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
    const [editingWord, setEditingWord] = useState<Vocab | null>(null);
    const [saving, setSaving] = useState(false);
    const initialLoadDone = useRef(false);

    // 編集フォーム用のstate
    const [editTerm, setEditTerm] = useState("");
    const [editMeaning, setEditMeaning] = useState("");
    const [editContext, setEditContext] = useState("");
    const [editCategory, setEditCategory] = useState<Category>("Vocab");
    const [editStatus, setEditStatus] = useState<Status>(0);

    const fetchWords = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        const { data } = await supabase
            .from("vocab")
            .select("*")
            .order("created_at", { ascending: false });
        if (data) setWords(data as Vocab[]);
        if (!silent) setLoading(false);
    }, []);

    useEffect(() => {
        fetchWords();
        initialLoadDone.current = true;
    }, [fetchWords]);

    // タブがアクティブになったらバックグラウンドで再取得
    useEffect(() => {
        if (active && initialLoadDone.current) {
            fetchWords(true);
        }
    }, [active, fetchWords]);

    // フィルタリング
    const filteredWords = words.filter((word) => {
        if (filterCategory !== "all" && word.category !== filterCategory) return false;
        if (filterStatus !== "all" && word.status !== filterStatus) return false;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            return (
                word.term.toLowerCase().includes(q) ||
                word.meaning.toLowerCase().includes(q)
            );
        }
        return true;
    });

    function openEdit(word: Vocab) {
        setEditingWord(word);
        setEditTerm(word.term);
        setEditMeaning(word.meaning);
        setEditContext(word.context);
        setEditCategory(word.category);
        setEditStatus(word.status);
    }

    function closeEdit() {
        setEditingWord(null);
    }

    async function handleSave() {
        if (!editingWord || !editTerm.trim() || !editMeaning.trim()) return;
        setSaving(true);
        const { error } = await supabase
            .from("vocab")
            .update({
                term: editTerm.trim(),
                meaning: editMeaning.trim(),
                context: editContext.trim(),
                category: editCategory,
                status: editStatus,
            })
            .eq("id", editingWord.id);
        setSaving(false);
        if (!error) {
            closeEdit();
            fetchWords();
        }
    }

    async function handleDelete() {
        if (!editingWord) return;
        if (!confirm("この単語を削除しますか？")) return;
        setSaving(true);
        const { error } = await supabase
            .from("vocab")
            .delete()
            .eq("id", editingWord.id);
        setSaving(false);
        if (!error) {
            closeEdit();
            fetchWords();
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <p className="text-gray-400">読み込み中...</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* 検索 */}
            <div className="relative">
                <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="単語・意味を検索..."
                    className="w-full rounded-lg border border-gray-300 pl-9 pr-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {searchQuery && (
                    <button
                        onClick={() => setSearchQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* フィルター */}
            <div className="space-y-2">
                {/* カテゴリフィルター */}
                <div className="flex gap-1.5 flex-wrap">
                    <button
                        onClick={() => setFilterCategory("all")}
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${filterCategory === "all"
                            ? "filter-btn-active"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                            }`}
                    >
                        全カテゴリ
                    </button>
                    {CATEGORIES.map((c) => (
                        <button
                            key={c}
                            onClick={() =>
                                setFilterCategory(filterCategory === c ? "all" : c)
                            }
                            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${filterCategory === c
                                ? CATEGORY_STYLES[c]
                                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                                }`}
                        >
                            {c}
                        </button>
                    ))}
                </div>

                {/* ステータスフィルター */}
                <div className="flex gap-1.5 flex-wrap">
                    <button
                        onClick={() => setFilterStatus("all")}
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${filterStatus === "all"
                            ? "filter-btn-active"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                            }`}
                    >
                        全ステータス
                    </button>
                    {([0, 1, 2] as Status[]).map((s) => (
                        <button
                            key={s}
                            onClick={() =>
                                setFilterStatus(filterStatus === s ? "all" : s)
                            }
                            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${filterStatus === s
                                ? STATUS_STYLES[s]
                                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                                }`}
                        >
                            {STATUS_LABELS[s]}
                        </button>
                    ))}
                </div>
            </div>

            {/* 件数 */}
            <p className="text-xs text-gray-400">
                {filteredWords.length} 件
                {filteredWords.length !== words.length &&
                    ` / ${words.length} 件中`}
            </p>

            {/* 単語リスト */}
            {filteredWords.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                    <p className="text-gray-400 text-sm">
                        該当する単語がありません
                    </p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {filteredWords.map((word) => (
                        <li
                            key={word.id}
                            onClick={() => openEdit(word)}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-3 active:bg-gray-50 cursor-pointer transition-colors"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-gray-900 text-base">
                                        {word.term}
                                    </p>
                                    <p className="text-sm text-gray-600 mt-0.5">
                                        {word.meaning}
                                    </p>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0 mt-0.5">
                                    <span
                                        className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${CATEGORY_STYLES[word.category]}`}
                                    >
                                        {word.category}
                                    </span>
                                    <span
                                        className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[word.status]}`}
                                    >
                                        {STATUS_LABELS[word.status]}
                                    </span>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {/* 編集モーダル */}
            {editingWord && (
                <div
                    className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-sm"
                    onClick={closeEdit}
                >
                    <div className="min-h-full flex items-center justify-center p-4">
                        <div
                            className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-5 pb-8 space-y-4 animate-slide-up"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between">
                                <h3 className="text-base font-bold text-gray-800">
                                単語を編集
                            </h3>
                            <button
                                onClick={closeEdit}
                                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* 単語 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                単語・熟語
                            </label>
                            <input
                                type="text"
                                value={editTerm}
                                onChange={(e) => setEditTerm(e.target.value)}
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
                                value={editMeaning}
                                onChange={(e) => setEditMeaning(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>

                        {/* 例文 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                例文
                            </label>
                            <textarea
                                value={editContext}
                                onChange={(e) => setEditContext(e.target.value)}
                                rows={2}
                                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                            />
                        </div>

                        {/* カテゴリ & ステータス */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    カテゴリ
                                </label>
                                <select
                                    value={editCategory}
                                    onChange={(e) =>
                                        setEditCategory(e.target.value as Category)
                                    }
                                    className="w-full rounded-lg border border-gray-300 px-3 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                                >
                                    {CATEGORIES.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    ステータス
                                </label>
                                <select
                                    value={editStatus}
                                    onChange={(e) =>
                                        setEditStatus(Number(e.target.value) as Status)
                                    }
                                    className="w-full rounded-lg border border-gray-300 px-3 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                                >
                                    {([0, 1, 2] as Status[]).map((s) => (
                                        <option key={s} value={s}>
                                            {STATUS_LABELS[s]}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* アクションボタン */}
                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={handleDelete}
                                disabled={saving}
                                className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-100 active:bg-red-200 disabled:opacity-50"
                            >
                                削除
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={
                                    saving ||
                                    !editTerm.trim() ||
                                    !editMeaning.trim()
                                }
                                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {saving ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <Check size={16} />
                                )}
                                {saving ? "保存中..." : "保存"}
                            </button>
                        </div>
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
}
