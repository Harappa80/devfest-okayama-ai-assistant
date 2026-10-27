const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
async function run(ttsFails = false, autoplayBlocked = false, stalled = false) {
    const elements = {};
    for (const id of ['text-input', 'send-button', 'character-image', 'character-viewer', 'voice-select', 'status', 'reply-text', 'speech-audio', 'audio-status', 'play-audio']) {
        elements[id] = { value: '', style: {}, dataset: {}, handlers: {}, textContent: '', hidden: false,
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
        setInterval, clearInterval, AbortController, clearTimeout,
        setTimeout: stalled ? (fn) => setTimeout(fn, 0) : setTimeout,
        fetch: async (url, options) => {
            if (url === '/config') return { ok: true, json: async () => ({ voices: ['Kore'], default_voice: 'Kore' }) };
            requests.push({ url, body: JSON.parse(options.body) });
            if (stalled) return { ok: true, json: () => new Promise((resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(new Error('aborted')));
            }) };
            if (url === '/chat') return { ok: true, json: async () => ({ response: '<img src=x onerror=alert(1)>' }) };
            assert.equal(elements['reply-text'].textContent, 'うーん、ちょっと考えています…', 'Reply stays hidden while generating audio');
            assert.equal(elements.status.textContent, '音声を生成しています…');
            if (ttsFails) return { ok: false, json: async () => ({ detail: 'TTS unavailable' }) };
            return { ok: true, blob: async () => {
                await Promise.resolve();
                assert.equal(elements['reply-text'].textContent, 'うーん、ちょっと考えています…', 'Wait until the audio body is available');
                return {};
            } };
        },
    });
    await ready();
    elements['text-input'].value = 'こんにちは';
    await elements['send-button'].handlers.click();
    if (stalled) {
        assert.match(elements.status.textContent, /応答が時間内に届きませんでした/);
        assert.equal(elements['text-input'].disabled, false);
        assert.equal(elements['send-button'].disabled, false);
        assert.equal(elements['text-input'].value, 'こんにちは');
        return;
    }
    assert.equal(requests[0].url, '/chat');
    assert.equal(requests[1].url, '/tts');
    assert.equal(requests[1].body.voice, 'Kore');
    assert.equal(elements['reply-text'].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(elements['text-input'].disabled, false);
    assert.equal(elements['send-button'].disabled, true);
    if (ttsFails) {
        assert.match(elements['audio-status'].textContent, /TTS unavailable/);
        assert.equal(elements.status.textContent, 'テキストで返答しました');
    }
    else assert.equal(elements['play-audio'].hidden, !autoplayBlocked);
    if (autoplayBlocked) {
        assert.match(elements['audio-status'].textContent, /再生ボタン/);
        autoplayBlocked = false;
        await elements['play-audio'].handlers.click();
        assert.equal(elements['play-audio'].hidden, true, 'Manual action disappears after playback starts');
    }
    elements['text-input'].value = '続けて';
    await elements['send-button'].handlers.click();
    assert.equal(requests[2].body.history.length, 2);
}
(async () => {
    await run(); await run(true); await run(false, true); await run(false, false, true);
    console.log('UI checks passed: chat/history, TTS, literal text, TTS error, autoplay fallback.');
})();
