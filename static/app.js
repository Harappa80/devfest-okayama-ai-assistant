document.addEventListener('DOMContentLoaded', async () => {
    const textInput = document.getElementById('text-input');
    const sendButton = document.getElementById('send-button');
    const characterImage = document.getElementById('character-image');
    const voiceSelect = document.getElementById('voice-select');
    const status = document.getElementById('status');
    const audio = document.getElementById('speech-audio');
    const audioStatus = document.getElementById('audio-status');
    const sources = document.getElementById('sources');
    const searchSuggestions = document.getElementById('search-suggestions');
    const openMouthImg = '/static/images/char-mouth-open.png';
    const closedMouthImg = '/static/images/char-mouth-closed.png';
    const history = [];
    let busy = false;
    let lipSyncInterval;
    let audioUrl;

    const stopLipSync = () => {
        clearInterval(lipSyncInterval);
        characterImage.src = closedMouthImg;
    };
    audio.addEventListener('playing', () => {
        stopLipSync();
        let mouthOpen = false;
        lipSyncInterval = setInterval(() => {
            mouthOpen = !mouthOpen;
            characterImage.src = mouthOpen ? openMouthImg : closedMouthImg;
        }, 150);
    });
    ['pause', 'ended', 'error', 'waiting'].forEach(event => audio.addEventListener(event, stopLipSync));

    try {
        const response = await fetch('/config');
        if (!response.ok) throw new Error('Voice configuration failed');
        const config = await response.json();
        voiceSelect.replaceChildren(...config.voices.map(voice => new Option(voice, voice)));
        voiceSelect.value = config.default_voice;
    } catch (error) {
        audioStatus.textContent = '音声設定を取得できませんでした。ページを再読み込みしてください。';
    }

    const post = async (path, body) => {
        const response = await fetch(path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(typeof error.detail === 'string' ? error.detail : 'リクエストに失敗しました。');
        }
        return response;
    };

    const handleSendMessage = async () => {
        const message = textInput.value.trim();
        if (!message || busy) return;
        busy = true;
        sendButton.disabled = true;
        textInput.disabled = true;
        voiceSelect.disabled = true;
        audio.pause();
        audio.removeAttribute('src');
        audio.hidden = true;
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioStatus.textContent = '';
        status.textContent = 'Thinking...';
        if (sources) sources.replaceChildren();
        if (searchSuggestions) { searchSuggestions.hidden = true; searchSuggestions.srcdoc = ''; }
        let replyReceived = false;
        try {
            const response = await post('/chat', { message, history });
            const data = await response.json();
            // Render model text literally, including any HTML-like content.
            status.textContent = data.response;
            if (sources) {
                for (const source of data.sources || []) {
                    const url = new URL(source.url);
                    if (!['https:', 'http:'].includes(url.protocol)) continue;
                    const link = document.createElement('a');
                    link.href = url.href;
                    link.textContent = source.title;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    sources.append(link);
                }
            }
            if (searchSuggestions && data.grounding_html) {
                searchSuggestions.srcdoc = data.grounding_html;
                searchSuggestions.hidden = false;
            }
            replyReceived = true;
            history.push({ role: 'user', text: message }, { role: 'model', text: data.response });
            history.splice(0, Math.max(0, history.length - 20));
            textInput.value = '';
            textInput.style.height = '50px';
            audioStatus.textContent = '音声を生成しています…';
            const speech = await post('/tts', { text: data.response, voice: voiceSelect.value || 'Kore' });
            audioUrl = URL.createObjectURL(await speech.blob());
            audio.src = audioUrl;
            audio.hidden = false;
            audioStatus.textContent = '';
            try {
                await audio.play();
            } catch {
                audioStatus.textContent = '再生ボタンを押して音声を再生してください。';
            }
        } catch (error) {
            stopLipSync();
            if (replyReceived) {
                audioStatus.textContent = `音声を生成できませんでした: ${error.message}`;
            } else {
                status.textContent = error.message;
            }
        } finally {
            busy = false;
            sendButton.disabled = false;
            textInput.disabled = false;
            voiceSelect.disabled = false;
        }
    };

    sendButton.addEventListener('click', handleSendMessage);
    textInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            handleSendMessage();
        }
    });
    textInput.addEventListener('input', () => {
        textInput.style.height = 'auto';
        textInput.style.height = `${textInput.scrollHeight}px`;
    });
    window.addEventListener('beforeunload', () => {
        audio.pause();
        stopLipSync();
        if (audioUrl) URL.revokeObjectURL(audioUrl);
    });
});
