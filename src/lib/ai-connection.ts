// Warm the HTTPS connection without sending a prompt or an API key.
export async function warmAIConnection(): Promise<Response> {
    try {
        await fetch('https://generativelanguage.googleapis.com/', {
            method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(2000),
        });
    } catch {
        // Preparation is best effort and must not block generation.
    }
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
