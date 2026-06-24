import { supabase } from "@/lib/supabase";
import { Vocab, Status } from "@/types/vocab";

// ─────────────────────────────────────────────────────────────────────────────
// 復習スケジュール：各ステータスの保持期間（日数）
// status 2 → 3日後に status 1 へ降格
// status 3 → 4日後に status 2 へ降格
// status 4 → 5日後に status 3 へ降格
// status 5 → 降格なし（永続）
// ─────────────────────────────────────────────────────────────────────────────
export const DECAY_DAYS: Partial<Record<Status, number>> = {
    2: 3,
    3: 4,
    4: 5,
};

/**
 * 次回降格期限を計算して ISO 文字列で返す。
 * @param status 更新後のステータス（降格期限をセットするステータス）
 */
export function calcReviewDueAt(status: Status): string | null {
    const days = DECAY_DAYS[status];
    if (days === undefined) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
}

/**
 * カードリストを走査し、Writing 以外で review_due_at が現在時刻を過ぎているカードを
 * ステータスを1つ下げてDBに反映する（非同期・バックグラウンド）。
 *
 * 連続降格にも対応：長期間放置されたカードは 1回のフェッチで段階的に計算する。
 * （例: status=4 のカードが 10日放置 → status=3 → status=2 とループで確定）
 *
 * @returns 降格処理適用後の最新のカードリスト
 */
export function processDecay(vocabs: Vocab[]): Vocab[] {
    const now = new Date();
    const updates: { id: string; status: Status; review_due_at: string | null }[] = [];

    const updated = vocabs.map((card) => {
        // Writing カテゴリは降格対象外
        if (card.category === "Writing") return card;

        let current = { ...card };

        // 連続降格ループ
        while (
            current.status >= 2 &&
            current.status <= 4 &&
            current.review_due_at !== null &&
            new Date(current.review_due_at) < now
        ) {
            const newStatus = (current.status - 1) as Status;
            // 降格後の次回期限を計算
            const newDueAt = calcReviewDueAt(newStatus);
            current = { ...current, status: newStatus, review_due_at: newDueAt };
        }

        // 元のカードから変化があればDB更新キューに追加
        if (current.status !== card.status || current.review_due_at !== card.review_due_at) {
            updates.push({
                id: current.id,
                status: current.status,
                review_due_at: current.review_due_at,
            });
        }

        return current;
    });

    // バックグラウンドで DB 更新（画面をブロックしない）
    if (updates.length > 0) {
        void Promise.all(
            updates.map(({ id, status, review_due_at }) =>
                supabase
                    .from("vocab")
                    .update({ status, review_due_at })
                    .eq("id", id)
            )
        );
    }

    return updated;
}


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
