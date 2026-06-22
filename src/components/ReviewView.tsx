"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { speak } from "@/lib/speech";
import { Vocab, Category } from "@/types/vocab";
import { Volume2, Eye, RotateCcw, ChevronRight, Shuffle, CheckCircle, BookOpen } from "lucide-react";
import { AppSettings } from "@/lib/settings";
import nlp from "compromise";

type ReviewMode = "unlearned" | "all" | "writing";

const CATEGORY_STYLES: Record<Category, string> = {
    Vocab: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/60",
    Paraphrase: "bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/60",
    Listening: "bg-teal-50 text-teal-600 border-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:border-teal-900/60",
    Writing: "bg-pink-50 text-pink-600 border-pink-200 dark:bg-pink-950/40 dark:text-pink-400 dark:border-pink-900/60",
};

// ─────────────────────────────────────────────────────────────────────────────
// ユーティリティ（コンポーネント外の純粋関数）
// ─────────────────────────────────────────────────────────────────────────────

function shuffleArr<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * セッションカードを構築する純粋関数。
 * フィルタ・ソート・シャッフル・枚数制限をここで一括処理する。
 */
function buildSession(allCards: Vocab[], mode: ReviewMode, settings: AppSettings): Vocab[] {
    const applyLimit = (arr: Vocab[]) =>
        settings.reviewCount !== 9999 ? arr.slice(0, settings.reviewCount) : arr;

    // ランダム以外のソート（各グループ内に適用）
    const sortGroup = (arr: Vocab[]): Vocab[] => {
        if (settings.reviewOrder === "newest")
            return [...arr].sort((a, b) => b.created_at.localeCompare(a.created_at));
        if (settings.reviewOrder === "oldest")
            return [...arr].sort((a, b) => a.created_at.localeCompare(b.created_at));
        return arr; // random はグループ単位でシャッフルする
    };

    if (mode === "unlearned") {
        // 未学習(0) → 学習中(1) の優先順
        const notLearned = allCards.filter((c) => c.status === 0);
        const inProgress = allCards.filter((c) => c.status === 1);
        if (settings.reviewOrder === "random") {
            // 各グループをシャッフルして連結（未学習が全て修得済みなら学習中のみ）
            const base = notLearned.length > 0
                ? [...shuffleArr(notLearned), ...shuffleArr(inProgress)]
                : shuffleArr(inProgress);
            return applyLimit(base);
        }
        return applyLimit([...sortGroup(notLearned), ...sortGroup(inProgress)]);
    }

    if (mode === "writing") {
        // Writing カテゴリのみ。未習得を先、習得済みを末尾に固定
        const writingCards = allCards.filter((c) => c.category === "Writing");
        const unmastered = writingCards.filter((c) => c.status !== 2);
        const mastered = writingCards.filter((c) => c.status === 2);
        if (settings.reviewOrder === "random") {
            return applyLimit([...shuffleArr(unmastered), ...mastered]);
        }
        return applyLimit([...sortGroup(unmastered), ...sortGroup(mastered)]);
    }

    // all モード
    if (settings.reviewOrder === "random") {
        return applyLimit(shuffleArr([...allCards]));
    }
    return applyLimit(sortGroup([...allCards]));
}

// ─────────────────────────────────────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────────────────────────────────────

