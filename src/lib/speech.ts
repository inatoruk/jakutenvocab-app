const VOICE_PREFERENCE = [
    "Google US English",    // Chrome
    "Samantha",             // macOS Safari
    "Evan",                 // iOS 17+ Safari
    "Daniel",               // macOS Safari (British)
];

let cachedVoices: SpeechSynthesisVoice[] = [];

function loadVoices() {
    const available = speechSynthesis.getVoices();
    if (available.length > 0) {
        cachedVoices = available;
    }
}

// ブラウザ起動時にボイスをプリロード
if (typeof window !== "undefined" && window.speechSynthesis) {
    loadVoices();
    speechSynthesis.addEventListener("voiceschanged", loadVoices);
}

function pickVoice(): SpeechSynthesisVoice | null {
    const voices = cachedVoices.length > 0 ? cachedVoices : speechSynthesis.getVoices();

    // 優先リストから順に探す
    for (const name of VOICE_PREFERENCE) {
        const v = voices.find((voice) => voice.name === name);
        if (v) return v;
    }

    // フォールバック: en- で始まるボイスを探す
    return voices.find((v) => v.lang.startsWith("en")) ?? null;
}

export function speak(text: string) {
    if (!text.trim()) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
}
