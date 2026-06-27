"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Vocab, Category, CATEGORIES, Status } from "@/types/vocab";
import { processDecay } from "@/lib/vocab";
import { Search, X, Check, Loader2, Link2, Sparkles, Info, AlertCircle } from "lucide-react";

// 表面上の3段階（内部ステータス 2〜5 はまとめて「習得済み」）
// フィルター・バッジを 0 / 1 / 2 の 3段階で分類
const STATUS_LABELS: Record<0 | 1 | 2, string> = {
    0: "未学習",
    1: "学習中",
    2: "習得済み",
};
const STATUS_STYLES: Record<0 | 1 | 2, string> = {
    0: "bg-red-50 text-red-600 border-red-200",
    1: "bg-orange-50 text-orange-600 border-orange-200",
    2: "bg-green-50 text-green-600 border-green-200",
};

/** 内部ステータス（0、5）を表面上の3段階（0/1/2）にマッピング */
function toDisplayStatus(status: Status): 0 | 1 | 2 {
    if (status === 0) return 0;
    if (status === 1) return 1;
    return 2;
}
const CATEGORY_STYLES: Record<Category, string> = {
    Vocab: "bg-blue-50 text-blue-600 border-blue-200",
    Paraphrase: "bg-purple-50 text-purple-600 border-purple-200",
    Listening: "bg-teal-50 text-teal-600 border-teal-200",
    Writing: "bg-pink-50 text-pink-600 border-pink-200",
};

type FilterCategory = Category | "all";
type FilterStatus = Status | "all";