export default function ReviewView({ active, settings, vocabVersion = 0 }: { active: boolean; settings: AppSettings; vocabVersion?: number }) {
    const [allCards, setAllCards] = useState<Vocab[]>([]);
    const [sessionCards, setSessionCards] = useState<Vocab[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [showAnswer, setShowAnswer] = useState(false);
    const [loading, setLoading] = useState(true);
    const [reviewMode, setReviewMode] = useState<ReviewMode>("unlearned");
    const [showCompletion, setShowCompletion] = useState(false);

    // useEffect 内で最新値を参照するための Ref
    // （タブ開閉の effect は active だけを deps にするため）
    const allCardsRef = useRef(allCards);
    useEffect(() => { allCardsRef.current = allCards; }, [allCards]);
    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; }, [settings]);
    const reviewModeRef = useRef(reviewMode);
    useEffect(() => { reviewModeRef.current = reviewMode; }, [reviewMode]);

    // ─── データ取得 ───────────────────────────────────────────────────────────

    const fetchAndBuildSession = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase
            .from("vocab")
            .select("*")
            .order("created_at", { ascending: true });
        const fetched = (data as Vocab[]) || [];
        setAllCards(fetched);
        setSessionCards(buildSession(fetched, reviewModeRef.current, settingsRef.current));
        setCurrentIndex(0);
        setShowAnswer(false);
        setShowCompletion(false);
        setLoading(false);
    }, []);

    // 初回ロード
    useEffect(() => {
        fetchAndBuildSession();
    }, [fetchAndBuildSession]);

    // 単語の追加・編集・削除があった時だけ再fetch（初回マウント時はスキップ）
    const vocabVersionInitialized = useRef(false);
    useEffect(() => {
        if (!vocabVersionInitialized.current) {
            vocabVersionInitialized.current = true;
            return;
        }
        fetchAndBuildSession();
    }, [vocabVersion, fetchAndBuildSession]);

    // ─── 現在のカード ──────────────────────────────────────────────────────────

    const currentCard = sessionCards[currentIndex] ?? null;
    const isWritingCard = currentCard?.category === "Writing";

    // ─── ハンドラ ─────────────────────────────────────────────────────────────

    function handleReveal() {
        setShowAnswer(true);
        if (currentCard && settings.autoSpeak) speak(currentCard.term);
    }

    function handleKeep() {
        goNext();
    }

    async function handleMastered() {
        if (!currentCard) return;

        // DB 更新
        await supabase.from("vocab").update({ status: 2 }).eq("id", currentCard.id);

        // allCards を最新に保つ（次のセッション構築に使う）
        setAllCards((prev) =>
            prev.map((c) => (c.id === currentCard.id ? { ...c, status: 2 } : c))
        );

        if (reviewMode === "writing") {
            // Writing: 覚えたカードを末尾に移動（セッションから消さない）
            setSessionCards((prev) => {
                const rest = prev.filter((c) => c.id !== currentCard.id);
                return [...rest, { ...currentCard, status: 2 }];
            });
            // 最後のカードだった場合は先頭に戻す
            if (currentIndex >= sessionCards.length - 1) setCurrentIndex(0);
        } else {
            // 通常: セッションから除外
            const next = sessionCards.filter((c) => c.id !== currentCard.id);
            if (next.length === 0) {
                // セッション内の全カードを覚えた → 完了
                setShowCompletion(true);
                setShowAnswer(false);
                setSessionCards(next);
                return;
            }
            setSessionCards(next);
            // 末尾を覚えた場合は先頭に戻す（次の周回を始める）
            if (currentIndex >= next.length) setCurrentIndex(0);
        }
        setShowAnswer(false);
    }

    function goNext() {
        const nextIndex = currentIndex + 1;
        if (nextIndex >= sessionCards.length) {
            // セット完了
            setShowCompletion(true);
            setShowAnswer(false);
        } else {
            setCurrentIndex(nextIndex);
            setShowAnswer(false);
        }
    }

    function handleStartNewSet() {
        // 最新の allCards でセッションを再構築（ランダムなら自動でシャッフルされる）
        setSessionCards(buildSession(allCardsRef.current, reviewMode, settings));
        setCurrentIndex(0);
        setShowAnswer(false);
        setShowCompletion(false);
    }

    function handleShuffle() {
        setSessionCards((prev) => {
            if (reviewMode === "writing") {
                // Writing: 未習得グループのみシャッフル、習得済みは末尾固定
                const unmastered = prev.filter((c) => c.status !== 2);
                const mastered = prev.filter((c) => c.status === 2);
                return [...shuffleArr(unmastered), ...mastered];
            }
            return shuffleArr(prev);
        });
        setCurrentIndex(0);
        setShowAnswer(false);
        setShowCompletion(false);
    }

    function handleModeChange(mode: ReviewMode) {
        setReviewMode(mode);
        setSessionCards(buildSession(allCardsRef.current, mode, settings));
        setCurrentIndex(0);
        setShowAnswer(false);
        setShowCompletion(false);
    }

    // ─── テキストユーティリティ ───────────────────────────────────────────────

    function getMatchedTextsRegex(context: string, term: string): RegExp | null {
        if (!term || !context) return null;
        
        // 検索する単語自体から、前後に付着しているピリオドや引用符などの記号をトリム
        const cleanTerm = term.trim().replace(/^[.,\/#!$%\^&\*;:{}=\-_`~()?\"']+|[.,\/#!$%\^&\*;:{}=\-_`~()?\"']+$/g, "");
        if (!cleanTerm) return null;

        // 単語を分割し、記号を除去して見出し語検索パターン（{word}）を作成
        // 複数単語の場合は間に「0〜2単語の任意の単語（.{0,2}）」を許容する
        const words = cleanTerm.split(/\s+/);
        const matchPattern = words
            .map(w => {
                const clean = w.replace(/[.*+?^${}()|[\]\\]/g, "");
                return clean ? `{${clean}}` : "";
            })
            .filter(Boolean)
            .join(" .{0,2} ");
            
        if (!matchPattern) return null;

        // compromiseで解析
        const doc = nlp(context);
        const m = doc.match(matchPattern);
        
        if (!m.found) return null;

        // 実際にマッチした文字列のリストを取得し、その文字列からも前後の記号（ピリオド等）を除去する
        const matchedStrs = m.out("array")
            .filter(Boolean)
            .map((s: string) => s.replace(/^[.,\/#!$%\^&\*;:{}=\-_`~()?\"']+|[.,\/#!$%\^&\*;:{}=\-_`~()?\"']+$/g, ""))
            .filter(Boolean);
            
        if (matchedStrs.length === 0) return null;

        // 見つかった文字列をエスケープして分割用の正規表現を作成 (gi)
        const escapedStrs = matchedStrs.map((s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        return new RegExp(`(${escapedStrs.join("|")})`, "gi");
    }

    function highlightTerm(context: string, term: string) {
        if (!term || !context) return <span>{context}</span>;
        
        const regex = getMatchedTextsRegex(context, term);
        
        // フォールバック用の正規表現を作成する際も、termの前後の記号を除去する
        const cleanTerm = term.trim().replace(/^[.,\/#!$%\^&\*;:{}=\-_`~()?\"']+|[.,\/#!$%\^&\*;:{}=\-_`~()?\"']+$/g, "");
        const fallbackRegex = cleanTerm 
            ? new RegExp(`(${cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
            : null;
            
        const activeRegex = regex || fallbackRegex;
        if (!activeRegex) return <span>{context}</span>;
        
        const parts = context.split(activeRegex);
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

    function blankTermInContext(context: string, term: string) {
        if (!term || !context) return <span>{context}</span>;
        
        const regex = getMatchedTextsRegex(context, term);
        
        // フォールバック用の正規表現を作成する際も、termの前後の記号を除去する
        const cleanTerm = term.trim().replace(/^[.,\/#!$%\^&\*;:{}=\-_`~()?\"']+|[.,\/#!$%\^&\*;:{}=\-_`~()?\"']+$/g, "");
        const fallbackRegex = cleanTerm 
            ? new RegExp(`(${cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
            : null;
            
        const activeRegex = regex || fallbackRegex;
        if (!activeRegex) return <span>{context}</span>;
        
        const parts = context.split(activeRegex);
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

    // ─── UI ──────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <p className="text-gray-400">読み込み中...</p>
            </div>
        );
    }

    const modeToggle = (
        <div className="flex rounded-lg border border-gray-200 bg-gray-100 p-1 mb-4">
            {(["unlearned", "all", "writing"] as ReviewMode[]).map((mode, i, arr) => {
                const labels: Record<ReviewMode, string> = {
                    unlearned: "未習得のみ",
                    all: "すべて",
                    writing: "Writing",
                };
                const activeColors: Record<ReviewMode, string> = {
                    unlearned: "bg-blue-600 text-white shadow-sm",
                    all: "bg-purple-600 text-white shadow-sm",
                    writing: "bg-pink-500 text-white shadow-sm",
                };
                return (
                    <div key={mode} className="flex flex-1 items-center">
                        {i > 0 && (
                            <div className="border-l border-gray-200 h-6 mx-1" />
                        )}
                        <button
                            onClick={() => handleModeChange(mode)}
                            className={`flex-1 rounded-md px-2 py-2 text-sm font-medium transition-colors ${reviewMode === mode ? activeColors[mode] : "text-gray-600 hover:text-gray-800"}`}
                        >
                            {labels[mode]}
                        </button>
                    </div>
                );
            })}
        </div>
    );

    if (sessionCards.length === 0) {
        return (
            <div className="flex-1 flex flex-col min-h-0">
                <div className="shrink-0 mb-4">
                    {modeToggle}
                </div>
                <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                    <p className="text-gray-400">復習する単語がありません</p>
                    <button
                        onClick={fetchAndBuildSession}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                    >
                        <RotateCcw size={16} />
                        再読み込み
                    </button>
                </div>
            </div>
        );
    }

    if (showCompletion) {
        return (
            <div className="flex-1 flex flex-col min-h-0">
                <div className="shrink-0 mb-4">
                    {modeToggle}
                </div>
                <div className="flex-1 flex flex-col items-center justify-center space-y-6">
                    <div className="flex items-center justify-center w-20 h-20 rounded-full bg-green-100 border-2 border-green-300">
                        <CheckCircle size={40} className="text-green-500" />
                    </div>
                    <div className="text-center space-y-2">
                        <h2 className="text-xl font-bold text-gray-800">今日の学習が完了しました！</h2>
                        <p className="text-sm text-gray-500">学習を続けますか？</p>
                    </div>
                    <button
                        onClick={handleStartNewSet}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3 text-sm font-semibold text-white shadow-md hover:bg-blue-700 active:bg-blue-800 transition-colors"
                    >
                        <BookOpen size={18} />
                        新しいセットを学ぶ
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col min-h-0">
            {/* モード切替 */}
            <div className="shrink-0 mb-4">
                {modeToggle}
            </div>

            {/* コンテンツエリア */}
            <div className="flex-1 relative flex flex-col justify-center items-center">
                {/* 進捗 + シャッフル (位置は固定) */}
                <div className="absolute -top-1 flex items-center justify-center gap-3">
                    <div className="text-sm text-gray-400">
                        {currentIndex + 1} / {sessionCards.length}
                    </div>
                    <button
                        onClick={handleShuffle}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 active:bg-gray-100 shadow-sm transition-colors"
                    >
                        <Shuffle size={14} />
                        シャッフル
                    </button>
                </div>

                {/* カード & カテゴリ表示 (上下中央) */}
                <div className="w-full flex flex-col items-center justify-center gap-4 mt-4">
                    {/* カード */}
                    <div className={`w-full rounded-2xl border bg-white shadow-sm min-h-[240px] flex flex-col justify-center p-6 ${isWritingCard ? "border-pink-200" : "border-gray-200"}`}>
                        {!showAnswer ? (
                            isWritingCard ? (
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
                                                className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm border speak-button"
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
                                <div className="space-y-6">
                                    <p className="text-lg leading-relaxed text-gray-800 text-center">
                                        {currentCard.context ? (
                                            highlightTerm(currentCard.context, currentCard.term)
                                        ) : (
                                            <span className="text-2xl font-bold">{currentCard.term}</span>
                                        )}
                                    </p>
                                    <div className="flex justify-center gap-3">
                                        <button
                                            onClick={() => speak(currentCard.context || currentCard.term)}
                                            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm border speak-button"
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
                            <div className="space-y-6">
                                <div className="text-center space-y-2">
                                    <p className="text-2xl font-bold text-gray-900">{currentCard.term}</p>
                                    <p className="text-base text-gray-600">{currentCard.meaning}</p>
                                    {isWritingCard && currentCard.context && (
                                        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                                            {currentCard.context}
                                        </p>
                                    )}
                                </div>
                                <div className="flex justify-center gap-3">
                                    <button
                                        onClick={() => speak(currentCard.term)}
                                        className="inline-flex items-center gap-1 rounded-lg px-3 py-2.5 text-sm border speak-button"
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
                        <span className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${CATEGORY_STYLES[currentCard.category]}`}>
                            {currentCard.category}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
