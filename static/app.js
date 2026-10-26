document.addEventListener('DOMContentLoaded', async () => {
    const textInput = document.getElementById('text-input');
    const sendButton = document.getElementById('send-button');
    const newChat = document.getElementById('new-chat');
    const characterImage = document.getElementById('character-image');
    const characterViewer = document.getElementById('character-viewer');
    const voiceSelect = document.getElementById('voice-select');
    const status = document.getElementById('status');
    const conversation = document.getElementById('conversation');
    const messages = document.getElementById('messages');
    const welcome = document.getElementById('welcome');
    const replyText = document.getElementById('reply-text');
    const replySources = document.getElementById('reply-sources');
    const historyDialog = document.getElementById('history-dialog');
    const greeting = replyText.textContent;
    const audio = document.getElementById('speech-audio');
    const audioPanel = document.getElementById('audio-panel');
    const audioStatus = document.getElementById('audio-status');
    const openMouthImg = '/static/images/char-mouth-open.png';
    const closedMouthImg = '/static/images/char-mouth-closed.png';
    const history = [];
    let busy = false;
    let lipSyncInterval;
    let audioUrl;

    const stopLipSync = () => {
        clearInterval(lipSyncInterval);
        characterImage.src = closedMouthImg;
        characterViewer.dataset.speaking = 'false';
    };
    audio.addEventListener('playing', () => {
        stopLipSync();
        characterViewer.dataset.speaking = 'true';
        let mouthOpen = false;
        lipSyncInterval = setInterval(() => {
            mouthOpen = !mouthOpen;
            characterImage.src = mouthOpen ? openMouthImg : closedMouthImg;
        }, 150);
    });
    ['pause', 'ended', 'error', 'waiting'].forEach(event => audio.addEventListener(event, stopLipSync));

    const clearAudio = () => {
        audio.pause();
        stopLipSync();
        audio.removeAttribute('src');
        audioPanel.hidden = true;
        audioStatus.textContent = '';
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = null;
    };
    const updateInput = () => {
        textInput.style.height = 'auto';
        textInput.style.height = `${Math.min(textInput.scrollHeight, 120)}px`;
        sendButton.disabled = busy || !textInput.value.trim();
    };
    const setBusy = value => {
        busy = value;
        textInput.disabled = voiceSelect.disabled = newChat.disabled = busy;
        status.dataset.busy = String(busy);
        updateInput();
    };
    const scrollToLatest = () => { conversation.scrollTop = conversation.scrollHeight; };
    const addMessage = (role, text) => {
        const message = document.createElement('article');
        message.className = `message ${role}`;
        const label = document.createElement('p');
        label.className = 'message-label';
        label.textContent = role === 'user' ? 'あなた' : 'AI Companion';
        const body = document.createElement('p');
        body.className = 'message-text';
        // Render user/model text literally, including any HTML-like content.
        body.textContent = text;
        message.append(label, body);
        messages.append(message);
        return message;
    };
    const addSources = (message, data) => {
        const sources = document.createElement('nav');
        sources.className = 'sources';
        sources.setAttribute('aria-label', '検索の出典');
        for (const source of data.sources || []) {
            let url;
            try { url = new URL(source.url); } catch { continue; }
            if (!['https:', 'http:'].includes(url.protocol)) continue;
            const link = document.createElement('a');
            link.href = url.href;
            link.textContent = source.title;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            sources.append(link);
        }
        if (sources.childElementCount) message.append(sources);
        if (data.grounding_html) {
            const suggestions = document.createElement('iframe');
            suggestions.className = 'search-suggestions';
            suggestions.title = 'Google Search suggestions';
            suggestions.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
            suggestions.srcdoc = data.grounding_html;
            message.append(suggestions);
        }
        return sources.childElementCount > 0 || Boolean(data.grounding_html);
    };
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
        const restoreFocus = document.activeElement === textInput;
        setBusy(true);
        clearAudio();
        welcome.hidden = true;
        status.dataset.error = 'false';
        status.textContent = '返答を考えています…';
        replyText.textContent = 'うーん、ちょっと考えています…';
        replySources.hidden = true;
        const userMessage = addMessage('user', message);
        const assistantMessage = addMessage('assistant pending', '考えています…');
        scrollToLatest();
        let replyReceived = false;
        try {
            const response = await post('/chat', { message, history });
            const data = await response.json();
            assistantMessage.classList.remove('pending');
            assistantMessage.querySelector('.message-text').textContent = data.response;
            replyText.textContent = data.response;
            replyText.scrollTop = 0;
            replySources.hidden = !addSources(assistantMessage, data);
            replyReceived = true;
            history.push({ role: 'user', text: message }, { role: 'model', text: data.response });
            history.splice(0, Math.max(0, history.length - 20));
            textInput.value = '';
            updateInput();
            scrollToLatest();
            status.textContent = '返答しました';
            audioStatus.textContent = '音声を生成しています…';
            const speech = await post('/tts', { text: data.response, voice: voiceSelect.value || 'Kore' });
            audioUrl = URL.createObjectURL(await speech.blob());
            audio.src = audioUrl;
            audioPanel.hidden = false;
            audioStatus.textContent = '';
            scrollToLatest();
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
                // Keep the draft for retry, without duplicate/failed turns in the log.
                userMessage.remove();
                assistantMessage.remove();
                welcome.hidden = messages.childElementCount > 0;
                status.dataset.error = 'true';
                status.textContent = error.message;
                replyText.textContent = 'うまく返答できませんでした。もう一度、送ってみてください。';
            }
        } finally {
            setBusy(false);
            if (restoreFocus && document.activeElement === document.body) textInput.focus({ preventScroll: true });
        }
    };

    sendButton.addEventListener('click', handleSendMessage);
    textInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            handleSendMessage();
        }
    });
    textInput.addEventListener('input', updateInput);
    const openHistory = () => {
        historyDialog.showModal();
        scrollToLatest();
    };
    document.getElementById('show-history').addEventListener('click', openHistory);
    replySources.addEventListener('click', openHistory);
    document.getElementById('close-history').addEventListener('click', () => historyDialog.close());
    document.querySelectorAll('[data-prompt]').forEach(button => {
        button.addEventListener('click', () => {
            textInput.value = button.dataset.prompt;
            updateInput();
            textInput.focus();
        });
    });
    newChat.addEventListener('click', () => {
        if (busy) return;
        history.length = 0;
        messages.replaceChildren();
        welcome.hidden = false;
        replyText.textContent = greeting;
        replySources.hidden = true;
        clearAudio();
        textInput.value = '';
        status.textContent = '会話をはじめましょう';
        status.dataset.error = 'false';
        updateInput();
        conversation.scrollTop = 0;
        textInput.focus();
    });
    window.addEventListener('beforeunload', clearAudio);

    try {
        const response = await fetch('/config');
        if (!response.ok) throw new Error('Voice configuration failed');
        const config = await response.json();
        voiceSelect.replaceChildren(...config.voices.map(voice => new Option(voice, voice)));
        voiceSelect.value = config.default_voice;
    } catch {
        audioStatus.textContent = '音声設定を取得できませんでした。ページを再読み込みしてください。';
    }
});
