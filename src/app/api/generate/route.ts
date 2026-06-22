import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

// Initialize the SDK. It automatically uses process.env.GEMINI_API_KEY if not provided,
// but we explicitly pass it here for clarity.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(request: Request) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json(
                { error: 'API key is missing. Please set GEMINI_API_KEY in your environment variables.' },
                { status: 500 }
            );
        }

        const { term, type } = await request.json();

        if (!term) {
            return NextResponse.json({ error: 'Term is required' }, { status: 400 });
        }

        if (!['meaning', 'example'].includes(type)) {
            return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
        }

        let prompt = '';
        if (type === 'meaning') {
            prompt = `あなたは優秀な英語講師です。英単語・熟語「${term}」の日本語における最も一般的で代表的な意味を1〜2つ、簡潔に教えてください。（出力は意味のみ。余計な説明や挨拶は不要。例: "妥協する、和解"）`;
        } else {
            prompt = `あなたは優秀な英語講師です。英単語・熟語「${term}」の難易度（日常レベルから学術・ビジネスレベル）に合わせた、「${term}」を使った自然な英語の例文を1つ作成してください。文脈が分かりやすく、実用的な文章にしてください。（出力は英語の例文のみ。挨拶や日本語訳は不要。）`;
        }

        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: prompt,
            config: {
                temperature: 0.2, // Low temperature for more deterministic output
            }
        });

        const text = response.text?.trim() || '';

        return NextResponse.json({ result: text });
    } catch (error) {
        console.error('Gemini API Error:', error);
        return NextResponse.json({ error: 'Failed to generate content' }, { status: 500 });
    }
}
