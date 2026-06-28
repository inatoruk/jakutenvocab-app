"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { speak } from "@/lib/speech";
import { Vocab, Category, Status } from "@/types/vocab";
import { processDecay, calcReviewDueAt } from "@/lib/vocab";
import { Volume2, Eye, RotateCcw, ChevronRight, Shuffle, CheckCircle, BookOpen, Link2, Loader2, Sparkles, SendHorizontal, Plus } from "lucide-react";
import { AppSettings } from "@/lib/settings";
import nlp from "compromise";

const animationStyles = `
@keyframes swipe-out-tl {
    0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
    100% { transform: translate(-300px, -300px) rotate(-15deg); opacity: 0; }
}
.animate-swipe-out-left {
    animation: swipe-out-tl 0.3s ease-in forwards;
}
`;

type ReviewMode = "unlearned" | "all" | "writing" | "paraphrase";

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
        const unmastered = writingCards.filter((c) => c.status < 2);
        const mastered = writingCards.filter((c) => c.status >= 2);
        if (settings.reviewOrder === "random") {
            return applyLimit([...shuffleArr(unmastered), ...mastered]);
        }
        return applyLimit([...sortGroup(unmastered), ...sortGroup(mastered)]);
    }

    if (mode === "paraphrase") {
        // Paraphrase カテゴリのうち、パラフレーズグループに属するもの優先。ランダムシャッフル。
        const paraphraseCards = allCards.filter((c) => c.category === "Paraphrase");
        if (settings.reviewOrder === "random") {
            return applyLimit(shuffleArr([...paraphraseCards]));
        }
        return applyLimit(sortGroup([...paraphraseCards]));
    }

    // all モード
    if (settings.reviewOrder === "random") {
        return applyLimit(shuffleArr([...allCards]));
    }
    return applyLimit(sortGroup([...allCards]));
}

