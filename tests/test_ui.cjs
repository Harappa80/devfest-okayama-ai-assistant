const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
async function run(ttsFails = false, autoplayBlocked = false) {
    const elements = {};
    for (const id of ['text-input', 'send-button', 'character-image', 'voice-select', 'status', 'speech-audio', 'audio-status']) {
        elements[id] = { value: '', style: {}, handlers: {}, textContent: '', hidden: false,
            addEventListener(name, fn) { this.handlers[name] = fn; },
            replaceChildren() {}, removeAttribute() {}, pause() {},
            play: async () => { if (autoplayBlocked) throw new Error('autoplay blocked'); },
        };
    }
    const requests = [];
    let ready;
    vm.runInNewContext(fs.readFileSync('static/app.js', 'utf8'), {
        document: { getElementById: id => elements[id], addEventListener: (_, fn) => { ready = fn; } },
        window: { addEventListener() {} },
        Option: function (text, value) { this.value = value; },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        setInterval, clearInterval,
        fetch: async (url, options) => {
            if (url === '/config') return { ok: true, json: async () => ({ voices: ['Kore'], default_voice: 'Kore' }) };
            requests.push({ url, body: JSON.parse(options.body) });
            if (url === '/chat') return { ok: true, json: async () => ({ response: '<img src=x onerror=alert(1)>' }) };
            if (ttsFails) return { ok: false, json: async () => ({ detail: 'TTS unavailable' }) };
            return { ok: true, blob: async () => ({}) };
        },
    });
    await ready();
    elements['text-input'].value = 'こんにちは';
    await elements['send-button'].handlers.click();
    assert.equal(requests[0].url, '/chat');
    assert.equal(requests[1].url, '/tts');
    assert.equal(requests[1].body.voice, 'Kore');
    assert.equal(elements.status.textContent, '<img src=x onerror=alert(1)>');
    assert.equal(elements['send-button'].disabled, false);
    if (ttsFails) assert.match(elements['audio-status'].textContent, /TTS unavailable/);
    else assert.equal(elements['speech-audio'].hidden, false);
    if (autoplayBlocked) assert.match(elements['audio-status'].textContent, /再生ボタン/);
    elements['text-input'].value = '続けて';
    await elements['send-button'].handlers.click();
    assert.equal(requests[2].body.history.length, 2);
}
(async () => {
    await run(); await run(true); await run(false, true);
    console.log('UI checks passed: chat/history, TTS, literal text, TTS error, autoplay fallback.');
})();
