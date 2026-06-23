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
        let temperature = 0.5;

        if (type === 'meaning') {
            systemInstruction = 'あなたは優秀な英語講師です。出力は意味のみとし、挨拶、解説、思考プロセス、前置きなどの余計な文章は一切含めないでください。例: "妥協する、和解"';
            contents = `英単語・熟語「${term}」の日本語における最も一般的で代表的な意味を1〜2つ、簡潔に教えてください。`;
            temperature = 0.5;
        } else if (type === 'example') {
            systemInstruction = 'あなたは優秀な英語講師です。英単語・熟語の難易度に合わせた自然な英語の例文を作成してください。文脈が分かりやすく、実用的な文章にしてください。対象の単語・熟語の形（時制、単複、品詞など）は、最も一般的で自然な使われ方に適宜変形して使用して構いません。出力は英語の例文のみとし、挨拶、日本語訳、思考プロセス、前置きなどは一切含めないでください。毎回異なる視点や状況を想定し、バリエーション豊かな例文を出力してください。';
            const situations = [
                // TOEIC最頻出シチュエーション 5選
                '社内メールでの業務連絡や、同僚とのミーティングでの進捗共有・業務調整',
                '取引先との商談・契約交渉、または顧客からの問い合わせ・クレーム対応のやり取り',
                '新商品・新サービスの発表、セール・割引宣伝などのマーケティング広報',
                'オフィスのITトラブル相談、オフィス機器のメンテナンス、または備品の発注・管理',
                'ホテル・レストランの予約や、空港・駅での運行遅延などのアナウンス（旅行・出張）',
                
                // IELTS最頻出シチュエーション 5選
                '大学の講義や学術的なセミナーでの、科学・自然環境・歴史などに関する解説や議論',
                '大学の履修登録、奨学金申請、図書館利用など、キャンパス内の学生窓口での相談手続き',
                '大学のゼミにおけるグループ発表や共同研究プロジェクトでの役割分担や計画決定の議論',
                '海外留学や赴任生活におけるアパートの賃貸契約手続きや銀行口座の開設手続き',
                '地域のコミュニティ活動やボランティア活動への参加案内、地域のイベント紹介アナウンス'
            ];
            const randomSituation = situations[Math.floor(Math.random() * situations.length)];
            contents = `英単語・熟語「${term}」を使った、自然な英語の例文を1つ作成してください。\n\n【条件】\n想定シチュエーション: ${randomSituation}`;
            temperature = 0.9; // 高めの温度とシチュエーション指定で多様性を出す
        }

        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: contents,
            config: {
                systemInstruction: systemInstruction,
                temperature: temperature,
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
