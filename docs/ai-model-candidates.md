# 無料枠の代替モデル調査（2026-10-29）

公開サイトのモデル・キー・環境変数は変更していない。ユーザーは別モデルの比較を許可し、公開モデルの変更は別途了承を得る方針。0.2秒は未達。

## 今のGoogle APIキーで比較した結果

意味生成の最初の実テキストまで。応答キャッシュは使わず、思考やメタデータは数えていない。

| モデル | 結果 | 条件 |
| --- | --- | --- |
| gemini-3.5-flash-lite（現行） | 1.616秒・1.068秒 | 本番の意味プロンプト、2回 |
| gemini-3.1-flash-lite | 5.341秒・3.947秒 | 現行と同じ本番の意味プロンプト、2回 |
| gemini-2.5-flash-lite | 404、今のキーでは新規ユーザー向け利用不可 | 実際のAPI応答。一般的な全アカウントの提供終了と解釈しない |
| gemini-3.6-flash | 1.668秒 | 短い指示、minimal、1回 |
| gemini-3.8-flash | 30秒でタイムアウト | 短い指示、low、1回 |
| gemma-4-26b-a4b-it | systemInstruction形式では500、指示を本文へ移すと7.071秒 | 後者は内部思考296トークン。thinkingBudget=0は400（非対応） |
| gemma-4-31b-it | systemInstruction形式では500、指示を本文へ移しても30秒でタイムアウト | 各形式1回 |

Gemini 3.1 Flash-Liteと現行の2回ずつのみ同じプロンプト・同じ温度で比較。他候補は確認用の短いプロンプトを使っているため単純な速度順位にしない。Gemmaの500やタイムアウトは今回の呼び出し結果であり、モデル全般が使えないことを証明するものではない。呼び出し条件は上表、モデルごとの計測値とエラー応答は `docs/benchmarks/2026-10-29-model-candidates.json` に記録。

無料対象の確認: [Google公式料金表](https://ai.google.dev/gemini-api/docs/pricing)。Gemma 4は入出力とも無料、Gemini 3.1/2.5 Flash-Liteも無料枠対象。ただしアカウントの利用可否・上限は別で、2.5は今回のキーでは利用不可だった。

## 別サービスの候補

### Groq上の `openai/gpt-oss-20b`

次に実測する候補。専用の `GROQ_API_KEY` が必要で、今の作業フォルダには設定されていない。

- [公式モデル情報](https://console.groq.com/docs/model/openai/gpt-oss-20b)では出力約1,000 tokens/秒。ただしこれは最初の文字までの待ち時間ではない。
- [公式無料枠表](https://console.groq.com/docs/rate-limits)では毎分30要求、1日1,000要求、毎分8,000トークン、1日200,000トークン。実際のアカウント上限が優先。
- 同じ無料枠表には `qwen/qwen3.8-27b` と `openai/gpt-oss-120b` もある。日本語の意味・英語例文・言い換え判定の品質と、実際の最初の文字までの時間を比較する必要がある。
- キー未設定のため速度・品質は未計測。0.2秒達成を保証したり、Googleより速いと断定しない。
- キーは[Groq Console](https://console.groq.com/keys)で用意し、ローカルの `.env.local` に `GROQ_API_KEY` として入力する。チャットやGitには送らない。

### Cerebras

継続無料の候補から除外。[現在の公式FAQ](https://inference-docs.cerebras.ai/support/rate-limits)では、支払い方法を登録した新規アカウント向けの$5クレジット（30日期限）で、恒久的な無料枠はないと明記されている。過去の無料枠情報と混同しない。
