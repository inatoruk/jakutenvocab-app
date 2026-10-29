const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, overrides = {}) {
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const context = {
        exports: {}, Response, Request, ReadableStream, TextEncoder, TextDecoder,
        AbortController, performance, console: { info() {} },
        process: { env: { GEMINI_API_KEY: 'test-only' } }, ...overrides,
    };
    vm.runInNewContext(code, context);
    return context.exports;
}
function streamed(events) {
    const bytes = new TextEncoder().encode(events.map(e => JSON.stringify(e) + '\n').join(''));
    // Split within UTF-8 characters and within JSON records.
    return new Response(new ReadableStream({ start(c) {
        for (let i = 0; i < bytes.length; i += 2) c.enqueue(bytes.slice(i, i + 2));
        c.close();
    } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}
function request(stream = true) {
    return new Request('http://localhost/api/generate', { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(stream ? { Accept: 'application/x-ndjson' } : {}) },
        body: JSON.stringify({ term: 'confirm', type: 'meaning' }),
    });
}
function route(models) {
    return load('src/app/api/generate/route.ts', { require: name => {
        if (name === '@google/genai') return { GoogleGenAI: class { models = models; } };
        if (name === 'next/server') return { NextResponse: Response };
        throw new Error(name);
    } });
}

test('streams Japanese correctly and reuses meanings without another network request', async () => {
    let calls = 0;
    const client = load('src/lib/ai-client.ts', { fetch: async () => {
        calls++;
        return streamed([{ delta: '確認' }, { delta: 'する' }, { done: true }]);
    } });
    const updates = [];
    const payload = { term: 'Confirm', type: 'meaning' };
    assert.equal(await client.generateContent(payload, text => updates.push(text)), '確認する');
    assert.ok(updates.includes('確認'));
    assert.equal(await client.generateContent({ ...payload, term: 'confirm' }, () => {}), '確認する');
    assert.equal(calls, 1);
});

test('examples are freshly generated on every request', async () => {
    let calls = 0;
    const client = load('src/lib/ai-client.ts', { fetch: async () => {
        calls++;
        return streamed([{ delta: `Example ${calls}.` }, { done: true }]);
    } });
    const payload = { term: 'confirm', type: 'example', level: 'advanced' };
    assert.equal(await client.generateContent(payload, () => {}), 'Example 1.');
    assert.equal(await client.generateContent(payload, () => {}), 'Example 2.');
});

test('partial, failed and empty streams are rejected and never cached', async () => {
    for (const events of [ [{ delta: '途中' }], [{ delta: '途中' }, { error: '失敗' }], [{ done: true }] ]) {
        let calls = 0;
        const client = load('src/lib/ai-client.ts', { fetch: async () => { calls++; return streamed(events); } });
        for (let i = 0; i < 2; i++) {
            await assert.rejects(client.generateContent({ term: 'confirm', type: 'meaning' }, () => {}));
        }
        assert.equal(calls, 2);
    }
});

test('supports JSON responses during rollout and handles HTTP errors', async () => {
    const client = load('src/lib/ai-client.ts', { fetch: async () => Response.json({ result: '確認する' }) });
    assert.equal(await client.generateContent({ term: 'confirm', type: 'meaning' }, () => {}), '確認する');
    const failing = load('src/lib/ai-client.ts', { fetch: async () => Response.json({ error: '制限' }, { status: 429 }) });
    await assert.rejects(failing.generateContent({ term: 'confirm', type: 'meaning' }, () => {}), /制限/);
});

test('paraphrase cache distinguishes context and caches false judgments too', async () => {
    let calls = 0;
    const client = load('src/lib/ai-client.ts', { fetch: async () => {
        calls++; return Response.json({ isValid: false, hint: 'この文脈では使えません。' });
    } });
    const payload = { input: 'verify', displayedTerm: 'confirm', meaning: '確認する', context: 'first' };
    await client.checkParaphrase(payload);
    await client.checkParaphrase(payload);
    assert.equal(calls, 1);
    await client.checkParaphrase({ ...payload, context: 'second' });
    assert.equal(calls, 2);
});

test('cache expires and has a bounded size', async () => {
    let now = 0, calls = 0;
    const client = load('src/lib/ai-client.ts', { Date: { now: () => now }, fetch: async () => {
        calls++; return Response.json({ result: '意味' });
    } });
    const payload = { term: 'first', type: 'meaning' };
    await client.generateContent(payload, () => {});
    now = 31 * 60 * 1000;
    await client.generateContent(payload, () => {});
    assert.equal(calls, 2);
    for (let i = 0; i < 200; i++) await client.generateContent({ term: `term${i}`, type: 'meaning' }, () => {});
    await client.generateContent(payload, () => {});
    assert.equal(calls, 203);
});

test('route sends first text before upstream generation finishes', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const api = route({ generateContentStream: async function* () {
        yield { text: '確認' };
        await gate;
        yield { text: 'する' };
    } });
    const res = await api.POST(request());
    assert.match(res.headers.get('Content-Type'), /x-ndjson/);
    const reader = res.body.getReader();
    assert.deepEqual(JSON.parse(new TextDecoder().decode((await reader.read()).value)), { delta: '確認' });
    release();
    let rest = '';
    while (true) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
    assert.match(rest, /"done":true/);
});

test('route reports upstream failures as stream errors without a success marker', async () => {
    const api = route({ generateContentStream: async function* () {
        yield { text: '途中' };
        throw new Error('429 quota');
    } });
    const text = await (await api.POST(request())).text();
    assert.match(text, /利用制限/);
    assert.doesNotMatch(text, /"done":true/);
});

test('route retains JSON compatibility and exposes elapsed timing', async () => {
    const api = route({ generateContent: async () => ({ text: '確認する' }) });
    const res = await api.POST(request(false));
    assert.deepEqual(await res.json(), { result: '確認する' });
    assert.match(res.headers.get('Server-Timing'), /gemini;dur=/);
});