export default function WordListView({ active, onMutated }: { active: boolean; onMutated?: () => void }) {
    const [words, setWords] = useState<Vocab[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");
    const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
    const [editingWord, setEditingWord] = useState<Vocab | null>(null);
    const [isClosing, setIsClosing] = useState(false);
    const [saving, setSaving] = useState(false);
    const initialLoadDone = useRef(false);

    // 編集フォーム用のstate
    const [editTerm, setEditTerm] = useState("");
    const [editMeaning, setEditMeaning] = useState("");
    const [editContext, setEditContext] = useState("");
    const [editCategory, setEditCategory] = useState<Category>("Vocab");
    const [editStatus, setEditStatus] = useState<Status>(0);

    // AI生成用のstate
    const [isGeneratingMeaning, setIsGeneratingMeaning] = useState(false);
    const [isGeneratingExample, setIsGeneratingExample] = useState(false);
    const [exampleLevel, setExampleLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');
    const [aiError, setAiError] = useState<string | null>(null);

    // ── グループ化機能 ──────────────────────────────────────────────────────
    const [isGroupMode, setIsGroupMode] = useState(false);
    const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
    // vocab_id → group_id のマッピング
    const [paraphraseGroups, setParaphraseGroups] = useState<Record<string, string>>({});
    // group_id → "G1", "G2"... の表示ラベル
    const [groupLabels, setGroupLabels] = useState<Record<string, string>>({});
    const [grouping, setGrouping] = useState(false);

    const fetchParaphraseGroups = useCallback(async () => {
        const { data } = await supabase.from("paraphrase_groups").select("*");
        if (data) {
            const mapping: Record<string, string> = {};
            const seenGroups: string[] = [];
            (data as { vocab_id: string; group_id: string }[]).forEach(row => {
                mapping[row.vocab_id] = row.group_id;
                if (!seenGroups.includes(row.group_id)) seenGroups.push(row.group_id);
            });
            setParaphraseGroups(mapping);
            const labels: Record<string, string> = {};
            seenGroups.forEach((gid, i) => { labels[gid] = `G${i + 1}`; });
            setGroupLabels(labels);
        }
    }, []);

    const fetchWords = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        const { data } = await supabase
            .from("vocab")
            .select("*")
            .order("created_at", { ascending: false });
        if (data) {
            // 期限切れカードを降格処理（バックグラウンドでDB更新）
            setWords(processDecay(data as Vocab[]));
        }
        if (!silent) setLoading(false);
    }, []);

    useEffect(() => {
        fetchWords();
        fetchParaphraseGroups();
        initialLoadDone.current = true;
    }, [fetchWords, fetchParaphraseGroups]);

    // タブがアクティブになったらバックグラウンドで再取得
    useEffect(() => {
        if (active && initialLoadDone.current) {
            fetchWords(true);
            fetchParaphraseGroups();
        }
    }, [active, fetchWords, fetchParaphraseGroups]);



    // フィルタリング
    const filteredWords = words.filter((word) => {
        if (filterCategory !== "all" && word.category !== filterCategory) return false;
        // 表面ステータスフィルター：status=2 のフィルターは内部ステータス、2「以上」にマッチ
        if (filterStatus !== "all") {
            const display = toDisplayStatus(word.status);
            if (display !== filterStatus) return false;
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            return (
                word.term.toLowerCase().includes(q) ||
                word.meaning.toLowerCase().includes(q)
            );
        }
        return true;
    });

    const generateAIContent = async (type: 'meaning' | 'example') => {
        if (!editTerm.trim()) {
            setAiError("単語を入力してください");
            setTimeout(() => setAiError(null), 3000);
            return;
        }

        setAiError(null);
        if (type === 'meaning') {
            setEditMeaning('');
            setIsGeneratingMeaning(true);
        } else {
            setEditContext('');
            setIsGeneratingExample(true);
        }

        try {
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    term: editTerm.trim(),
                    type,
                    ...(type === 'example' ? { level: exampleLevel } : {})
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '生成に失敗しました');
            }

            if (type === 'meaning') {
                setEditMeaning(data.result);
            } else {
                setEditContext(data.result);
            }
        } catch (error: any) {
            let userMessage = error.message || 'エラーが発生しました。';
            if (userMessage.includes('Failed to fetch') || userMessage.includes('NetworkError') || userMessage.includes('fetch')) {
                userMessage = 'サーバーとの通信に失敗しました。ネットワークの接続状況を確認してください。';
            }
            setAiError(userMessage);
            setTimeout(() => setAiError(null), 5000);
        } finally {
            if (type === 'meaning') setIsGeneratingMeaning(false);
            else setIsGeneratingExample(false);
        }
    };

    function openEdit(word: Vocab) {
        setEditingWord(word);
        setIsClosing(false);
        setEditTerm(word.term);
        setEditMeaning(word.meaning);
        setEditContext(word.context);
        setEditCategory(word.category);
        setEditStatus(word.status);
        setAiError(null);
        setIsGeneratingMeaning(false);
        setIsGeneratingExample(false);
    }

    function closeEdit() {
        setIsClosing(true);
        setTimeout(() => {
            setEditingWord(null);
            setIsClosing(false);
            setAiError(null);
            setIsGeneratingMeaning(false);
            setIsGeneratingExample(false);
        }, 250);
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
            onMutated?.();
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
            onMutated?.();
        }
    }

    // カード選択トグル
    function toggleSelectWord(id: string) {
        setSelectedWordIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    // グループ化実行
    async function handleGroup() {
        if (selectedWordIds.size < 2) return;
        setGrouping(true);
        const newGroupId = crypto.randomUUID();
        const rows = Array.from(selectedWordIds).map(vid => ({
            vocab_id: vid,
            group_id: newGroupId,
        }));
        const { error } = await supabase
            .from("paraphrase_groups")
            .upsert(rows, { onConflict: "vocab_id" });
        setGrouping(false);
        if (!error) {
            setSelectedWordIds(new Set());
            setIsGroupMode(false);
            await fetchParaphraseGroups();
        }
    }

    function exitGroupMode() {
        setIsGroupMode(false);
        setSelectedWordIds(new Set());
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 min-h-[50vh]">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-gray-400 text-sm">読み込み中...</p>
                </div>
            </div>
        );
    }

    const isParaphraseFilter = filterCategory === "Paraphrase";

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
                {/* カテゴリフィルター + グループ化ボタン */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="flex gap-1.5 flex-wrap flex-1">
                        <button
                            onClick={() => {
                                setFilterCategory("all");
                                exitGroupMode();
                            }}
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
                                onClick={() => {
                                    setFilterCategory(filterCategory === c ? "all" : c);
                                    exitGroupMode();
                                }}
                                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${filterCategory === c
                                    ? CATEGORY_STYLES[c]
                                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                                    }`}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                    {/* グループ化ボタン（常に表示） */}
                    <button
                        onClick={() => {
                            if (isGroupMode) {
                                exitGroupMode();
                            } else {
                                setFilterCategory("Paraphrase");
                                setIsGroupMode(true);
                            }
                        }}
                        className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium border transition-colors shrink-0 ${
                            isGroupMode
                                ? "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
                                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                    >
                        <Link2 size={12} />
                        グループ化
                    </button>
                </div>

                {/* ステータスフィルター */}
                <div className="flex gap-1.5 flex-wrap">
                    <button
                        onClick={() => {
                            setFilterStatus("all");
                            exitGroupMode();
                        }}
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${filterStatus === "all"
                            ? "filter-btn-active"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                            }`}
                    >
                        全ステータス
                    </button>
                    {([0, 1, 2] as (0 | 1 | 2)[]).map((s) => (
                        <button
                            key={s}
                            onClick={() => {
                                setFilterStatus(filterStatus === s ? "all" : s);
                                exitGroupMode();
                            }}
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

            {/* グループ化モード：ヒント */}
            {isGroupMode && (
                <div className="flex items-center gap-2 rounded-lg bg-purple-50 border border-purple-200 px-3 py-2">
                    <Link2 size={14} className="text-purple-600 shrink-0" />
                    <p className="text-xs text-purple-700 font-medium">
                        グループ化したいカードを2つ以上タップして選んでください
                    </p>
                </div>
            )}

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
                <ul className={`space-y-2 ${isGroupMode ? "pb-20" : ""}`}>
                    {filteredWords.map((word) => {
                        const groupId = paraphraseGroups[word.id];
                        const groupLabel = groupId ? groupLabels[groupId] : null;
                        const isSelected = selectedWordIds.has(word.id);

                        return (
                            <li
                                key={word.id}
                                onClick={() => {
                                    if (isGroupMode) {
                                        toggleSelectWord(word.id);
                                    } else {
                                        openEdit(word);
                                    }
                                }}
                                className={`rounded-lg border bg-white px-4 py-3 cursor-pointer transition-all ${isGroupMode && isSelected
                                    ? "border-purple-400 bg-purple-50 ring-1 ring-purple-300"
                                    : "border-gray-200 active:bg-gray-50"
                                    }`}
                            >
                                <div className="flex items-start gap-3">
                                    {/* 選択インジケーター（グループ化モード時のみ） */}
                                    {isGroupMode && (
                                        <div className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected
                                            ? "bg-purple-600 border-purple-600"
                                            : "border-gray-300 bg-white"
                                            }`}>
                                            {isSelected && <Check size={11} className="text-white" />}
                                        </div>
                                    )}

                                    <div className="flex items-start justify-between gap-2 flex-1 min-w-0">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-gray-900 text-base">
                                                {word.term}
                                            </p>
                                            <p className="text-sm text-gray-600 mt-0.5">
                                                {word.meaning}
                                            </p>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0 mt-0.5">
                                            <div className="flex items-center gap-1">
                                                {/* グループバッジ */}
                                                {groupLabel && (
                                                    <span className="inline-flex items-center gap-0.5 rounded-full border border-purple-300 bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-600">
                                                        <Link2 size={9} />
                                                        {groupLabel}
                                                    </span>
                                                )}
                                                <span
                                                    className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${CATEGORY_STYLES[word.category]}`}
                                                >
                                                    {word.category}
                                                </span>
                                            </div>
                                            <span
                                                className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[toDisplayStatus(word.status)]}`}
                                            >
                                                {STATUS_LABELS[toDisplayStatus(word.status)]}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {/* グループ化モード：スティッキーアクションバー */}
            {isGroupMode && (
                <div className="fixed bottom-20 left-0 right-0 z-40 px-4 pointer-events-none">
                    <div className="mx-auto max-w-2xl pointer-events-auto">
                        <div className="flex items-center gap-2 rounded-2xl border border-purple-200 bg-white shadow-lg px-4 py-3">
                            <p className="text-sm font-medium text-gray-700 flex-1">
                                {selectedWordIds.size > 0
                                    ? `${selectedWordIds.size}件選択中`
                                    : "カードを選択してください"}
                            </p>
                            <button
                                onClick={exitGroupMode}
                                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 active:bg-gray-100"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={handleGroup}
                                disabled={selectedWordIds.size < 2 || grouping}
                                className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 active:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                {grouping
                                    ? <Loader2 size={14} className="animate-spin" />
                                    : <Link2 size={14} />
                                }
                                グループ化
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 編集モーダル */}
            {editingWord && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${isClosing ? "animate-fade-out" : "animate-fade-in"
                            }`}
                        onClick={closeEdit}
                    />
                    <div
                        className={`relative z-10 w-full max-w-2xl max-h-full overflow-y-auto bg-white rounded-2xl shadow-xl p-5 pb-8 space-y-4 ${isClosing ? "animate-slide-down" : "animate-slide-up"
                            }`}
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
                            <div className="flex items-center gap-3 mb-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    意味
                                </label>
                                <button
                                    type="button"
                                    onClick={() => generateAIContent('meaning')}
                                    disabled={isGeneratingMeaning || !editTerm.trim()}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/80 dark:hover:bg-blue-900/30"
                                >
                                    {isGeneratingMeaning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                    AI生成
                                </button>
                            </div>
                            <div className="relative w-full">
                                <input
                                    type="text"
                                    value={editMeaning}
                                    onChange={(e) => setEditMeaning(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <div
                                    className={`pointer-events-none absolute inset-0 w-full rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-800 flex items-center h-full animate-shimmer-input transition-opacity duration-500 ${
                                        isGeneratingMeaning ? "opacity-100" : "opacity-0"
                                    }`}
                                >
                                    {isGeneratingMeaning && <div className="h-3 w-[35%] skeleton-bar"></div>}
                                </div>
                            </div>
                        </div>

                        {/* 例文 */}
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    例文
                                </label>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => generateAIContent('example')}
                                        disabled={isGeneratingExample || !editTerm.trim()}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/80 dark:hover:bg-blue-900/30"
                                    >
                                        {isGeneratingExample ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                        AI生成
                                    </button>
                                    <select
                                        value={exampleLevel}
                                        onChange={(e) => setExampleLevel(e.target.value as 'beginner' | 'intermediate' | 'advanced')}
                                        disabled={isGeneratingExample}
                                        className="h-[26px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs px-1.5 pr-5 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer appearance-none bg-no-repeat"
                                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundPosition: 'right 4px center' }}
                                    >
                                        <option value="beginner">初級</option>
                                        <option value="intermediate">中級</option>
                                        <option value="advanced">上級</option>
                                    </select>
                                </div>
                            </div>
                            <div className="relative w-full">
                                <textarea
                                    value={editContext}
                                    onChange={(e) => setEditContext(e.target.value)}
                                    rows={2}
                                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                                />
                                <div
                                    className={`pointer-events-none absolute inset-0 w-full rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-800 flex flex-col h-full animate-shimmer-input transition-opacity duration-500 ${
                                        isGeneratingExample ? "opacity-100" : "opacity-0"
                                    }`}
                                >
                                    {isGeneratingExample && (
                                        <>
                                            <div className="h-6 md:h-5 flex items-center">
                                                <div className="h-3 w-[85%] skeleton-bar"></div>
                                            </div>
                                            <div className="h-6 md:h-5 flex items-center">
                                                <div className="h-3 w-[60%] skeleton-bar"></div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
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
                                    {([0, 1, 2] as (0 | 1 | 2)[]).map((s) => (
                                        <option key={s} value={s}>
                                            {STATUS_LABELS[s]}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {aiError && (
                            <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2.5">
                                <AlertCircle size={14} className="shrink-0" />
                                <span>{aiError}</span>
                            </div>
                        )}

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
            )}
        </div>
    );
}
