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

        const { term, type, level } = await request.json();

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
            temperature = 0.7;
        } else if (type === 'example') {
            // ベースプロンプト（難易度への言及は削除。レベル別制約で制御する）
            let baseInstruction = 'あなたは優秀な英語講師です。自然な英語の例文を作成してください。文脈が分かりやすく、実用的な文章にしてください。対象の単語・熟語の形（時制、単複、品詞など）は、最も一般的で自然な使われ方に適宜変形して使用して構いません。出力は英語の例文のみとし、挨拶、日本語訳、思考プロセス、前置きなどは一切含めないでください。毎回異なる視点や状況を想定し、バリエーション豊かな例文を出力してください。';

            // レベル別制約（ユーザーが選択したレベルに応じて動的に追加）
            let levelInstruction = '';
            if (level === 'beginner') {
                levelInstruction = '\n【レベル制約: 初級】\n文法は中学英語レベルの基本的なもの（SV、SVC、SVOなど）を用い、使われる単語も日常的な基礎語彙に限定してください。例文は理解しやすさを最優先とし、必ず1文のみの短くシンプルな文章にしてください。';
            } else if (level === 'advanced') {
                levelInstruction = '\n【レベル制約: 上級】\nTOEIC 800点以上やIELTS 6.5以上で使われるような、高度なビジネス語彙や学術的な表現、無生物主語や関係詞・分詞構文などの複雑な構文を積極的に使用してください。必ず1文のみで構成し、自然で洗練された表現にしてください。';
            } else {
                // intermediate（デフォルト）
                levelInstruction = '\n【レベル制約: 中級】\n高校英語レベルの標準的な文法と語彙を使用してください。必ず1文のみで構成された、分かりやすい文章にしてください。';
            }

            systemInstruction = baseInstruction + levelInstruction;
            const situations = [
                // TOEIC最頻出シチュエーション 5選
                '社内メールでの業務連絡や、同僚とのミーティングでの進捗共有・業務調整',
                '取引先との商談・契約交渉、または顧客からの問い合わせ・クレーム対応のやり取り',
                '新商品・新サービスの発表、セール・割引宣伝などのマーケティング広報',
                'オフィスのITトラブル相談、オフィス機器のメンテナンス、または備品の発注・管理',
                'ホテル・レストランの予約や、空港・駅での運行遅延などのアナウンス（旅行・出張）',
                
                // IELTS最頻出シチュエーション（キャンパスライフ・留学・一般生活） 5選
                '大学の講義や学術的なセミナーでの、科学・自然環境・歴史などに関する解説や議論',
                '大学の履修登録、奨学金申請、図書館利用など、キャンパス内の学生窓口での相談手続き',
                '大学のゼミにおけるグループ発表や共同研究プロジェクトでの役割分担や計画決定の議論',
                '海外留学や赴任生活におけるアパートの賃貸契約手続きや銀行口座の開設手続き',
                '地域のコミュニティ活動やボランティア活動への参加案内、地域のイベント紹介アナウンス',

                // IELTS最頻出シチュエーション（リーディング・ライティングの学術・社会論説） 5選
                '気候変動、再生可能エネルギー、または生態系保全などの「環境問題や持続可能性」に関する科学的な解説・レポート',
                '人工知能（AI）の普及、自動化、またはデジタル技術が「労働市場や社会生活」に与える影響に関する論説・意見書',
                '高等教育の役割、子供の早期教育、またはオンライン学習の是非などの「教育・発達・キャリア」に関する議論・考察',
                '現代人の生活習慣病、精神的ストレス、または予防医療や医療費負担などの「健康・公共福祉」に関する分析・提言',
                '急速な都市化、公共交通インフラ整備、またはグローバル化に伴う「都市環境や伝統文化保護」に関する学術コラム'
            ];
            const randomSituation = situations[Math.floor(Math.random() * situations.length)];
            contents = `英単語・熟語「${term}」を使った、自然な英語の例文を1つ作成してください。\n\n【条件】\n想定シチュエーション: ${randomSituation}`;
            temperature = 0.9; // 高めの温度とシチュエーション指定で多様性を出す
        }

        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
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
