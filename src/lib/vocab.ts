import { supabase } from "@/lib/supabase";

/**
 * Writing 以外のカテゴリに登録済みの term を小文字で返す。
 * Writing は重複を許可するため対象外にする。
 */
export async function fetchExistingTerms(): Promise<Set<string>> {
    const { data } = await supabase
        .from("vocab")
        .select("term")
        .neq("category", "Writing");

    if (!data) return new Set();
    return new Set(data.map((d: { term: string }) => d.term.toLowerCase()));
}

/**
 * 登録しようとしている行リストを、カテゴリと既存 term を考慮してフィルタリングする。
 * - カテゴリが Writing の行は常に toInsert に含める（重複許可）
 * - それ以外のカテゴリで既存 term と一致する行は skipped に分類する
 */
export function filterDuplicates<T extends { term: string; category: string }>(
    rows: T[],
    existingTerms: Set<string>
): { toInsert: T[]; skipped: T[] } {
    const toInsert: T[] = [];
    const skipped: T[] = [];

    for (const row of rows) {
        if (
            row.category !== "Writing" &&
            existingTerms.has(row.term.toLowerCase())
        ) {
            skipped.push(row);
        } else {
            toInsert.push(row);
        }
    }

    return { toInsert, skipped };
}
