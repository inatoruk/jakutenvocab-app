// node scripts/benchmark-ai-latency.cjs --mode production --samples 3
// Direct API modes use .env.local; secrets and generated text are never logged.
const { parseArgs } = require('node:util');
const fs = require('node:fs');

async function readTextEvents(response, mode, onText) {
    if (!response.body) throw new Error('Missing response body');
    const decoder = new TextDecoder();
    let pending = '', complete = false, chars = 0;
    let finishReason, thoughtTokens;
    function consume(line) {
        line = line.trim();
        if (!line) return;
        if (mode !== 'production') {
            if (!line.startsWith('data:')) return;
            line = line.slice(5).trim();
            if (line === '[DONE]') return;
        }
        const event = JSON.parse(line);
        if (event.error || event.event_type === 'error') throw new Error('Generation error');
        const text = (value) => {
            if (typeof value === 'string' && value.trim()) { chars += value.length; onText(); }
        };
        if (mode === 'production') {
            text(event.delta);
            if (event.done) complete = true;
        } else if (mode === 'interactions') {
            if (event.event_type === 'step.delta' && event.delta?.type === 'text') text(event.delta.text);
            if (event.event_type === 'interaction.completed') {
                complete = event.interaction?.status === undefined || event.interaction.status === 'completed';
                if (event.interaction?.usage) thoughtTokens = event.interaction.usage.total_thought_tokens || 0;
            }
        } else {
            for (const part of event.candidates?.[0]?.content?.parts || []) if (!part.thought) text(part.text);
            finishReason = event.candidates?.[0]?.finishReason || finishReason;
            if (finishReason === 'STOP') complete = true;
            if (event.usageMetadata) thoughtTokens = event.usageMetadata.thoughtsTokenCount || 0;
        }
    }
    for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
            consume(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        }
    }
    pending += decoder.decode();
    consume(pending);
    if (!complete || !chars) throw new Error('Incomplete or empty generation');
    return { complete, chars, finishReason, thoughtTokens };
}

async function main() {
    const { values } = parseArgs({ options: {
        mode: { type: 'string', default: 'production' },
        samples: { type: 'string', default: '3' },
        url: { type: 'string', default: 'https://jakuten-vocab.vercel.app' },
        output: { type: 'string' },
        'target-ms': { type: 'string', default: '200' },
    } });
    const mode = values.mode, samples = Number(values.samples), targetMs = Number(values['target-ms']);
    if (!['production', 'generate', 'interactions'].includes(mode)) throw new Error('Invalid mode');
    if (!Number.isInteger(samples) || samples < 1 || samples > 10) throw new Error('samples must be 1–10');
    if (!Number.isFinite(targetMs) || targetMs <= 0) throw new Error('Invalid target');
    if (mode !== 'production') {
        if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
        if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');
    }
    const words = ['authorize', 'coordinate', 'anticipate', 'comply', 'delegate', 'estimate', 'notify', 'suspend', 'withdraw', 'retain'];
    const rows = [];
    for (const term of words.slice(0, samples)) {
        const prompt = `Translate "${term}" into Japanese. Output only one common translation.`;
        const startedAt = performance.now();
        let firstTextMs;
        const production = mode === 'production', interactions = mode === 'interactions';
        const url = production ? new URL('/api/generate', values.url) :
            'https://generativelanguage.googleapis.com/v1beta/' + (interactions ? 'interactions?alt=sse' :
                'models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse');
        const body = production ? { term, type: 'meaning' } : interactions ? {
            model: 'gemini-3.5-flash-lite', input: prompt, store: false, stream: true,
            generation_config: { thinking_level: 'minimal', temperature: 0.7 },
        } : { contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, thinkingConfig: { thinkingLevel: 'minimal' } } };
        try {
            const response = await fetch(url, { method: 'POST', headers: {
                'Content-Type': 'application/json', Accept: production ? 'application/x-ndjson' : 'text/event-stream',
                ...(production ? {} : { 'x-goog-api-key': process.env.GEMINI_API_KEY }),
            }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
            const headersMs = performance.now() - startedAt;
            if (!response.ok) {
                rows.push({ term, status: response.status, error: 'HTTP error' });
                // Respect quota and service errors; never hide them with retries.
                break;
            }
            const info = await readTextEvents(response, mode, () => { firstTextMs ??= performance.now() - startedAt; });
            const row = { term, ...info, firstTextMs: Number(firstTextMs.toFixed(3)), headersMs: Math.round(headersMs),
                totalMs: Math.round(performance.now() - startedAt), region: response.headers.get('x-vercel-id') };
            rows.push(row); console.log(JSON.stringify(row));
        } catch (error) {
            rows.push({ term, error: error.name || 'Error' }); break;
        }
    }
    const times = rows.filter(r => r.complete).map(r => r.firstTextMs).sort((a, b) => a - b);
    const report = { recordedAt: new Date().toISOString(), model: 'gemini-3.5-flash-lite', mode,
        metric: 'request start to first non-whitespace model text (not rendered paint)', targetMs,
        samplesRequested: samples, samplesCompleted: times.length, minMs: times[0],
        medianMs: times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : undefined, maxMs: times.at(-1),
        targetMetInAllSamples: times.length === samples && times.every(t => t <= targetMs), rows };
    if (values.output) fs.writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
}
module.exports = { readTextEvents };
if (require.main === module) main().catch(error => { console.error(error.name || 'Error'); process.exitCode = 1; });
