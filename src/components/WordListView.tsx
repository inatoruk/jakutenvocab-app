"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Vocab, Category, CATEGORIES, Status } from "@/types/vocab";
import { processDecay } from "@/lib/vocab";
import { Search, X, Check, Loader2, Link2, Sparkles, Info, AlertCircle, Wand2, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";

// 表面上の3段階（内部ステータス 2〜5 はまとめて「習得済み」）
// フィルター・バッジを 0 / 1 / 2 の 3段階で分類
const STATUS_LABELS: Record<0 | 1 | 2, string> = {
    0: "未学習",
    1: "学習中",
    2: "習得済み",
};
const STATUS_STYLES: Record<0 | 1 | 2, string> = {
    0: "bg-red-50 text-red-600 border-red-300 dark:bg-red-400/20 dark:text-red-400 dark:border-red-700",
    1: "bg-orange-50 text-orange-600 border-orange-300 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-800",
    2: "bg-green-50 text-green-600 border-green-300 dark:bg-green-500/20 dark:text-green-300 dark:border-green-800",
};

/** 内部ステータス（0、5）を表面上の3段階（0/1/2）にマッピング */
function toDisplayStatus(status: Status): 0 | 1 | 2 {
    if (status === 0) return 0;
    if (status === 1) return 1;
    return 2;
}
const CATEGORY_STYLES: Record<Category, string> = {
    Vocab: "bg-blue-50 text-blue-600 border-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-800",
    Paraphrase: "bg-purple-50 text-purple-600 border-purple-300 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-800",
    Listening: "bg-teal-50 text-teal-600 border-teal-300 dark:bg-teal-500/20 dark:text-teal-300 dark:border-teal-800",
    Writing: "bg-pink-50 text-pink-600 border-pink-300 dark:bg-pink-500/20 dark:text-pink-300 dark:border-pink-800",
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

    // ── AI自動提案 ─────────────────────────────────────────────────────────
    type AISuggestion = { reason: string; words: { id: string; term: string; meaning: string }[] };
    const [showAISuggestModal, setShowAISuggestModal] = useState(false);
    const [aiSuggesting, setAiSuggesting] = useState(false);
    const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
    const [aiSuggestIndex, setAiSuggestIndex] = useState(0);
    const [aiSuggestError, setAiSuggestError] = useState<string | null>(null);
    const [approving, setApproving] = useState(false);
    const [approvedCount, setApprovedCount] = useState(0);
    const [approvedIndices, setApprovedIndices] = useState<Set<number>>(new Set());

    const fetchParaphraseGroups = useCallback(async () => {
        // 全ての vocab と paraphrase_groups を取得
        const [vocabRes, groupRes] = await Promise.all([
            supabase.from("vocab").select("id"),
            supabase.from("paraphrase_groups").select("*")
        ]);

        if (vocabRes.data && groupRes.data) {
            const validVocabIds = new Set(vocabRes.data.map((v: any) => v.id));
            const groupsMap = new Map<string, string[]>(); // groupId -> valid vocabIds
            
            // 孤立した（vocabが存在しない）行を収集
            const orphanVocabIds: string[] = [];
            
            groupRes.data.forEach((row: any) => {
                if (!validVocabIds.has(row.vocab_id)) {
                    orphanVocabIds.push(row.vocab_id);
                } else {
                    if (!groupsMap.has(row.group_id)) groupsMap.set(row.group_id, []);
                    groupsMap.get(row.group_id)!.push(row.vocab_id);
                }
            });

            // 1件しかないグループの ID を収集
            const singleMemberGroupIds: string[] = [];
            groupsMap.forEach((vocabIds, groupId) => {
                if (vocabIds.length < 2) {
                    singleMemberGroupIds.push(groupId);
                }
            });

            // バックグラウンドでDBクリーンアップを実行（ブロックしない）
            if (orphanVocabIds.length > 0) {
                supabase.from("paraphrase_groups").delete().in("vocab_id", orphanVocabIds).then();
            }
            if (singleMemberGroupIds.length > 0) {
                supabase.from("paraphrase_groups").delete().in("group_id", singleMemberGroupIds).then();
            }

            // クリーンアップ対象を除外して UI用ステートを構築
            const mapping: Record<string, string> = {};
            const seenGroups: string[] = [];
            
            groupRes.data.forEach((row: any) => {
                if (!validVocabIds.has(row.vocab_id)) return; // 削除済みvocabは無視
                if (singleMemberGroupIds.includes(row.group_id)) return; // 1件しかないグループは無視
                
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
        
        // 紐づく paraphrase_groups の行を削除（SupabaseのCASCADE設定がない場合の安全策）
        await supabase.from("paraphrase_groups").delete().eq("vocab_id", editingWord.id);

        setSaving(false);
        if (!error) {
            closeEdit();
            fetchWords();
            fetchParaphraseGroups(); // グループ情報の再取得（クリーンアップも走る）
            onMutated?.();
        }
    }

    async function handleRemoveFromGroup(vocabId: string) {
        if (!confirm("この単語をグループから外しますか？")) return;
        
        // ローディング状態は一旦setGroupingやsetSavingを利用するか、サイレントで実行する
        // 今回はリストの再読み込みで対応
        const { error } = await supabase
            .from("paraphrase_groups")
            .delete()
            .eq("vocab_id", vocabId);
            
        if (!error) {
            await fetchParaphraseGroups();
        } else {
            alert("グループからの除外に失敗しました");
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

    /** AIによるグループ化自動提案を呼び出す */
    async function handleAISuggest() {
        setAiSuggesting(true);
        setAiSuggestError(null);
        setAiSuggestions([]);
        setAiSuggestIndex(0);
        setApprovedCount(0);
        setApprovedIndices(new Set());
        setShowAISuggestModal(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch("/api/suggest-paraphrase-groups", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {})
                }
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "エラーが発生しました");
            setAiSuggestions(json.suggestions || []);
            if ((json.suggestions || []).length === 0) {
                setAiSuggestError("新しいグループ化の候補が見つかりませんでした。");
            }
        } catch (e: unknown) {
            setAiSuggestError(e instanceof Error ? e.message : "エラーが発生しました");
        } finally {
            setAiSuggesting(false);
        }
    }

    /** 提案されたグループを承認してDBに保存する */
    async function handleApproveGroup(suggestion: AISuggestion) {
        if (suggestion.words.length < 2) return;
        setApproving(true);
        try {
            // 既存グループIDを確認（提案の単語のいずれかが既存グループに属している場合）
            let groupId: string | null = null;
            for (const word of suggestion.words) {
                const existing = paraphraseGroups[word.id];
                if (existing) { groupId = existing; break; }
            }
            if (!groupId) groupId = crypto.randomUUID();

            const rows = suggestion.words.map(w => ({ vocab_id: w.id, group_id: groupId as string }));
            const { error } = await supabase
                .from("paraphrase_groups")
                .upsert(rows, { onConflict: "vocab_id" });
            if (error) throw error;

            await fetchParaphraseGroups();
            setApprovedCount(prev => prev + 1);
            setApprovedIndices(prev => {
                const next = new Set(prev);
                next.add(aiSuggestIndex);
                return next;
            });
        } catch (e) {
            console.error("Approve group failed:", e);
            alert("グループ化に失敗しました");
        } finally {
            setApproving(false);
            setAiSuggestIndex(prev => prev + 1);
        }
    }

    function exitGroupMode() {
        setIsGroupMode(false);
        setSelectedWordIds(new Set());
    }

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-[50vh]">
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
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-300"
                />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="単語・意味を検索..."
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 pl-9 pr-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {searchQuery && (
                    <button
                        onClick={() => setSearchQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
                                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white dark:hover:border-gray-600 dark:active:bg-gray-900"
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
                                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white dark:hover:border-gray-600 dark:active:bg-gray-900"
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
                                ? "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-500/20 dark:text-purple-300 dark:hover:bg-purple-800/40"
                                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white dark:hover:border-gray-600 dark:active:bg-gray-900"
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
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white dark:hover:border-gray-600 dark:active:bg-gray-900"
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
                                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 dark:hover:text-white dark:hover:border-gray-600 dark:active:bg-gray-900"
                                }`}
                        >
                            {STATUS_LABELS[s]}
                        </button>
                    ))}
                </div>
            </div>

            {/* グループ化モード：ヒント */}
            {isGroupMode && (
                <div className="flex items-center gap-2 rounded-lg bg-purple-50 dark:bg-purple-500/15 border border-purple-200 dark:border-purple-800/40 px-3 py-2">
                    <Link2 size={14} className="text-purple-600 dark:text-purple-300 shrink-0" />
                    <p className="text-xs text-purple-700 dark:text-purple-200 font-medium">
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
                <ul className={`space-y-2 ${isGroupMode ? "pb-23 sm:pb-15" : ""}`}>
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
                                    ? "border-purple-400 bg-purple-50 ring-1 ring-purple-300 dark:border-purple-700 dark:bg-purple-500/10 dark:ring-purple-700/40"
                                    : "border-gray-200 active:bg-gray-50 dark:border-gray-800 dark:active:bg-gray-800"
                                    }`}
                            >
                                <div className="flex items-start gap-3">
                                    {/* 選択インジケーター（グループ化モード時のみ） */}
                                    {isGroupMode && (
                                        <div className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected
                                            ? "bg-purple-600 border-purple-600"
                                            : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
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
                                                    isGroupMode ? (
                                                        <span className="inline-flex items-center gap-1 rounded-full border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-500/20 pl-2 pr-1 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-300">
                                                            <Link2 size={9} />
                                                            {groupLabel}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleRemoveFromGroup(word.id);
                                                                }}
                                                                className="hover:bg-purple-200 dark:hover:bg-purple-800 rounded-full p-0.5 transition-colors"
                                                                title="グループから外す"
                                                            >
                                                                <X size={10} />
                                                            </button>
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-0.5 rounded-full border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-300">
                                                            <Link2 size={9} />
                                                            {groupLabel}
                                                        </span>
                                                    )
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
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-purple-200 dark:border-purple-900/60 bg-white dark:bg-gray-900 selection-action-bar px-4 py-3">
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center sm:text-left flex-1 min-w-0">
                                {selectedWordIds.size > 0
                                    ? `${selectedWordIds.size}件選択中`
                                    : "カードを選択してください"}
                            </p>
                            <div className="flex items-center justify-center sm:justify-end gap-2.5 sm:gap-3 w-full sm:w-auto">
                                <button
                                    onClick={exitGroupMode}
                                    className="flex-[0.9] sm:flex-initial text-center rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-2 sm:px-3 text-sm font-medium text-gray-600 dark:text-gray-300 bg-transparent hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600 transition-colors duration-200 whitespace-nowrap"
                                >
                                    キャンセル
                                </button>
                                <button
                                    onClick={handleAISuggest}
                                    className="flex-[0.9] sm:flex-initial inline-flex items-center justify-center gap-1 rounded-lg border border-violet-300 dark:border-violet-700/60 bg-violet-50 dark:bg-violet-900/30 px-2 py-2 sm:px-3 text-sm font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/50 active:bg-violet-200 dark:active:bg-violet-900/70 transition-colors whitespace-nowrap"
                                >
                                    <Wand2 size={14} />
                                    AI提案
                                </button>
                                <button
                                    onClick={handleGroup}
                                    disabled={selectedWordIds.size < 2 || grouping}
                                    className="flex-[1.2] sm:flex-initial inline-flex items-center justify-center gap-1 rounded-lg bg-purple-600 px-2.5 py-2 sm:px-4 text-sm font-medium text-white hover:bg-purple-700 active:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
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
                        className={`relative z-10 w-full max-w-2xl max-h-full overflow-y-auto bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-xl p-5 pb-8 space-y-4 ${isClosing ? "animate-slide-down" : "animate-slide-up"
                            }`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">
                                単語を編集
                            </h3>
                            <button
                                onClick={closeEdit}
                                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* 単語 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                単語・熟語
                            </label>
                            <input
                                type="text"
                                value={editTerm}
                                onChange={(e) => setEditTerm(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>

                        {/* 意味 */}
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
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
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    カテゴリ
                                </label>
                                <select
                                    value={editCategory}
                                    onChange={(e) =>
                                        setEditCategory(e.target.value as Category)
                                    }
                                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                >
                                    {CATEGORIES.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    ステータス
                                </label>
                                <select
                                    value={editStatus}
                                    onChange={(e) =>
                                        setEditStatus(Number(e.target.value) as Status)
                                    }
                                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
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
                            <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40 rounded-lg p-2.5">
                                <AlertCircle size={14} className="shrink-0" />
                                <span>{aiError}</span>
                            </div>
                        )}

                        {/* アクションボタン */}
                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={handleDelete}
                                disabled={saving}
                                className="rounded-lg border border-red-300 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 active:bg-red-200 dark:active:bg-red-900/50"
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
            {/* AI提案モーダル */}
            {showAISuggestModal && (() => {
                const currentSuggestion = aiSuggestions[aiSuggestIndex] ?? null;
                return (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={() => setShowAISuggestModal(false)}>
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
                        <div
                            className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-violet-100 dark:border-violet-900/60 overflow-hidden"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* ヘッダー */}
                            <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Wand2 size={18} className="text-white" />
                                    <span className="text-white font-semibold text-sm">AIグループ化自動提案</span>
                                </div>
                                <button onClick={() => setShowAISuggestModal(false)} className="text-white/70 hover:text-white transition-colors">
                                    <X size={18} />
                                </button>
                            </div>

                            {/* コンテンツ */}
                            <div className="p-5 space-y-4">
                                {/* ローディング */}
                                {aiSuggesting && (
                                    <div className="flex flex-col items-center gap-3 py-8">
                                        <div className="relative">
                                            <div className="w-12 h-12 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin" />
                                            <Sparkles size={16} className="absolute inset-0 m-auto text-violet-500" />
                                        </div>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">AIが単語リストを分析中...</p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500">しばらくお待ちください</p>
                                    </div>
                                )}

                                {/* エラー */}
                                {!aiSuggesting && aiSuggestError && (
                                    <div className="flex flex-col items-center gap-3 py-6">
                                        <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                                            <Sparkles size={20} className="text-amber-500" />
                                        </div>
                                        <p className="text-sm text-gray-600 dark:text-gray-300 text-center">{aiSuggestError}</p>
                                    </div>
                                )}

                                {/* 提案カード */}
                                {!aiSuggesting && !aiSuggestError && currentSuggestion && (
                                    <>
                                        <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                                            <div className="flex items-center gap-2">
                                                <span>提案 {aiSuggestIndex + 1} / {aiSuggestions.length}</span>
                                                {aiSuggestions.length > 1 && (
                                                    <div className="flex items-center gap-0.5 ml-1">
                                                        <button
                                                            onClick={() => setAiSuggestIndex(prev => Math.max(0, prev - 1))}
                                                            disabled={aiSuggestIndex === 0 || approving}
                                                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md text-gray-500 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                                        >
                                                            <ChevronLeft size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => setAiSuggestIndex(prev => Math.min(aiSuggestions.length - 1, prev + 1))}
                                                            disabled={aiSuggestIndex === aiSuggestions.length - 1 || approving}
                                                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md text-gray-500 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                                        >
                                                            <ChevronRight size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            {approvedCount > 0 && (
                                                <span className="text-green-600 dark:text-green-400 font-medium">✓ {approvedCount}件 承認済み</span>
                                            )}
                                        </div>
                                        <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1">
                                            <div
                                                className="bg-violet-500 h-1 rounded-full transition-all duration-300"
                                                style={{ width: `${(aiSuggestIndex / aiSuggestions.length) * 100}%` }}
                                            />
                                        </div>

                                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-lg px-3 py-2">
                                            <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                                                <Sparkles size={12} className="shrink-0 mt-0.5" />
                                                {currentSuggestion.reason}
                                            </p>
                                        </div>

                                        <div className="flex items-center justify-center gap-3 flex-wrap">
                                            {currentSuggestion.words.map((word) => (
                                                <div key={word.id} className="flex flex-col items-center bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-700/50 rounded-xl px-4 py-3 min-w-[100px]">
                                                    <span className="text-base font-bold text-violet-900 dark:text-violet-200">{word.term}</span>
                                                    <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{word.meaning}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="flex gap-3 pt-1">
                                            <button
                                                onClick={() => setAiSuggestIndex(prev => prev + 1)}
                                                disabled={approving}
                                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700 transition-colors disabled:opacity-50"
                                            >
                                                {aiSuggestIndex === aiSuggestions.length - 1 ? (
                                                    <>
                                                        <Check size={14} />
                                                        完了する
                                                    </>
                                                ) : (
                                                    <>
                                                        <X size={14} />
                                                        スキップ
                                                    </>
                                                )}
                                            </button>
                                            {approvedIndices.has(aiSuggestIndex) ? (
                                                <button
                                                    disabled={true}
                                                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/50 px-4 py-2.5 text-sm font-semibold text-green-600 dark:text-green-400"
                                                >
                                                    <Check size={14} />
                                                    グループ化済み
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleApproveGroup(currentSuggestion)}
                                                    disabled={approving}
                                                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 active:bg-violet-800 transition-colors disabled:opacity-50"
                                                >
                                                    {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                    グループ化する
                                                </button>
                                            )}
                                        </div>
                                    </>
                                )}

                                {/* 全提案を処理済み */}
                                {!aiSuggesting && !aiSuggestError && aiSuggestions.length > 0 && aiSuggestIndex >= aiSuggestions.length && (
                                    <div className="flex flex-col items-center gap-3 py-6">
                                        <div className="w-12 h-12 rounded-full bg-green-50 dark:bg-green-950/30 flex items-center justify-center">
                                            <CheckCircle size={24} className="text-green-500" />
                                        </div>
                                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">すべての提案を確認しました</p>
                                        {approvedCount > 0 ? (
                                            <p className="text-xs text-green-600 dark:text-green-400">{approvedCount}件のグループを追加しました！</p>
                                        ) : (
                                            <p className="text-xs text-gray-400 dark:text-gray-500">承認された提案はありませんでした</p>
                                        )}
                                        <button
                                            onClick={() => setShowAISuggestModal(false)}
                                            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 active:bg-violet-800 transition-colors"
                                        >
                                            閉じる
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
