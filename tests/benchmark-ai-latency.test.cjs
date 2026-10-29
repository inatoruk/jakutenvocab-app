const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readTextEvents } = require('../scripts/benchmark-ai-latency.cjs');
function response(text) {
    const bytes = new TextEncoder().encode(text);
    return new Response(new ReadableStream({ start(controller) {
        for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1));
        controller.close();
    } }));
}
test('benchmark ignores metadata, thoughts and whitespace, and decodes split Japanese', async () => {
    let callbacks = 0;
    const events = [
        { candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }] } }] },
        { candidates: [{ content: { parts: [{ text: ' ' }] } }] },
        { candidates: [{ content: { parts: [{ text: '確認' }] } }] },
        { candidates: [{ finishReason: 'STOP' }], usageMetadata: { thoughtsTokenCount: 2 } },
    ];
    const result = await readTextEvents(response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('')), 'generate', () => callbacks++);
    assert.equal(callbacks, 1); assert.equal(result.chars, 2); assert.equal(result.thoughtTokens, 2);
});
test('benchmark rejects partial/error streams instead of counting them as fast successes', async () => {
    for (const mode of ['production', 'generate', 'interactions']) {
        await assert.rejects(readTextEvents(response(mode === 'production' ? '{"delta":"途中"}\n' : 'data: {"event_type":"interaction.created"}\n\n'), mode, () => {}));
    }
    await assert.rejects(readTextEvents(response('{"error":"failed"}\n'), 'production', () => {}));
});
test('Interactions creation event does not count as first text', async () => {
    let callbacks = 0;
    const events = [ { event_type: 'interaction.created' },
        { event_type: 'step.delta', delta: { type: 'thought_summary', text: 'hidden' } },
        { event_type: 'step.delta', delta: { type: 'text', text: '確認する' } },
        { event_type: 'interaction.completed', interaction: { status: 'completed', usage: { total_thought_tokens: 0 } } },
    ];
    await readTextEvents(response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('')), 'interactions', () => callbacks++);
    assert.equal(callbacks, 1);
});
