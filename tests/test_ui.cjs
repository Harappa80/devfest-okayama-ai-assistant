const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
async function run(ttsFails = false, autoplayBlocked = false) {
    const element = () => ({
        value: '', style: {}, dataset: {}, handlers: {}, textContent: '', children: [], hidden: false,
        classList: { remove() {} },
        get childElementCount() { return this.children.length; },
        addEventListener(name, fn) { this.handlers[name] = fn; },
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = nodes; },
        querySelector() { return this.children[1]; },
        setAttribute() {}, removeAttribute() {}, pause() {}, focus() {},
        play: async () => { if (autoplayBlocked) throw new Error('autoplay blocked'); },
    });
    const elements = Object.fromEntries([
        'text-input', 'send-button', 'new-chat', 'character-image', 'voice-select', 'status',
        'conversation', 'messages', 'welcome', 'speech-audio', 'audio-panel', 'audio-status',
        'character-viewer', 'reply-text', 'reply-sources', 'history-dialog', 'show-history', 'close-history',
    ].map(id => [id, element()]));
    const requests = [];
    let ready;
    vm.runInNewContext(fs.readFileSync('static/app.js', 'utf8'), {
        document: { getElementById: id => elements[id], createElement: element,
            querySelectorAll: () => [], addEventListener: (_, fn) => { ready = fn; } },
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
    assert.equal(elements.messages.children[0].children[1].textContent, 'こんにちは');
    assert.equal(elements.messages.children[1].children[1].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(elements['reply-text'].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(elements['text-input'].disabled, false);
    assert.equal(elements['send-button'].disabled, true, 'Empty draft must not send');
    if (ttsFails) assert.match(elements['audio-status'].textContent, /TTS unavailable/);
    else assert.equal(elements['audio-panel'].hidden, false);
    if (autoplayBlocked) assert.match(elements['audio-status'].textContent, /再生ボタン/);
    elements['text-input'].value = '続けて';
    await elements['send-button'].handlers.click();
    assert.equal(requests[2].body.history.length, 2);
    assert.equal(elements.messages.children.length, 4);
    elements['new-chat'].handlers.click();
    assert.equal(elements.messages.children.length, 0);
    assert.equal(elements.welcome.hidden, false);
    assert.equal(elements['audio-panel'].hidden, true);
    elements['text-input'].value = '新しい話題';
    await elements['send-button'].handlers.click();
    assert.equal(requests[4].body.history.length, 0);
}
(async () => {
    await run(); await run(true); await run(false, true);
    console.log('UI checks passed: transcript, history/reset, TTS, literal text, TTS error, autoplay fallback.');
})();