/** compromise で入力単語を見出し語化して返す */
function lemmatize(word: string): string {
    const doc = nlp(word.trim());
    // 動詞 → 原形
    const verbBase = doc.verbs().toInfinitive().out("text");
    if (verbBase) return verbBase.toLowerCase();
    // 名詞 → 単数形
    const nounSingular = doc.nouns().toSingular().out("text");
    if (nounSingular) return nounSingular.toLowerCase();
    return word.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────────────────────────────────────

export default function ReviewView({ active, settings, vocabVersion = 0 }: { active: boolean; settings: AppSettings; vocabVersion?: number }) {
    // スタイルを注入
    useEffect(() => {
        const styleId = "review-view-animations";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.innerHTML = animationStyles;
            document.head.appendChild(style);
        }
    }, []);

    const [allCards, setAllCards] = useState<Vocab[]>([]);
    const [sessionCards, setSessionCards] = useState<Vocab[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [showAnswer, setShowAnswer] = useState(false);
    const [loading, setLoading] = useState(true);
    const [reviewMode, setReviewMode] = useState<ReviewMode>("unlearned");
    const [showCompletion, setShowCompletion] = useState(false);
    const [animationState, setAnimationState] = useState<"idle" | "flipping-out" | "flipping-in" | "swiping-out" | "swiping-out-left" | "swiping-in">("idle");

    // ── パラフレーズグループデータ ──────────────────────────────────────────
    // vocab_id → group_id のマッピング
    const [paraphraseGroups, setParaphraseGroups] = useState<Record<string, string>>({});
    // group_id → vocab_id[] のグループメンバーマッピング
    const [groupMembers, setGroupMembers] = useState<Record<string, string[]>>({});
    const paraphraseGroupsRef = useRef(paraphraseGroups);
    const groupMembersRef = useRef(groupMembers);
    useEffect(() => { paraphraseGroupsRef.current = paraphraseGroups; }, [paraphraseGroups]);
    useEffect(() => { groupMembersRef.current = groupMembers; }, [groupMembers]);

    // ── パラフレーズモード用の状態 ──────────────────────────────────────────
    const [paraphraseInput, setParaphraseInput] = useState("");
    const [paraphraseResult, setParaphraseResult] = useState<"correct" | "synonym" | "incorrect" | null>(null);
    const [sameWordWarning, setSameWordWarning] = useState(false);
    // AI非同期判定
    const [aiChecking, setAiChecking] = useState(false);
    const [aiHint, setAiHint] = useState<string | null>(null);
    const [registering, setRegistering] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // useEffect 内で最新値を参照するための Ref
    // （タブ開閉の effect は active だけを deps にするため）
    const allCardsRef = useRef(allCards);
    useEffect(() => { allCardsRef.current = allCards; }, [allCards]);
    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; }, [settings]);
    const reviewModeRef = useRef(reviewMode);
    useEffect(() => { reviewModeRef.current = reviewMode; }, [reviewMode]);

    // ─── データ取得 ───────────────────────────────────────────────────────────

    const fetchParaphraseGroups = useCallback(async () => {
        const { data } = await supabase.from("paraphrase_groups").select("*");
        if (data) {
            const mapping: Record<string, string> = {};
            const members: Record<string, string[]> = {};
            (data as { vocab_id: string; group_id: string }[]).forEach(row => {
                mapping[row.vocab_id] = row.group_id;
                if (!members[row.group_id]) members[row.group_id] = [];
                members[row.group_id].push(row.vocab_id);
            });
            setParaphraseGroups(mapping);
            setGroupMembers(members);
        }
    }, []);

    const fetchAndBuildSession = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase
            .from("vocab")
            .select("*")
            .order("created_at", { ascending: true });
        const raw = (data as Vocab[]) || [];
        // 期限切れカードを降格処理（バックグラウンドでDB更新）
        const fetched = processDecay(raw);
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
        fetchParaphraseGroups();
    }, [fetchAndBuildSession, fetchParaphraseGroups]);

    // 単語の追加・編集・削除があった時だけ再fetch（初回マウント時はスキップ）
    const vocabVersionInitialized = useRef(false);
    useEffect(() => {
        if (!vocabVersionInitialized.current) {
            vocabVersionInitialized.current = true;
            return;
        }
        fetchAndBuildSession();
        fetchParaphraseGroups();
    }, [vocabVersion, fetchAndBuildSession, fetchParaphraseGroups]);

    // ─── 現在のカード ──────────────────────────────────────────────────────────

    const currentCard = sessionCards[currentIndex] ?? null;
    const isWritingCard = currentCard?.category === "Writing";
    const isParaphraseMode = reviewMode === "paraphrase";

    // パラフレーズまたはWritingモードに切り替わった時、入力欄にフォーカス
    useEffect(() => {
        if ((isParaphraseMode || isWritingCard) && !showAnswer) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isParaphraseMode, isWritingCard, currentIndex, showAnswer]);

    // ─── パラフレーズ関連ロジック ──────────────────────────────────────────────

    /** 現在のカードのグループメンバー (vocab) を取得 */
    function getGroupSiblings(card: Vocab): Vocab[] {
        const gid = paraphraseGroupsRef.current[card.id];
        if (!gid) return [];
        const memberIds = groupMembersRef.current[gid] ?? [];
        return allCardsRef.current.filter(c => memberIds.includes(c.id) && c.id !== card.id);
    }

    /** 入力の送信ハンドラ（Writing / Paraphrase 共通） */
    async function handleSubmitAnswer() {
        if (!currentCard || !paraphraseInput.trim()) return;

        const input = paraphraseInput.trim();
        const inputLemma = lemmatize(input);
        const displayedLemma = lemmatize(currentCard.term);

        // 出題単語と完全一致した場合
        if (inputLemma === displayedLemma) {
            if (isParaphraseMode) {
                // Paraphraseモードでは、同じ単語はNG
                setSameWordWarning(true);
                return;
            } else {
                // Writingモードでは、これこそが「正解」
                setSameWordWarning(false);
                setParaphraseResult("correct");
                setAnimationState("flipping-out");
                await sleep(150);
                setShowAnswer(true);
                setAnimationState("flipping-in");
                await sleep(150);
                setAnimationState("idle");
                return;
            }
        }
        
        setSameWordWarning(false);

        const siblings = getGroupSiblings(currentCard);
        // 登録済みグループ内に一致するかチェック
        const matched = siblings.find(s => lemmatize(s.term) === inputLemma);

        if (matched) {
            // ローカル正解 (登録済みパラフレーズ、またはWritingでの別解正解)
            setParaphraseResult("correct");
            setAnimationState("flipping-out");
            await sleep(150);
            setShowAnswer(true);
            setAnimationState("flipping-in");
            // 非同期でIELTSヒントを取得
            fetchAiHint(input, currentCard);
            await sleep(150);
            setAnimationState("idle");
        } else {
            // 登録なし → とりあえず「不正解」表示して画面を展開
            setParaphraseResult("incorrect");
            setAnimationState("flipping-out");
            await sleep(150);
            setShowAnswer(true);
            setAnimationState("flipping-in");
            // 裏でAI判定
            checkWithAi(input, currentCard);
            await sleep(150);
            setAnimationState("idle");
        }
    }

    /** AI非同期判定（未登録単語） */
    async function checkWithAi(input: string, card: Vocab) {
        setAiChecking(true);
        setAiHint(null);
        try {
            const res = await fetch("/api/check-paraphrase", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    input,
                    displayedTerm: card.term,
                    meaning: card.meaning,
                    context: card.context || "",
                }),
            });
            const json = await res.json();
            if (json.isValid) {
                setParaphraseResult("synonym"); // Nice synonym
            }
            if (json.hint) setAiHint(json.hint);
        } catch {
            // AI判定失敗は無視
        } finally {
            setAiChecking(false);
        }
    }

    /** 正解時のIELTSヒント取得（非同期）*/
    async function fetchAiHint(input: string, card: Vocab) {
        setAiChecking(true);
        setAiHint(null);
        try {
            const res = await fetch("/api/check-paraphrase", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    input,
                    displayedTerm: card.term,
                    meaning: card.meaning,
                    context: card.context || "",
                }),
            });
            const json = await res.json();
            if (json.hint) setAiHint(json.hint);
        } catch {
            // 無視
        } finally {
            setAiChecking(false);
        }
    }

    /** パラフレーズをその場で登録する */
    async function handleRegisterParaphrase() {
        if (!currentCard || !paraphraseInput.trim()) return;
        setRegistering(true);
        
        const inputTerm = paraphraseInput.trim();
        
        try {
            // 1. 新しい Vocab として登録
            const { data: newVocab, error: vocabError } = await supabase
                .from("vocab")
                .insert({
                    term: inputTerm,
                    meaning: currentCard.meaning, // 意味を引き継ぐ
                    context: "",
                    category: "Paraphrase",
                    status: 0,
                })
                .select()
                .single();
                
            if (vocabError || !newVocab) throw vocabError;
            
            // 2. パラフレーズグループへの追加
            const existingGroupId = paraphraseGroupsRef.current[currentCard.id];
            const groupId = existingGroupId || crypto.randomUUID();
            
            const rowsToUpsert = [{ vocab_id: newVocab.id, group_id: groupId }];
            // 新規グループの場合は現在のカードも追加
            if (!existingGroupId) {
                rowsToUpsert.push({ vocab_id: currentCard.id, group_id: groupId });
            }
            
            const { error: groupError } = await supabase
                .from("paraphrase_groups")
                .upsert(rowsToUpsert, { onConflict: "vocab_id" });
                
            if (groupError) throw groupError;
            
            // 3. データ再取得
            await fetchParaphraseGroups();
            setAllCards(prev => [...prev, newVocab]);
            
            // 4. 正解として表示更新
            setParaphraseResult("correct");
            setAiHint("別解として登録し、正解にしました！");
            
        } catch (e) {
            console.error("Paraphrase registration failed:", e);
            alert("登録に失敗しました");
        } finally {
            setRegistering(false);
        }
    }

    // ─── ハンドラ ─────────────────────────────────────────────────────────────

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    async function handleReveal() {
        setAnimationState("flipping-out");
        await sleep(150);
        setShowAnswer(true);
        setAnimationState("flipping-in");
        if (currentCard && settings.autoSpeak) speak(currentCard.term);
        await sleep(150);
        setAnimationState("idle");
    }

    function handleKeep() {
        goNext("left");
    }

    async function handleMastered() {
        if (!currentCard) return;

        setAnimationState("swiping-out");
        await sleep(300);

        // 新しいステータス（最大 5）
        const newStatus = Math.min(currentCard.status + 1, 5) as Status;

        // Writing は降格スケジュール対象外なので review_due_at は更新しない
        const isWriting = currentCard.category === "Writing";
        const newDueAt = isWriting ? currentCard.review_due_at : calcReviewDueAt(newStatus);

        // DB 更新 (非同期に走らせつつ画面遷移を優先しても良いが、ここでは待つ)
        await supabase
            .from("vocab")
            .update({ status: newStatus, review_due_at: newDueAt })
            .eq("id", currentCard.id);

        const updatedCard: Vocab = { ...currentCard, status: newStatus, review_due_at: newDueAt };

        // allCards を最新に保つ（次のセッション構築に使う）
        setAllCards((prev) =>
            prev.map((c) => (c.id === currentCard.id ? updatedCard : c))
        );

        if (reviewMode === "writing") {
            // Writing: 覚えたカードを末尾に移動（セッションから消さない）
            setSessionCards((prev) => {
                const rest = prev.filter((c) => c.id !== currentCard.id);
                return [...rest, updatedCard];
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
            } else {
                setSessionCards(next);
                // 末尾を覚えた場合は先頭に戻す（次の周回を始める）
                if (currentIndex >= next.length) setCurrentIndex(0);
            }
        }
        setShowAnswer(false);
        
        // パラフレーズモード等の入力リセット
        setParaphraseInput("");
        setParaphraseResult(null);
        setSameWordWarning(false);
        setAiHint(null);
        setAiChecking(false);

        setAnimationState("swiping-in");
        await sleep(300);
        setAnimationState("idle");
    }

    async function goNext(direction?: "left" | "right" | React.MouseEvent) {
        const dir = typeof direction === "string" ? direction : "right";
        setAnimationState(dir === "left" ? "swiping-out-left" : "swiping-out");
        await sleep(300);

        const nextIndex = currentIndex + 1;
        if (nextIndex >= sessionCards.length) {
            // セット完了
            setShowCompletion(true);
            setShowAnswer(false);
        } else {
            setCurrentIndex(nextIndex);
            setShowAnswer(false);
        }
        // パラフレーズモードのリセット
        setParaphraseInput("");
        setParaphraseResult(null);
        setSameWordWarning(false);
        setAiHint(null);
        setAiChecking(false);

        setAnimationState("swiping-in");
        await sleep(300);
        setAnimationState("idle");
    }

    function handleStartNewSet() {
        // 最新の allCards でセッションを再構築（ランダムなら自動でシャッフルされる）
        setSessionCards(buildSession(allCardsRef.current, reviewMode, settings));
        setCurrentIndex(0);
        setShowAnswer(false);
        setShowCompletion(false);
        setParaphraseInput("");
        setParaphraseResult(null);
        setSameWordWarning(false);
        setAiHint(null);
    }

    function handleShuffle() {
        setSessionCards((prev) => {
            if (reviewMode === "writing") {
                // Writing: 未習得グループのみシャッフル、習得済みは末尾固定
                const unmastered = prev.filter((c) => c.status < 2);
                const mastered = prev.filter((c) => c.status >= 2);
                return [...shuffleArr(unmastered), ...mastered];
            }
            return shuffleArr(prev);
        });
        setCurrentIndex(0);
        setShowAnswer(false);
        setShowCompletion(false);
        setParaphraseInput("");
        setParaphraseResult(null);
        setSameWordWarning(false);
        setAiHint(null);
    }

    function handleModeChange(mode: ReviewMode) {
        setReviewMode(mode);
        setSessionCards(buildSession(allCardsRef.current, mode, settings));
        setCurrentIndex(0);
        setShowAnswer(false);
        setShowCompletion(false);
        setParaphraseInput("");
        setParaphraseResult(null);
        setSameWordWarning(false);
        setAiHint(null);
    }

    // ─── テキストユーティリティ ───────────────────────────────────────────────

    function getMatchedTextsRegex(context: string, term: string): RegExp | null {
        if (!term || !context) return null;
        
        // 検索する単語自体から、前後に付着しているピリオドや引用符などの記号をトリム
        const cleanTerm = term.trim().replace(/^[.,\/#!$%\^\&\*;:{}=\-_`~()?\\"']+|[.,\/#!$%\^\&\*;:{}=\-_`~()?\\"']+$/g, "");
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
            .map((s: string) => s.replace(/^[.,\/#!$%\^\&\*;:{}=\-_`~()?\\"']+|[.,\/#!$%\^\&\*;:{}=\-_`~()?\\"']+$/g, ""))
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
        const cleanTerm = term.trim().replace(/^[.,\/#!$%\^\&\*;:{}=\-_`~()?\\"']+|[.,\/#!$%\^\&\*;:{}=\-_`~()?\\"']+$/g, "");
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
        const cleanTerm = term.trim().replace(/^[.,\/#!$%\^\&\*;:{}=\-_`~()?\\"']+|[.,\/#!$%\^\&\*;:{}=\-_`~()?\\"']+$/g, "");
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

    function blankTermWithInput(context: string, term: string) {
        if (!term || !context) return <span>{context}</span>;
        
        const regex = getMatchedTextsRegex(context, term);
        
        const cleanTerm = term.trim().replace(/^[.,\/#!$%\^\&\*;:{}=\-_`~()?\\"']+|[.,\/#!$%\^\&\*;:{}=\-_`~()?\\"']+$/g, "");
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
                        <input
                            key={i}
                            ref={inputRef}
                            type="text"
                            value={paraphraseInput}
                            onChange={(e) => {
                                setParaphraseInput(e.target.value);
                                setSameWordWarning(false);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleSubmitAnswer();
                            }}
                            className={`inline-block border-b-2 bg-transparent text-center focus:ring-0 focus:outline-none font-semibold px-1 text-gray-900 ${
                                isWritingCard
                                    ? "border-pink-400 focus:border-pink-600"
                                    : "border-violet-400 focus:border-violet-600"
                            }`}
                            style={{ 
                                width: `${Math.max(part.length + 2, paraphraseInput.length + 1)}ch` 
                            }}
                            autoComplete="off"
                            autoCapitalize="none"
                        />
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
            <div className="flex-1 flex items-center justify-center min-h-[50vh]">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-gray-400 text-sm">読み込み中...</p>
                </div>
            </div>
        );
    }

    const modeToggle = (
        <div className="flex rounded-lg border border-gray-200 bg-gray-100 p-1">
            {(["unlearned", "all", "writing", "paraphrase"] as ReviewMode[]).map((mode, i, arr) => {
                const labels: Record<ReviewMode, string> = {
                    unlearned: "未習得のみ",
                    all: "すべて",
                    writing: "Writing",
                    paraphrase: "Paraphrase",
                };
                const activeColors: Record<ReviewMode, string> = {
                    unlearned: "bg-blue-600 text-white shadow-sm",
                    all: "bg-purple-600 text-white shadow-sm",
                    writing: "bg-pink-500 text-white shadow-sm",
                    paraphrase: "bg-violet-600 text-white shadow-sm",
                };
                return (
                    <div key={mode} className="flex flex-1 items-center">
                        {i > 0 && (
                            <div className="border-l border-gray-200 h-6 mx-1" />
                        )}
                        <button
                            onClick={() => handleModeChange(mode)}
                            className={`flex-1 rounded-md px-2 py-2 text-xs font-medium transition-colors ${reviewMode === mode ? activeColors[mode] : "text-gray-600 hover:text-gray-800"}`}
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
                    {isParaphraseMode ? (
                        <div className="text-center space-y-3 px-4">
                            <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center mx-auto">
                                <Link2 size={28} className="text-violet-500" />
                            </div>
                            <p className="text-gray-500 text-sm">パラフレーズカードがありません</p>
                            <p className="text-gray-400 text-xs">一覧タブでカテゴリを「Paraphrase」に設定し、グループ化してください</p>
                        </div>
                    ) : (
                        <p className="text-gray-400">復習する単語がありません</p>
                    )}
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

    // ── パラフレーズモードのカードUI ────────────────────────────────────────────
    if (isParaphraseMode && currentCard) {
        const siblings = getGroupSiblings(currentCard);
        const isGrouped = siblings.length > 0;

        return (
            <div className="flex-1 flex flex-col">
                {/* モード切替 */}
                <div className="shrink-0 mb-4 md:mb-3 relative z-20">
                    {modeToggle}
                </div>

                {/* 進捗 + シャッフル */}
                <div className="flex items-center justify-center gap-3 shrink-0 w-full relative z-10">
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

                {/* カード & カテゴリ表示 (残りの領域で中央寄せ) */}
                <div className="flex-1 flex flex-col justify-center items-center py-4 md:py-3">
                    {/* カードとカテゴリをまとめるラッパー */}
                    <div className="w-full flex flex-col items-center shrink-0 gap-4">
                        <div className={`w-full rounded-2xl border border-violet-200 bg-white shadow-sm min-h-[240px] flex flex-col justify-between p-6 relative z-50
                            ${animationState === "flipping-out" ? "animate-flip-out" : ""}
                            ${animationState === "flipping-in" ? "animate-flip-in" : ""}
                            ${animationState === "swiping-out" ? "animate-swipe-out" : ""}
                            ${animationState === "swiping-out-left" ? "animate-swipe-out-left" : ""}
                            ${animationState === "swiping-in" ? "animate-swipe-in" : ""}
                        `}>
                            {!showAnswer ? (
                                /* ── 出題面 ── */
                                <>
                                    <div className="flex-1 flex flex-col justify-center space-y-3">
                                        <p className="text-xs font-semibold text-violet-400 text-center uppercase tracking-widest">
                                            Paraphrase — 言い換えを答えよ
                                        </p>
                                        {/* 出題単語 */}
                                        <div className="text-center">
                                            <p className="text-2xl font-bold text-gray-900">{currentCard.term}</p>
                                            <p className="text-sm text-gray-500 mt-1">{currentCard.meaning}</p>
                                        </div>
                                        {/* 例文（空欄あり） */}
                                        {currentCard.context && (
                                            <p className="text-base leading-relaxed text-gray-700 dark:text-white text-center bg-violet-50 dark:bg-violet-300/10 border border-transparent dark:border-violet-300/20 rounded-lg px-4 py-3">
                                                {blankTermWithInput(currentCard.context, currentCard.term)}
                                            </p>
                                        )}

                                        {/* 入力フォーム */}
                                        <div className="space-y-2">
                                            {!currentCard.context && (
                                                <div className="text-center">
                                                    <input
                                                        ref={inputRef}
                                                        type="text"
                                                        value={paraphraseInput}
                                                        onChange={(e) => {
                                                            setParaphraseInput(e.target.value);
                                                            setSameWordWarning(false);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter" && paraphraseInput.trim()) handleSubmitAnswer();
                                                        }}
                                                        className="inline-block border-b-2 bg-transparent text-center focus:ring-0 focus:outline-none font-semibold px-2 py-1 text-gray-900 text-lg border-violet-400 focus:border-violet-600"
                                                        style={{ width: `${Math.max(currentCard.term.length + 2, paraphraseInput.length + 1)}ch` }}
                                                        autoComplete="off"
                                                        autoCapitalize="none"
                                                    />
                                                </div>
                                            )}
                                            {/* 同じ単語の警告 */}
                                            {sameWordWarning && (
                                                <p className="text-xs text-red-500 px-1">
                                                    出題された単語と同じです。別のパラフレーズを入力してください。
                                                </p>
                                            )}
                                        </div>
                                        {/* グループ未登録の警告 */}
                                        {!isGrouped && (
                                            <p className="text-xs text-amber-600 text-center bg-amber-50 rounded-lg px-3 py-2">
                                                ⚠️ このカードはまだグループ化されていません
                                            </p>
                                        )}
                                    </div>
                                    {/* アクションボタン */}
                                    <div className="flex justify-center gap-3 pt-4 shrink-0">
                                        <button
                                            onClick={() => { setShowAnswer(true); setParaphraseResult(null); }}
                                            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm border text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                                        >
                                            <Eye size={16} />
                                            わからない
                                        </button>
                                        <button
                                            onClick={handleSubmitAnswer}
                                            disabled={!paraphraseInput.trim()}
                                            className="inline-flex items-center gap-2 rounded-lg bg-pink-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-pink-600 active:bg-pink-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <SendHorizontal size={16} />
                                            回答する
                                        </button>
                                    </div>
                                </>
                            ) : (
                                /* ── 解答面 ── */
                                <>
                                    <div className="flex-1 flex flex-col justify-center space-y-2">
                                        {/* 正誤バッジ */}
                                        {paraphraseResult !== null && (
                                            <div className={`text-center rounded-lg px-4 py-2 text-sm font-semibold flex flex-col gap-1 ${
                                                paraphraseResult === "correct"
                                                    ? "bg-green-50 text-green-700 border border-green-200"
                                                    : paraphraseResult === "synonym"
                                                        ? "bg-blue-50 text-blue-700 border border-blue-200"
                                                        : "bg-red-50 text-red-700 border border-red-200"
                                            }`}>
                                                <span>
                                                    {paraphraseResult === "correct" && "✅ 正解！"}
                                                    {paraphraseResult === "synonym" && "🔵 Nice synonym! (登録外の正解)"}
                                                    {paraphraseResult === "incorrect" && (
                                                        aiChecking
                                                            ? <span className="inline-flex items-center justify-center gap-1.5"><Loader2 size={14} className="animate-spin" />AI判定中...</span>
                                                            : "❌ 不正解"
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                        {/* 出題単語と回答をまとめるラッパー (余白を狭くする) */}
                                        <div className="flex flex-col items-center gap-2">
                                            {/* 出題単語の振り返り (サブ) */}
                                            <div className="text-center text-sm">
                                                <span className="text-gray-500">元の単語: </span>
                                                <span className="font-semibold text-gray-700">
                                                    {currentCard.term} <span className="text-gray-400 font-normal">({currentCard.meaning})</span>
                                                </span>
                                            </div>

                                            {/* あなたの回答の表示 (メイン) */}
                                            <div className="text-center">
                                                <p className={`text-2xl font-bold ${paraphraseInput.trim() ? "text-gray-900" : "text-gray-400 italic"}`}>
                                                    {paraphraseInput.trim() || "(未入力)"}
                                                </p>
                                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mt-0.5">
                                                    あなたの回答
                                                </p>
                                            </div>
                                        </div>

                                        {/* 例文（完成形） */}
                                        {currentCard.context && (
                                            <p className="text-sm leading-relaxed text-gray-500 text-center mt-1">
                                                {highlightTerm(currentCard.context, currentCard.term)}
                                            </p>
                                        )}

                                        {/* グループの全パラフレーズ一覧 */}
                                        {siblings.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest flex items-center justify-center gap-1">
                                                    <Link2 size={10} />
                                                    パラフレーズ一覧
                                                </p>
                                                <div className="flex flex-wrap items-center justify-center gap-2">
                                                    {siblings.map((s) => (
                                                        <div key={s.id} className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-1.5">
                                                            <span className="text-sm font-medium text-violet-900">{s.term}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* AI IELTS ヒント */}
                                        {aiChecking && (
                                            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                                                <Loader2 size={14} className="animate-spin text-amber-500 shrink-0" />
                                                <p className="text-xs text-amber-700">IELTSアドバイスを生成中...</p>
                                            </div>
                                        )}
                                        {aiHint && !aiChecking && (
                                            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                                                <Sparkles size={14} className="text-amber-500 shrink-0 mt-0.5" />
                                                <p className="text-xs text-amber-800 whitespace-pre-wrap">{aiHint}</p>
                                            </div>
                                        )}

                                        {/* 別解として登録ボタン */}
                                        {paraphraseResult === "synonym" && paraphraseInput.trim() && (
                                            <div className="flex justify-center pt-1">
                                                <button
                                                    onClick={handleRegisterParaphrase}
                                                    disabled={registering}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100 active:bg-violet-200 transition-colors disabled:opacity-50"
                                                >
                                                    {registering ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                                    別解として登録
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {/* ナビゲーション */}
                                    <div className="flex justify-center gap-3 pt-4 shrink-0">
                                        <button
                                            onClick={() => speak(currentCard.term)}
                                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                                            title="発音"
                                        >
                                            <Volume2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => {
                                                setShowAnswer(false);
                                                setParaphraseInput("");
                                                setParaphraseResult(null);
                                                setSameWordWarning(false);
                                                setAiHint(null);
                                                setTimeout(() => inputRef.current?.focus(), 50);
                                            }}
                                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                                            title="再挑戦"
                                        >
                                            <RotateCcw size={16} />
                                        </button>
                                        <button
                                            onClick={goNext}
                                            className="flex-1 max-w-[200px] inline-flex items-center justify-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2.5 text-sm font-medium text-violet-700 hover:bg-violet-100 active:bg-violet-200 transition-colors duration-200"
                                        >
                                            次へ
                                            <ChevronRight size={16} />
                                        </button>
                                    </div>
                                </>
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

    // ── 通常モード（unlearned / all / writing）のカードUI ─────────────────────
    return (
        <div className="flex-1 flex flex-col">
            {/* モード切替 */}
            <div className={`shrink-0 relative z-20 ${
                reviewMode === "writing"
                    ? (showAnswer ? "mb-3" : "mb-5")
                    : "mb-5"
            }`}>
                {modeToggle}
            </div>

            {/* 進捗 + シャッフル */}
            <div className="flex items-center justify-center gap-3 shrink-0 w-full relative z-10">
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

            {/* コンテンツエリア (残りの領域で中央寄せ) */}
            <div className={`flex-1 flex flex-col justify-center items-center ${reviewMode === "writing" ? "py-4 md:py-3" : "py-4"}`}>
                {/* カード & カテゴリ表示 */}
                <div className="w-full flex flex-col items-center shrink-0 gap-4 px-2">

                    {/* カード */}
                    <div className={`w-full rounded-2xl border bg-white shadow-sm min-h-[240px] flex flex-col justify-between p-6 relative z-50
                        ${isWritingCard ? "border-pink-200" : "border-gray-200"}
                        ${animationState === "flipping-out" ? "animate-flip-out" : ""}
                        ${animationState === "flipping-in" ? "animate-flip-in" : ""}
                        ${animationState === "swiping-out" ? "animate-swipe-out" : ""}
                        ${animationState === "swiping-out-left" ? "animate-swipe-out-left" : ""}
                        ${animationState === "swiping-in" ? "animate-swipe-in" : ""}
                    `}>
                        {!showAnswer ? (
                            isWritingCard ? (
                                <>
                                    <div className="flex-1 flex flex-col justify-center space-y-3">
                                        <p className="text-xs font-semibold text-pink-400 text-center uppercase tracking-widest">
                                            Writing — 単語を答えよ
                                        </p>
                                        <div className="text-center">
                                            <p className="text-xl font-bold text-gray-900">{currentCard.meaning}</p>
                                        </div>
                                        {/* 例文（空欄あり） */}
                                        {currentCard.context && (
                                            <p className="text-lg leading-relaxed text-gray-700 dark:text-white text-center bg-pink-50 dark:bg-pink-300/10 border border-transparent dark:border-pink-300/20 rounded-lg px-4 py-3">
                                                {blankTermWithInput(currentCard.context, currentCard.term)}
                                            </p>
                                        )}
                                        
                                        {/* 入力フォーム */}
                                        {!currentCard.context && (
                                            <div className="space-y-2">
                                                <div className="text-center">
                                                    <input
                                                        ref={inputRef}
                                                        type="text"
                                                        value={paraphraseInput}
                                                        onChange={(e) => {
                                                            setParaphraseInput(e.target.value);
                                                            setSameWordWarning(false);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter" && paraphraseInput.trim()) handleSubmitAnswer();
                                                        }}
                                                        className="inline-block border-b-2 bg-transparent text-center focus:ring-0 focus:outline-none font-semibold px-2 py-1 text-gray-900 text-lg border-pink-400 focus:border-pink-600"
                                                        style={{ width: `${Math.max(currentCard.term.length + 2, paraphraseInput.length + 1)}ch` }}
                                                        autoComplete="off"
                                                        autoCapitalize="none"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex justify-center gap-3 pt-4 shrink-0">
                                        <button
                                            onClick={() => { setShowAnswer(true); setParaphraseResult(null); }}
                                            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm border text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                                        >
                                            <Eye size={16} />
                                            わからない
                                        </button>
                                        <button
                                            onClick={handleSubmitAnswer}
                                            disabled={!paraphraseInput.trim()}
                                            className="inline-flex items-center gap-2 rounded-lg bg-pink-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-pink-600 active:bg-pink-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <SendHorizontal size={16} />
                                            回答する
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex-1 flex flex-col justify-center space-y-6">
                                        <p className="text-lg leading-relaxed text-gray-800 text-center">
                                            {currentCard.context ? (
                                                highlightTerm(currentCard.context, currentCard.term)
                                            ) : (
                                                <span className="text-2xl font-bold">{currentCard.term}</span>
                                            )}
                                        </p>
                                    </div>
                                    <div className="flex justify-center gap-3 pt-4 shrink-0">
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
                                </>
                            )
                        ) : (
                            <>
                                <div className="flex-1 flex flex-col justify-center space-y-2">
                                    {isWritingCard && paraphraseResult !== null && (
                                        <>
                                            {/* 正誤バッジ */}
                                            <div className={`text-center rounded-lg px-4 py-2 text-sm font-semibold flex flex-col gap-1 ${
                                                paraphraseResult === "correct"
                                                    ? "bg-green-50 text-green-700 border border-green-200"
                                                    : paraphraseResult === "synonym"
                                                        ? "bg-blue-50 text-blue-700 border border-blue-200"
                                                        : "bg-red-50 text-red-700 border border-red-200"
                                            }`}>
                                                <span>
                                                    {paraphraseResult === "correct" && "✅ 正解！"}
                                                    {paraphraseResult === "synonym" && "🔵 Nice synonym! (登録外の正解)"}
                                                    {paraphraseResult === "incorrect" && (
                                                        aiChecking
                                                            ? <span className="inline-flex items-center justify-center gap-1.5"><Loader2 size={14} className="animate-spin" />AI判定中...</span>
                                                            : "❌ 不正解"
                                                    )}
                                                </span>
                                            </div>

                                            {/* あなたの回答 */}
                                            <div className="text-center">
                                                <p className={`text-xl font-bold ${paraphraseInput.trim() ? "text-gray-900" : "text-gray-400 italic"}`}>
                                                    {paraphraseInput.trim() || "(未入力)"}
                                                </p>
                                                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mt-0.5">
                                                    あなたの回答
                                                </p>
                                            </div>
                                        </>
                                    )}

                                    <div className="text-center space-y-2">
                                        <p className="text-2xl font-bold text-gray-900">{currentCard.term}</p>
                                        <p className="text-base text-gray-600">{currentCard.meaning}</p>
                                        {isWritingCard && currentCard.context && (
                                            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                                                {highlightTerm(currentCard.context, currentCard.term)}
                                            </p>
                                        )}
                                    </div>

                                    {/* AIヒント */}
                                    {isWritingCard && aiChecking && (
                                        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                                            <Loader2 size={14} className="animate-spin text-amber-500 shrink-0" />
                                            <p className="text-xs text-amber-700">AIアドバイスを生成中...</p>
                                        </div>
                                    )}
                                    {isWritingCard && aiHint && !aiChecking && (
                                        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                                            <Sparkles size={14} className="text-amber-500 shrink-0 mt-0.5" />
                                            <p className="text-xs text-amber-800 whitespace-pre-wrap">{aiHint}</p>
                                        </div>
                                    )}

                                    {/* 別解として登録ボタン (Writing) */}
                                    {isWritingCard && paraphraseResult === "synonym" && paraphraseInput.trim() && (
                                        <div className="flex justify-center pt-1">
                                            <button
                                                onClick={handleRegisterParaphrase}
                                                disabled={registering}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-pink-300 bg-pink-50 px-4 py-2 text-xs font-medium text-pink-700 hover:bg-pink-100 active:bg-pink-200 transition-colors disabled:opacity-50"
                                            >
                                                {registering ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                                別解として登録
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="flex justify-center gap-3 pt-4 shrink-0">
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
                            </>
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
