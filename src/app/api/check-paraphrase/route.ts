import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(request: Request) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: 'APIキーが未設定です。' }, { status: 500 });
        }

        const { input, displayedTerm, meaning, context } = await request.json();

        if (!input || !displayedTerm) {
            return NextResponse.json({ error: 'パラメータが不足しています。' }, { status: 400 });
        }

        const contextLine = context ? `例文: "${context}"` : '';

        const prompt = `You are an IELTS vocabulary expert.

The student is shown the word "${displayedTerm}" (meaning: "${meaning}") and asked to input a paraphrase.
The student entered: "${input}"
${contextLine}

Task 1: Is "${input}" a valid paraphrase of "${displayedTerm}" in this context? Answer strictly "YES" or "NO" on the first line.
Task 2: Provide a single short IELTS-focused tip in Japanese (1-2 sentences, max 60 chars) about the relationship between "${displayedTerm}" and "${input}", focusing on formality, collocation, or IELTS score impact. If Task 1 is NO, briefly explain why.

Output format (exactly 2 lines):
YES
<tip in Japanese>`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
            contents: prompt,
            config: { temperature: 0.3 }
        });

        const raw = response.text?.trim() || '';
        const lines = raw.split('\n').map((l: string) => l.trim()).filter(Boolean);
        
        // Clean up the first line (remove punctuation/formatting) to check for YES/NO
        const firstLineClean = lines[0]?.replace(/[^a-zA-Z]/g, '').toUpperCase() || '';
        const isValid = firstLineClean === 'YES';
        
        // Preserve all lines after the first line as the hint
        const hint = lines.slice(1).join('\n');

        return NextResponse.json({ isValid, hint });
    } catch (error: unknown) {
        console.error('check-paraphrase error:', error);
        return NextResponse.json({ error: 'AI判定中にエラーが発生しました。' }, { status: 500 });
    }
}
