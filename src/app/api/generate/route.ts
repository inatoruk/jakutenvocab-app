import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

// Initialize the SDK. It automatically uses process.env.GEMINI_API_KEY if not provided,
// but we explicitly pass it here for clarity.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(request: Request) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json(
                { error: 'APIキーが設定されていません。環境変数（GEMINI_API_KEY）を確認してください。' },
                { status: 500 }
            );
        }

        const { term, type } = await request.json();

        if (!term) {
            return NextResponse.json({ error: '単語が入力されていません。' }, { status: 400 });
        }

        if (!['meaning', 'example'].includes(type)) {
            return NextResponse.json({ error: '不正なリクエストタイプです。' }, { status: 400 });
        }

        let systemInstruction = '';
        let contents = '';

        if (type === 'meaning') {
            systemInstruction = 'あなたは優秀な英語講師です。出力は意味のみとし、挨拶、解説、思考プロセス、前置きなどの余計な文章は一切含めないでください。例: "妥協する、和解"';
            contents = `英単語・熟語「${term}」の日本語における最も一般的で代表的な意味を1〜2つ、簡潔に教えてください。`;
        } else {
            systemInstruction = 'あなたは優秀な英語講師です。英単語・熟語の難易度に合わせた自然な英語の例文を作成してください。文脈が分かりやすく、実用的な文章にしてください。出力は英語の例文のみとし、挨拶、日本語訳、思考プロセス、前置きなどは一切含めないでください。';
            contents = `英単語・熟語「${term}」を使った、自然な英語の例文を1つ作成してください。`;
        }

        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: contents,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.1, // Low temperature to minimize creative/unwanted text
            }
        });

        const text = response.text?.trim() || '';

        return NextResponse.json({ result: text });
    } catch (error: any) {
        console.error('Gemini API Error:', error);
        let errorMsg = 'AI生成中にエラーが発生しました。';
        const errorStr = String(error.message || error);
        if (errorStr.includes('429') || errorStr.includes('quota') || errorStr.includes('Quota')) {
            errorMsg = 'APIの利用制限（1分間15回まで）を超えました。1分ほど待ってから再度お試しください。';
        } else if (errorStr.includes('API_KEY_INVALID') || errorStr.includes('API key') || errorStr.includes('key is invalid')) {
            errorMsg = 'APIキーが無効です。正しいキーを設定してください。';
        }
        return NextResponse.json({ error: errorMsg }, { status: 500 });
    }
}
