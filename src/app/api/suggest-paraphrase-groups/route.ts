import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(request: Request) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: 'APIキーが未設定です。' }, { status: 500 });
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseKey) {
            return NextResponse.json({ error: 'Supabase環境変数が未設定です。' }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. カテゴリが「Paraphrase」の単語データのみを取得
        const { data: vocabData, error: vocabError } = await supabase
            .from('vocab')
            .select('id, term, meaning, category')
            .eq('category', 'Paraphrase')
            .order('created_at', { ascending: true });

        if (vocabError) throw vocabError;
        const allVocab = vocabData || [];

        if (allVocab.length < 2) {
            return NextResponse.json({ suggestions: [] });
        }

        // 2. 既存のparaphrase_groupsデータを取得し、グループ済みのペアを把握
        const { data: groupData } = await supabase
            .from('paraphrase_groups')
            .select('vocab_id, group_id');

        const existingGroupMap: Record<string, string> = {};
        const existingGroupMembers: Record<string, string[]> = {};
        (groupData || []).forEach((row: { vocab_id: string; group_id: string }) => {
            existingGroupMap[row.vocab_id] = row.group_id;
            if (!existingGroupMembers[row.group_id]) existingGroupMembers[row.group_id] = [];
            existingGroupMembers[row.group_id].push(row.vocab_id);
        });

        // 3. AIへのリクエスト用に単語リストをJSON文字列化（グループ化状態フラグを付与）
        const vocabListForAI = allVocab.map(v => ({
            id: v.id,
            term: v.term,
            meaning: v.meaning,
            is_grouped: !!existingGroupMap[v.id]
        }));

        const prompt = `You are a TOEIC/IELTS vocabulary expert. 
Below is a JSON array of English vocabulary words with their IDs, Japanese meanings, and a boolean flag "is_grouped" indicating whether they are already in a paraphrase group.

Your task: Find groups of words (2 or more) that are paraphrases of each other — words that can be used interchangeably or have very similar meanings in a TOEIC/IELTS context.

Rules:
- Only group words that are genuinely interchangeable in meaning (synonyms or near-synonyms).
- Each group must have at least 2 words.
- Prioritize suggestions that involve ungrouped words (where "is_grouped" is false) so they can be grouped together or merged into existing groups.
- You can also suggest grouping/merging words that are already in different groups (where "is_grouped" is true) if their meanings align perfectly.
- Do NOT suggest grouping pairs of words that are ALREADY in the same group (see "already_grouped" below).
- Prioritize word pairs that are commonly tested as paraphrases in TOEIC/IELTS.
- Return ONLY the JSON array. No explanation, no markdown fences.

Already grouped (skip these combinations):
${JSON.stringify(Object.values(existingGroupMembers))}

Vocabulary list:
${JSON.stringify(vocabListForAI)}

Output format (strict JSON array of suggestion objects):
[
  {
    "reason": "Brief reason in Japanese (max 30 chars)",
    "vocab_ids": ["id1", "id2"]
  }
]

If no new paraphrase groups are found, return an empty array: []`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: prompt,
            config: { temperature: 0.2 }
        });

        const raw = response.text?.trim() || '[]';

        // JSONのみを抽出（マークダウンコードブロック対策）
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            return NextResponse.json({ suggestions: [] });
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // 4. 提案に単語情報を付与して返す
        const vocabMap: Record<string, { id: string; term: string; meaning: string }> = {};
        allVocab.forEach(v => { vocabMap[v.id] = v; });

        type AISuggestion = { vocab_ids: string[]; reason?: string };
        const suggestions = (parsed as AISuggestion[])
            .filter((s: AISuggestion) => Array.isArray(s.vocab_ids) && s.vocab_ids.length >= 2)
            .map((s: AISuggestion) => ({
                reason: s.reason || '',
                words: s.vocab_ids
                    .map((id: string) => vocabMap[id])
                    .filter(Boolean),
            }))
            .filter((s: { words: { id: string; term: string; meaning: string }[] }) => s.words.length >= 2);

        return NextResponse.json({ suggestions });

    } catch (error: unknown) {
        console.error('suggest-paraphrase-groups error:', error);
        return NextResponse.json({ error: 'AIによる提案中にエラーが発生しました。' }, { status: 500 });
    }
}
