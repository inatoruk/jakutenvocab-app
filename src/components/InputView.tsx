"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { speak } from "@/lib/speech";
import { Category, CATEGORIES } from "@/types/vocab";
import { filterDuplicates } from "@/lib/vocab";
import { Plus, Volume2, Upload, CheckCircle, AlertCircle, Info, Copy, Check, Sparkles, Loader2 } from "lucide-react";

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

interface InputViewProps {
    onAdded?: () => void;
}

export default function InputView({ onAdded }: InputViewProps) {
    const [mode, setMode] = useState<InputMode>("single");
    const [showAllPreview, setShowAllPreview] = useState(false);
    const [copied, setCopied] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    const handleCopyPrompt = () => {
        const promptText = `添付した英文の中で、私がマーカーを引いた単語に対して、以下のルールで出力して。
・出力形式は [単語][タブ][日本語の意味][タブ][その単語が含まれていた元の英文] とする
・1行に1単語ずつ出力して
・例文がない場合は、単語レベルに合わせた例文を生成して`;
        navigator.clipboard.writeText(promptText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

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

    const [isGeneratingMeaning, setIsGeneratingMeaning] = useState(false);
    const [isGeneratingExample, setIsGeneratingExample] = useState(false);

    const generateAIContent = async (type: 'meaning' | 'example') => {
        if (!term.trim()) {
            setSingleResult({ type: "error", message: "単語を入力してください" });
            setTimeout(() => setSingleResult(null), 3000);
            return;
        }

        if (type === 'meaning') {
            setMeaning('');
            setIsGeneratingMeaning(true);
        } else {
            setContext('');
            setIsGeneratingExample(true);
        }

        try {
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ term: term.trim(), type }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '生成に失敗しました');
            }

            if (type === 'meaning') {
                setMeaning(data.result);
            } else {
                setContext(data.result);
            }
        } catch (error: any) {
            let userMessage = error.message || 'エラーが発生しました。';
            if (userMessage.includes('Failed to fetch') || userMessage.includes('NetworkError') || userMessage.includes('fetch')) {
                userMessage = 'サーバーとの通信に失敗しました。ネットワークの接続状況を確認してください。';
            }
            setSingleResult({ type: "error", message: userMessage });
            setTimeout(() => setSingleResult(null), 5000);
        } finally {
            if (type === 'meaning') setIsGeneratingMeaning(false);
            else setIsGeneratingExample(false);
        }
    };

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
            fetchExistingTerms();
            onAdded?.();
        }
    }

    async function handleBulkSubmit() {
        if (parsedRows.length === 0) return;
        setBulkLoading(true);
        setBulkResult(null);

        const allRows = parsedRows.map((row) => ({
            term: row.term,
            meaning: row.meaning,
            context: row.context,
            category: bulkCategory,
            status: 0 as const,
        }));

        // Writing 以外の場合のみ重複フィルタリング
        const { toInsert, skipped } = filterDuplicates(allRows, existingTerms);

        if (toInsert.length === 0) {
            setBulkLoading(false);
            setBulkResult({
                type: "error",
                message: `全 ${skipped.length} 件が既に登録済みのためスキップしました`,
            });
            return;
        }

        const { error } = await supabase.from("vocab").insert(toInsert);
        setBulkLoading(false);
        if (error) {
            setBulkResult({ type: "error", message: "登録に失敗しました" });
        } else {
            const skipMsg = skipped.length > 0 ? `（${skipped.length}件は重複のためスキップ）` : "";
            setBulkResult({
                type: "success",
                message: `${toInsert.length}件を登録しました${skipMsg}`,
            });
            setBulkText("");
            await fetchExistingTerms();
            onAdded?.();
        }
    }



    const aiContent = (
        <>
            <p className="mb-1.5">教材の英文やニュースを読んでいてわからない単語があったら、その単語にマーカーを引いて、AIに以下のように指示してみてください。</p>
            <div className="relative bg-gray-50 dark:bg-gray-900/50 py-2 pl-2.5 pr-9 rounded-lg border border-gray-100 dark:border-gray-800/80 font-mono text-[10px] mb-1.5 leading-normal select-all">
                添付した英文の中で、私がマーカーを引いた単語に対して、以下のルールで出力して。<br />
                ・出力形式は [単語][タブ][日本語の意味][タブ][その単語が含まれていた元の英文] とする<br />
                ・1行に1単語ずつ出力して<br />
                ・例文がない場合は、単語レベルに合わせた例文を生成して
                <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                        e.stopPropagation();
                        handleCopyPrompt();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            handleCopyPrompt();
                        }
                    }}
                    className="absolute right-2 top-2 cursor-pointer focus:outline-none copy-btn-icon"
                    title="コピー"
                >
                    {copied ? (
                        <Check size={16} className="text-green-500" />
                    ) : (
                        <Copy size={16} className="-scale-y-100" />
                    )}
                </div>
            </div>
            <p className="text-gray-600 dark:text-gray-400">あとは、AIが出力してくれたテキストをそのままコピーしてここに貼り付けるだけで、一気に登録ができます。</p>
        </>
    );

    return (
        <div className="space-y-4">
            {/* モード切替 */}
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 relative z-20">
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
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                        setMode("bulk");
                        setBulkResult(null);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setMode("bulk");
                            setBulkResult(null);
                        }
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer outline-none ${mode === "bulk"
                        ? "bg-white text-gray-800 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                        }`}
                >
                    <Upload size={14} />
                    <span>一括登録</span>
                    <div
                        className="group flex items-center outline-none"
                        tabIndex={-1}
                    >
                        <button
                            type="button"
                            className="focus:outline-none"
                        >
                            <Info size={14} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
                        </button>
                        <div 
                            className="absolute left-0 right-0 mx-auto w-full sm:w-[400px] top-[45px] transition-all duration-300 py-3 px-4 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-xs rounded-xl border border-gray-200 dark:border-gray-700/80 shadow-xl z-50 leading-normal text-left origin-top-right md:w-[550px] after:content-[''] after:absolute after:-top-5 after:left-0 after:w-full after:h-5 opacity-0 invisible pointer-events-none scale-95 group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:scale-100 cursor-default"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <p className="font-semibold mb-1 text-gray-900 dark:text-white">複数の単語をまとめて登録できる機能です。</p>
                            <p className="mb-1.5"><strong>【入力方法】</strong><br />「単語」「意味」「例文」の間を選択した区切り文字（標準はタブ）で区切って、1行に1単語ずつ入力してください。<br />(例: compromise [タブ] 妥協する [タブ] They had to...)</p>
                            <p className="mb-2 text-gray-500 dark:text-gray-400">
                                ※ 例文は省略しても大丈夫です。<br />
                                ※ Excelやスプレッドシートの表をそのままコピー＆ペーストすると、自動的に「タブ」で区切られて綺麗に入力できます。<br />
                                ※ すでに登録済みの単語は、重複登録を防ぐために自動でスキップされます。
                            </p>
                            {isMobile ? (
                                <details className="border-t border-gray-100 dark:border-gray-700 my-1.5 pt-2">
                                    <summary className="font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1 cursor-pointer select-none outline-none list-none [&::-webkit-details-marker]:hidden">
                                        💡 AI活用のすすめ <span className="text-[10px] font-normal text-gray-400 ml-1">(クリックで展開)</span>
                                    </summary>
                                    <div className="mt-2">
                                        {aiContent}
                                    </div>
                                </details>
                            ) : (
                                <div className="border-t border-gray-100 dark:border-gray-700 my-1.5 pt-2">
                                    <p className="font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1 mb-1">
                                        💡 AI活用のすすめ
                                    </p>
                                    {aiContent}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {mode === "single" ? (
                /* ── 1件ずつモード（既存） ── */
                <form onSubmit={handleSubmit} className="space-y-3 pb-8 md:pb-10">
                    {/* 単語 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            単語・熟語
                        </label>
                        <input
                            type="text"
                            value={term}
                            onChange={(e) => setTerm(e.target.value)}
                            className="block w-full rounded-lg border border-gray-300 px-4 py-3 md:py-2.5 text-base md:text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                                disabled={isGeneratingMeaning || !term.trim()}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/80 dark:hover:bg-blue-900/30"
                            >
                                {isGeneratingMeaning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                AI生成
                            </button>
                        </div>
                        {isGeneratingMeaning ? (
                            <div className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-3 md:py-2.5 bg-white dark:bg-gray-800 flex items-center h-[50px] md:h-[42px] animate-shimmer-input">
                                <div className="h-3 w-[35%] skeleton-bar"></div>
                            </div>
                        ) : (
                            <input
                                type="text"
                                value={meaning}
                                onChange={(e) => setMeaning(e.target.value)}
                                className="block w-full h-[50px] md:h-[42px] rounded-lg border border-gray-300 px-4 py-3 md:py-2.5 text-base md:text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        )}
                    </div>

                    {/* 例文 */}
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <div className="flex items-center gap-1.5">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    例文
                                </label>
                                <div
                                    className="group relative flex items-center outline-none"
                                    tabIndex={-1}
                                >
                                    <button
                                        type="button"
                                        className="focus:outline-none"
                                    >
                                        <Info size={14} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
                                    </button>
                                    <div 
                                        className="absolute left-0 top-[25px] w-[310px] md:left-full md:top-0 md:ml-4 transition-all duration-300 p-3 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-xs rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg z-50 leading-normal text-left origin-top-left after:content-[''] after:absolute after:-top-2 after:left-0 after:w-full after:h-2 md:after:right-full md:after:top-0 md:after:w-5 md:after:h-full md:after:left-auto opacity-0 invisible pointer-events-none transform-gpu antialiased scale-95 group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:scale-100"
                                    >
                                        <p className="mb-1.5">登録する単語と例文の単語の時制や形が違っても、自動認識できます。</p>
                                        <p className="mb-1.5">また、例文がない場合や用意できない場合は、何も書かなくても普通の単語カードとして使えます。</p>
                                        <p>ただ、単語を覚える時には例文と一緒に覚えた方が、イメージとして記憶に残りやすいのでおすすめです。</p>
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => generateAIContent('example')}
                                disabled={isGeneratingExample || !term.trim()}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/80 dark:hover:bg-blue-900/30"
                            >
                                {isGeneratingExample ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                AI生成
                            </button>
                        </div>
                        {isGeneratingExample ? (
                            <div className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-3 md:py-2.5 bg-white dark:bg-gray-800 flex flex-col h-[102px] md:h-[66px] animate-shimmer-input">
                                <div className="h-6 md:h-5 flex items-center">
                                    <div className="h-3 w-[85%] skeleton-bar"></div>
                                </div>
                                <div className="h-6 md:h-5 flex items-center">
                                    <div className="h-3 w-[55%] skeleton-bar"></div>
                                </div>
                            </div>
                        ) : (
                            <textarea
                                value={context}
                                onChange={(e) => setContext(e.target.value)}
                                rows={isMobile ? 3 : 2}
                                suppressHydrationWarning
                                className="block w-full h-[102px] md:h-[66px] rounded-lg border border-gray-300 px-4 py-3 md:py-2.5 text-base md:text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                            />
                        )}
                        <button
                            type="button"
                            onClick={() => speak(context)}
                            disabled={!context.trim()}
                            className="mt-2 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm md:mt-1.5 md:px-3 md:py-1.5 md:text-xs border disabled:opacity-40 disabled:cursor-not-allowed speak-button"
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
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 md:py-2.5 text-base md:text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
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
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 md:py-2.5 text-base md:text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus size={18} />
                        {loading ? "登録中..." : "登録"}
                    </button>
                </form>
            ) : (
                /* ── 一括登録モード ── */
                <div className="space-y-4 md:space-y-5 pb-8 has-[.group:focus-within_details[open]]:pb-56 has-[.group:hover_details[open]]:pb-56 md:pb-10">
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
                                    className={`rounded-full px-3.5 py-1.5 md:px-3 md:py-1 text-xs font-medium border transition-colors ${delimiter === opt.value
                                        ? "filter-btn-active shadow-sm"
                                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700"
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* テキストエリア */}
                    <div>
                        <div className="flex items-center gap-1.5 mb-1 md:mb-1.5">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                データを貼り付け
                            </label>
                        </div>
                        <textarea
                            value={bulkText}
                            onChange={(e) => {
                                setBulkText(e.target.value);
                                setBulkResult(null);
                            }}
                            rows={6}
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                        />
                    </div>

                    <div className="space-y-3">
                        {/* カテゴリ */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 md:mb-1.5">
                                カテゴリ（全件に適用）
                            </label>
                            <select
                                value={bulkCategory}
                                onChange={(e) =>
                                    setBulkCategory(e.target.value as Category)
                                }
                                className="w-full rounded-lg border border-gray-300 px-4 py-3 md:py-2.5 text-base md:text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
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
                                    {(showAllPreview ? parsedRows : parsedRows.slice(0, 5)).map((row, i) => {
                                        const isDup = existingTerms.has(row.term.toLowerCase());
                                        return (
                                            <li
                                                key={i}
                                                className={`text-xs p-2 rounded border flex flex-col gap-0.5 ${isDup
                                                    ? "bg-orange-50/50 border-orange-100 text-orange-800"
                                                    : "bg-white border-gray-100 text-gray-700"
                                                    }`}
                                            >
                                                <div className="flex justify-between items-center font-medium">
                                                    <span className="font-mono text-sm">{row.term}</span>
                                                    {isDup && <span className="text-[10px] bg-orange-100 px-1.5 py-0.5 rounded">既登録</span>}
                                                </div>
                                                <div className="text-gray-600 dark:text-gray-400">{row.meaning}</div>
                                                {row.context && (
                                                    <div className="text-gray-400 dark:text-gray-500 italic text-[11px] mt-0.5">
                                                        {row.context}
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                    {parsedRows.length > 5 && (
                                        <li>
                                            <button
                                                type="button"
                                                onClick={() => setShowAllPreview((v) => !v)}
                                                className="text-xs text-blue-500 hover:text-blue-700 hover:underline"
                                            >
                                                {showAllPreview
                                                    ? "折りたたむ"
                                                    : `...他 ${parsedRows.length - 5} 件`}
                                            </button>
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
                            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 md:py-2.5 text-base md:text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Upload size={18} />
                            {bulkLoading
                                ? "登録中..."
                                : parsedRows.length > 0
                                    ? `${parsedRows.length}件を一括登録`
                                    : "一括登録"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
