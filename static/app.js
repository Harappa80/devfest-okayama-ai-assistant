document.addEventListener('DOMContentLoaded', () => {
    const textInput = document.getElementById('text-input');
    const sendButton = document.getElementById('send-button');
    const characterImage = document.getElementById('character-image');
    const voiceSelect = document.getElementById('voice-select');
    const status = document.getElementById('status');

    const openMouthImg = '/static/images/char-mouth-open.png';
    const closedMouthImg = '/static/images/char-mouth-closed.png';

    let voices = [];
    let lipSyncInterval;
    let typewriterTimeout;
    const speechAvailable = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

    function populateVoiceList() {
        voices = speechAvailable ? speechSynthesis.getVoices() : [];
        voiceSelect.innerHTML = '';
        voiceSelect.disabled = voices.length === 0;

        let japaneseVoiceIndex = -1;

        voices.forEach((voice, i) => {
            const option = document.createElement('option');
            option.textContent = `${voice.name} (${voice.lang})`;
            option.setAttribute('data-lang', voice.lang);
            option.setAttribute('data-name', voice.name);
            voiceSelect.appendChild(option);

            if (voice.lang === 'ja-JP') {
                if (japaneseVoiceIndex === -1) {
                    japaneseVoiceIndex = i;
                }
            }
        });

        if (japaneseVoiceIndex !== -1) {
            voiceSelect.selectedIndex = japaneseVoiceIndex;
        }
    }

    populateVoiceList();
    if (speechAvailable && speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = populateVoiceList;
    }

    const typewriter = (text, element, speed = 50) => {
        clearTimeout(typewriterTimeout);
        // Use Intl.Segmenter to handle grapheme clusters correctly
        if (window.Intl && Intl.Segmenter) {
            const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
            const segments = Array.from(segmenter.segment(text)).map(s => s.segment);
            
            let i = 0;
            element.textContent = "";

            function type() {
                if (i < segments.length) {
                    element.textContent += segments[i];
                    i++;
                    typewriterTimeout = setTimeout(type, speed);
                }
            }
            type();
        } else {
            // Fallback for older browsers
            let i = 0;
            element.textContent = "";
            function type() {
                if (i < text.length) {
                    element.textContent += text.charAt(i);
                    i++;
                    typewriterTimeout = setTimeout(type, speed);
                }
            }
            type();
        }
    };

    const speak = (text) => {
        clearInterval(lipSyncInterval);
        characterImage.src = closedMouthImg;
        if (!speechAvailable) return;
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }
        if (voices.length === 0) return;

        const utterance = new SpeechSynthesisUtterance(text);
        const selectedOption = voiceSelect.selectedOptions[0]?.getAttribute('data-name');
        const selectedVoice = voices.find(voice => voice.name === selectedOption);
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }

        const startLipSync = () => {
            clearInterval(lipSyncInterval);
            let mouthOpen = true;
            characterImage.src = openMouthImg;
            lipSyncInterval = setInterval(() => {
                characterImage.src = mouthOpen ? openMouthImg : closedMouthImg;
                mouthOpen = !mouthOpen;
            }, 150);
        };

        const stopLipSync = () => {
            clearInterval(lipSyncInterval);
            characterImage.src = closedMouthImg;
        };

        utterance.onstart = startLipSync;
        utterance.onend = stopLipSync;
        utterance.onerror = stopLipSync;

        speechSynthesis.speak(utterance);
    };

    const handleSendMessage = async () => {
        const message = textInput.value.trim();
        if (!message) return;

        textInput.value = '';
        textInput.style.height = '50px';
        status.textContent = "Thinking...";

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: message }),
            });

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const data = await response.json();
            typewriter(data.response, status);
            speak(data.response);
        } catch (error) {
            console.error('Error:', error);
            const errorMessage = 'Sorry, something went wrong. Please try again.';
            typewriter(errorMessage, status);
            speak(errorMessage);
        }
    };

    sendButton.addEventListener('click', handleSendMessage);

    textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    textInput.addEventListener('input', () => {
        textInput.style.height = 'auto';
        textInput.style.height = `${textInput.scrollHeight}px`;
    });
});
