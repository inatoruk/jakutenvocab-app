"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { speak } from "@/lib/speech";
import { Vocab } from "@/types/vocab";
import { Volume2, Eye, RotateCcw, ChevronRight, Shuffle } from "lucide-react";
import { AppSettings } from "@/lib/settings";

type ReviewMode = "unlearned" | "all" | "writing";

export default function ReviewView({ active, settings }: { active: boolean; settings: AppSettings }) {
    const [allCards, setAllCards] = useState<Vocab[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [showAnswer, setShowAnswer] = useState(false);
    const [loading, setLoading] = useState(true);
    const [reviewMode, setReviewMode] = useState<ReviewMode>("unlearned");
    const initialLoadDone = useRef(false);

    const fetchCards = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        const { data } = await supabase
            .from("vocab")
            .select("*")
            .order("created_at", { ascending: true });
        setAllCards((data as Vocab[]) || []);
        if (!silent) {
            setCurrentIndex(0);
            setShowAnswer(false);
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCards();
        initialLoadDone.current = true;
    }, [fetchCards]);

    // タブがアクティブになったらバックグラウンドで再取得
    useEffect(() => {
        if (active && initialLoadDone.current) {
            fetchCards(true);
        }
    }, [active, fetchCards]);

    // クライアント側でフィルタリング + 出題順・枚数適用
    const cards = useMemo(() => {
        let base: Vocab[];

        if (reviewMode === "unlearned") {
            base = allCards.filter((c) => c.status === 0 || c.status === 1);
        } else if (reviewMode === "writing") {
            // Writing のみ: 未習得を先、習得済みを後ろ。設定の順番は各グループ内に適用
            const writingCards = allCards.filter((c) => c.category === "Writing");
            const unlearned = writingCards.filter((c) => c.status !== 2);
            const mastered = writingCards.filter((c) => c.status === 2);
            const sortGroup = (arr: Vocab[]) => {
                if (settings.reviewOrder === "newest") {
                    return [...arr].sort((a, b) => b.created_at.localeCompare(a.created_at));
                } else if (settings.reviewOrder === "oldest") {
                    return [...arr].sort((a, b) => a.created_at.localeCompare(b.created_at));
                }
                return arr; // random はシャッフルボタンに任せる
            };
            base = [...sortGroup(unlearned), ...sortGroup(mastered)];
            if (settings.reviewCount !== 9999) {
                base = base.slice(0, settings.reviewCount);
            }
            return base;
        } else {
            base = [...allCards];
        }

        if (settings.reviewOrder === "newest") {
            base = [...base].sort((a, b) => b.created_at.localeCompare(a.created_at));
        } else if (settings.reviewOrder === "oldest") {
            base = [...base].sort((a, b) => a.created_at.localeCompare(b.created_at));
        }
        // "random" はシャッフルボタンに任せる

        if (settings.reviewCount !== 9999) {
            base = base.slice(0, settings.reviewCount);
        }

        return base;
    }, [allCards, reviewMode, settings.reviewOrder, settings.reviewCount]);

    // モードごとのシャッフル済みカードを保持
    const [shuffledSets, setShuffledSets] = useState<{
        unlearned: Vocab[] | null;
        all: Vocab[] | null;
        writing: Vocab[] | null;
    }>({ unlearned: null, all: null, writing: null });

    // allCards の最新参照を保持する Ref
    const allCardsRef = useRef(allCards);
    useEffect(() => {
        allCardsRef.current = allCards;
    }, [allCards]);

    // 直前の active 状態を保持する Ref
    const prevActiveRef = useRef(active);
    // 直前の reviewMode を保持する Ref（インデックスリセット用）
    const prevModeRef = useRef(reviewMode);

    // シャッフルユーティリティ
    const shuffleArr = (arr: Vocab[]): Vocab[] => {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };

    // タブを開いた瞬間に全モードのシャッフルをまとめて実行
    useEffect(() => {
        const isTabOpened = prevActiveRef.current === false && active === true;
        prevActiveRef.current = active;

        if (!isTabOpened) return;

        if (settings.reviewOrder === "random") {
            const all = allCardsRef.current;
            const limit = settings.reviewCount;
            const applyLimit = <T,>(arr: T[]) => (limit !== 9999 ? arr.slice(0, limit) : arr);

            // unlearned モード
            const unlearnedBase = all.filter((c) => c.status === 0 || c.status === 1);
            const unlearnedShuffled = shuffleArr(applyLimit(unlearnedBase));

            // all モード
            const allShuffled = shuffleArr(applyLimit([...all]));

            // writing モード（未習得をシャッフル後、習得済みを末尾に固定）
            const writingAll = all.filter((c) => c.category === "Writing");
            const writingUnlearned = shuffleArr(writingAll.filter((c) => c.status !== 2));
            const writingMastered = writingAll.filter((c) => c.status === 2);
            const writingShuffled = applyLimit([...writingUnlearned, ...writingMastered]);

            setShuffledSets({ unlearned: unlearnedShuffled, all: allShuffled, writing: writingShuffled });
        } else {
            setShuffledSets({ unlearned: null, all: null, writing: null });
        }
        setCurrentIndex(0);
        setShowAnswer(false);
    }, [active]);

    // モード切り替え時はインデックスと回答表示をリセット（シャッフルはしない）
    useEffect(() => {
        if (prevModeRef.current !== reviewMode) {
            prevModeRef.current = reviewMode;
            setCurrentIndex(0);
            setShowAnswer(false);
        }
    }, [reviewMode]);

    const displayCards = (settings.reviewOrder === "random" && shuffledSets[reviewMode] !== null)
        ? shuffledSets[reviewMode]!
        : cards;
    const safeIndex = Math.min(currentIndex, Math.max(displayCards.length - 1, 0));
    const currentCard = displayCards[safeIndex] ?? null;

    // 通常カード: 例文中の単語をハイライト
    function highlightTerm(context: string, term: string) {
        if (!term) return <span>{context}</span>;
        const words = term.trim().split(/\s+/);
        const pattern = words
            .map((w) => `${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`)
            .join("\\s+");
        const regex = new RegExp(`(\\b${pattern})`, "gi");
        const parts = context.split(regex);
        return (
            <span>
                {parts.map((part, i) =>
                    i % 2 === 1 ? (
                        <mark key={i} className="bg-yellow-200 text-black font-semibold px-0.5 rounded">
                            {part}
                        </mark>
                    ) : (
                        <span key={i}>{part}</span>
                    )
                )}
            </span>
        );
    }

    // Writing カード: 例文中の単語を下線空欄に置き換え
    function blankTermInContext(context: string, term: string) {
        if (!term || !context) return <span>{context}</span>;
        const words = term.trim().split(/\s+/);
        const pattern = words
            .map((w) => `${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`)
            .join("\\s+");
        const regex = new RegExp(`(\\b${pattern})`, "gi");
        const parts = context.split(regex);
        return (
            <span>
                {parts.map((part, i) =>
                    i % 2 === 1 ? (
                        <span
                            key={i}
                            className="inline-block border-b-2 border-gray-600 mx-0.5 align-bottom"
                            style={{ minWidth: `${Math.max(3, part.length * 0.62)}rem` }}
                        >
                            &nbsp;
                        </span>
                    ) : (
                        <span key={i}>{part}</span>
                    )
                )}
            </span>
        );
    }

    function handleReveal() {
        setShowAnswer(true);
        if (currentCard && settings.autoSpeak) {
            speak(currentCard.term);
        }
    }

    async function handleKeep() {
        goNext();
    }

    async function handleMastered() {
        if (!currentCard) return;
        await supabase
            .from("vocab")
            .update({ status: 2 })
            .eq("id", currentCard.id);
        setAllCards((prev) =>
            prev.map((c) => (c.id === currentCard.id ? { ...c, status: 2 } : c))
        );
        if (reviewMode === "writing") {
            // Writing モード: 習得済みを末尾に移動してシャッフル順を更新
            setShuffledSets((prev) => {
                const current = prev.writing;
                if (!current) return prev;
                const remaining = current.filter((c) => c.id !== currentCard.id);
                const mastered = { ...currentCard, status: 2 as const };
                return { ...prev, writing: [...remaining, mastered] };
            });
            const newIndex = currentIndex >= displayCards.length - 1 ? 0 : currentIndex;
            setCurrentIndex(newIndex);
        } else {
            // 通常モード: シャッフル済みリストからも除外
            setShuffledSets((prev) => {
                const key = reviewMode as "unlearned" | "all";
                const current = prev[key];
                if (!current) return prev;
                return { ...prev, [key]: current.filter((c) => c.id !== currentCard.id) };
            });
            const newIndex = currentIndex >= displayCards.length - 1 ? 0 : currentIndex;
            setCurrentIndex(newIndex);
        }
        setShowAnswer(false);
    }

    function goNext() {
        if (displayCards.length <= 1) {
            setShowAnswer(false);
            return;
        }
        const nextIndex = (currentIndex + 1) % displayCards.length;
        setCurrentIndex(nextIndex);
        setShowAnswer(false);
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <p className="text-gray-400">読み込み中...</p>
            </div>
        );
    }

    function handleModeChange(mode: ReviewMode) {
        setReviewMode(mode);
        setCurrentIndex(0);
        setShowAnswer(false);
    }

    function handleShuffle() {
        if (reviewMode === "writing") {
            // Writing モード: 未習得グループのみシャッフル、習得済みは後ろに固定
            const unlearned = displayCards.filter((c) => c.status !== 2);
            const mastered = displayCards.filter((c) => c.status === 2);
            const shuffled = [...shuffleArr(unlearned), ...mastered];
            setShuffledSets((prev) => ({ ...prev, writing: shuffled }));
        } else {
            const shuffled = shuffleArr([...displayCards]);
            setShuffledSets((prev) => ({ ...prev, [reviewMode]: shuffled }));
        }
        setCurrentIndex(0);
        setShowAnswer(false);
    }



    const modeToggle = (
        <div className="flex rounded-lg border border-gray-200 bg-gray-100 p-1 mb-4">
            <button
                onClick={() => handleModeChange("unlearned")}
                className={`flex-1 rounded-md px-2 py-2 text-sm font-medium transition-colors ${reviewMode === "unlearned"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-800"
                    }`}
            >
                未習得のみ
            </button>
            <div className={`w-px h-4 bg-gray-300 self-center transition-opacity ${
                (reviewMode === "unlearned" || reviewMode === "all") ? "opacity-0" : "opacity-100"
            }`} />
            <button
                onClick={() => handleModeChange("all")}
                className={`flex-1 rounded-md px-2 py-2 text-sm font-medium transition-colors ${reviewMode === "all"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-800"
                    }`}
            >
                すべて
            </button>
            <div className={`w-px h-4 bg-gray-300 self-center transition-opacity ${
                (reviewMode === "all" || reviewMode === "writing") ? "opacity-0" : "opacity-100"
            }`} />
            <button
                onClick={() => handleModeChange("writing")}
                className={`flex-1 rounded-md px-2 py-2 text-sm font-medium transition-colors ${reviewMode === "writing"
                    ? "bg-pink-500 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-800"
                    }`}
            >
                Writing
            </button>
        </div>
    );

    if (cards.length === 0) {
        return (
            <div className="space-y-4">
                {modeToggle}
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                    <p className="text-gray-400">復習する単語がありません</p>
                    <button
                        onClick={() => fetchCards()}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                    >
                        <RotateCcw size={16} />
                        再読み込み
                    </button>
                </div>
            </div>
        );
    }

    const isWritingCard = currentCard?.category === "Writing";

    return (
        <div className="space-y-6">
            {/* モード切替 */}
            {modeToggle}

            {/* 進捗 + シャッフル */}
            <div className="flex items-center justify-center gap-3">
                <div className="text-sm text-gray-400">
                    {currentIndex + 1} / {displayCards.length}
                </div>
                <button
                    onClick={handleShuffle}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 active:bg-gray-100"
                >
                    <Shuffle size={14} />
                    シャッフル
                </button>
            </div>

            {/* カード */}
            <div className={`rounded-2xl border bg-white shadow-sm min-h-[240px] flex flex-col justify-center p-6 ${isWritingCard ? "border-pink-200" : "border-gray-200"}`}>
                {!showAnswer ? (
                    isWritingCard ? (
                        /* Writing 表面: 意味 + 例文（単語空欄） */
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <p className="text-xs font-semibold text-pink-400 text-center uppercase tracking-widest">
                                    Writing — 単語を答えよ
                                </p>
                                <p className="text-base font-medium text-gray-700 text-center">
                                    {currentCard.meaning}
                                </p>
                                {currentCard.context && (
                                    <p className="text-lg leading-relaxed text-gray-800 text-center">
                                        {blankTermInContext(currentCard.context, currentCard.term)}
                                    </p>
                                )}
                            </div>
                            <div className="flex justify-center gap-3">
                                {currentCard.context && (
                                    <button
                                        onClick={() => speak(currentCard.context)}
                                        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                                    >
                                        <Volume2 size={16} />
                                        再生
                                    </button>
                                )}
                                <button
                                    onClick={handleReveal}
                                    className="inline-flex items-center gap-2 rounded-lg bg-pink-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-pink-600 active:bg-pink-700"
                                >
                                    <Eye size={16} />
                                    答えを見る
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* 通常 表面: 例文（単語ハイライト） */
                        <div className="space-y-6">
                            <p className="text-lg leading-relaxed text-gray-800 text-center">
                                {highlightTerm(currentCard.context, currentCard.term)}
                            </p>
                            <div className="flex justify-center gap-3">
                                <button
                                    onClick={() => speak(currentCard.context)}
                                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                                >
                                    <Volume2 size={16} />
                                    再生
                                </button>
                                <button
                                    onClick={handleReveal}
                                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800"
                                >
                                    <Eye size={16} />
                                    答えを見る
                                </button>
                            </div>
                        </div>
                    )
                ) : (
                    /* 裏面: 単語 + 意味（Writing は例文も全文表示） */
                    <div className="space-y-6">
                        <div className="text-center space-y-2">
                            <p className="text-2xl font-bold text-gray-900">
                                {currentCard.term}
                            </p>
                            <p className="text-base text-gray-600">
                                {currentCard.meaning}
                            </p>
                            {isWritingCard && currentCard.context && (
                                <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                                    {currentCard.context}
                                </p>
                            )}
                        </div>
                        <div className="flex justify-center gap-3">
                            <button
                                onClick={() => speak(currentCard.term)}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                                title="発音"
                            >
                                <Volume2 size={16} />
                            </button>
                            <button
                                onClick={handleKeep}
                                className="flex-1 max-w-[140px] rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-700 hover:bg-orange-100 active:bg-orange-200"
                            >
                                まだ（Keep）
                            </button>
                            {(reviewMode === "unlearned" || reviewMode === "writing") ? (
                                <button
                                    onClick={handleMastered}
                                    className="flex-1 max-w-[140px] rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm font-medium text-green-700 hover:bg-green-100 active:bg-green-200"
                                >
                                    覚えた（Mastered）
                                </button>
                            ) : (
                                <button
                                    onClick={goNext}
                                    className="flex-1 max-w-[140px] inline-flex items-center justify-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100 active:bg-blue-200"
                                >
                                    次へ
                                    <ChevronRight size={16} />
                                </button>
                            )}
                            <button
                                onClick={() => setShowAnswer(false)}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                                title="問題に戻る"
                            >
                                <RotateCcw size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* カテゴリ表示 */}
            <div className="text-center">
                <span className={`inline-block rounded-full px-3 py-1 text-xs ${isWritingCard
                    ? "bg-pink-50 text-pink-500 border border-pink-200"
                    : "bg-gray-100 text-gray-500"
                    }`}>
                    {currentCard.category}
                </span>
            </div>
        </div>
    );
}
