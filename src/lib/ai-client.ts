let lastWarmupAt = -Infinity;

export function warmGenerationConnection(): void {
    const now = Date.now();
    if (now - lastWarmupAt < 10_000) return;
    lastWarmupAt = now;
    // User-triggered connection preparation only; no generation or polling.
    void fetch('/api/generate', { method: 'HEAD', cache: 'no-store' }).catch(() => {});
}

// Per-tab caches: never persist vocabulary or hints to browser storage.
const cache = new Map<string, { value: unknown; expiresAt: number }>();
const MAX_ENTRIES = 200;
const TTL_MS = 30 * 60 * 1000;

function getCached<T>(key: string): T | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return undefined;
    }
    return entry.value as T;
}

function putCached(key: string, value: unknown) {
    cache.delete(key);
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

export async function generateContent(
    payload: { term: string; type: 'meaning' | 'example'; level?: string },
    onText: (text: string) => void,
): Promise<string> {
    const key = JSON.stringify(['meaning-v1', payload.term.trim().toLowerCase()]);
    const cached = payload.type === 'meaning' ? getCached<string>(key) : undefined;
    if (cached !== undefined) {
        onText(cached);
        return cached;
    }
    const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '生成に失敗しました');
    }
    // Support the previous JSON endpoint while a deployment is rolling out.
    if (!response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
        const data = await response.json();
        if (!data.result) throw new Error('生成結果が空でした。もう一度お試しください。');
        onText(data.result);
        if (payload.type === 'meaning') putCached(key, data.result);
        return data.result;
    }
    if (!response.body) throw new Error('生成結果を受信できませんでした。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let text = '';
    let completed = false;
    const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as { delta?: string; done?: boolean; error?: string };
        if (event.error) throw new Error(event.error);
        if (event.delta) {
            text += event.delta;
            onText(text);
        }
        if (event.done) completed = true;
    };
    try {
        while (true) {
            const chunk = await reader.read();
            pending += decoder.decode(chunk.value, { stream: !chunk.done });
            let newline;
            while ((newline = pending.indexOf('\n')) !== -1) {
                consume(pending.slice(0, newline));
                pending = pending.slice(newline + 1);
            }
            if (chunk.done) break;
        }
        consume(pending);
        if (!completed || !text.trim()) throw new Error('生成が途中で終了しました。もう一度お試しください。');
        text = text.trim();
        onText(text);
        if (payload.type === 'meaning') putCached(key, text);
        return text;
    } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
    } finally {
        reader.releaseLock();
    }
}

export interface ParaphraseResult { isValid: boolean; hint: string }

export async function checkParaphrase(payload: {
    input: string; displayedTerm: string; meaning: string; context: string;
}): Promise<ParaphraseResult> {
    // Include the complete context: the same pair can be wrong in another sentence.
    const key = JSON.stringify(['paraphrase-v1', payload]);
    const cached = getCached<ParaphraseResult>(key);
    if (cached) return cached;
    const response = await fetch('/api/check-paraphrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'AI判定中にエラーが発生しました。');
    if (typeof data.isValid !== 'boolean' || typeof data.hint !== 'string') {
        throw new Error('AI判定の応答を読み取れませんでした。');
    }
    if (data.hint) putCached(key, data);
    return data;
}
