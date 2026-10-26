// Browser checks against a running app. LIVE_GEMINI=1 makes billable model calls.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const live = process.env.LIVE_GEMINI === '1';
    const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:8000';
    const output = process.env.E2E_OUTPUT_DIR || '/tmp/companion-e2e';
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errors = [];
        const requests = [];
        let releaseFirstReply;
        const firstReply = new Promise(resolve => { releaseFirstReply = resolve; });
        page.on('pageerror', err => errors.push(err.message));
        page.on('request', request => {
            if (request.url() === `${base}/chat`) requests.push(request.postDataJSON());
        });
        if (!live) {
            // Real DOM, network and audio decoder; only upstream AI responses are fixtures.
            const wav = Buffer.alloc(44 + 24000 * 2 * 2);
            wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
            wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
            wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
            wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
            wav.writeUInt32LE(wav.length - 44, 40);
            await page.route(`${base}/chat`, async route => {
                await firstReply;
                await route.fulfill({ json: {
                    response: 'こんにちは！合言葉は「桃太郎ラボ」ですね。\n今日はどんなことを一緒に考えましょうか？',
                    sources: [{ title: '参考ページ', url: 'https://example.com/' },
                        { title: 'unsafe', url: 'javascript:alert(1)' }, { title: 'invalid', url: 'not-a-url' }],
                    grounding_html: '<p>検索候補の表示テスト</p>',
                } });
            });
            await page.route(`${base}/tts`, route => route.fulfill({ body: wav, contentType: 'audio/wav' }));
        }
        await page.goto(base);
        await page.waitForFunction(() => document.querySelector('#voice-select').options.length === 5);
        assert.equal(await page.locator('#send-button').isDisabled(), true);
        assert.equal(await page.locator('#history-dialog').isVisible(), false);
        assert.ok((await page.locator('#character-image').boundingBox()).width > 350,
            'The character must be the main desktop visual');
        await page.screenshot({ path: path.join(output, 'desktop-welcome.png'), fullPage: true });
        await page.locator('[data-prompt]').first().click();
        assert.match(await page.inputValue('#text-input'), /自己紹介/);
        await page.press('#text-input', 'Shift+Enter');
        assert.match(await page.inputValue('#text-input'), /\n/);
        await page.locator('#text-input').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
        assert.equal(requests.length, 0, 'Prompt/Shift+Enter/IME composition must not send');
        for (const [index, message] of [
            '合言葉は「桃太郎ラボ」です。日本語の一文で確認してください。',
            'さっきの合言葉だけを答えてください。',
        ].entries()) {
            if (index === 1) await page.selectOption('#voice-select', 'Puck');
            await page.fill('#text-input', message);
            const chat = page.waitForResponse(r => r.url() === `${base}/chat`, { timeout: 300000 });
            const speech = page.waitForResponse(r => r.url() === `${base}/tts`, { timeout: 300000 }).catch(() => null);
            if (index === 0) await page.click('#send-button');
            else await page.press('#text-input', 'Enter');
            if (!live && index === 0) {
                assert.equal(await page.locator('#new-chat').isDisabled(), true);
                assert.equal(await page.locator('#text-input').isDisabled(), true);
                assert.equal(await page.locator('.pending').count(), 1);
                await page.locator('#send-button').dispatchEvent('click');
                releaseFirstReply();
            }
            const chatResponse = await chat;
            assert.equal(chatResponse.status(), 200, `Chat failed: ${chatResponse.status()}`);
            const speechResponse = await speech;
            assert.ok(speechResponse, 'TTS response did not arrive');
            assert.equal(speechResponse.status(), 200);
            await page.waitForFunction(() => document.querySelector('#speech-audio').currentTime > 0.2);
            assert.equal(await page.locator('#character-viewer').getAttribute('data-speaking'), 'true');
            // Read the Blob used by the actual audio element, rather than a CDP media body.
            const audio = await page.locator('#speech-audio').evaluate(async element => {
                const bytes = new Uint8Array(await (await fetch(element.src)).arrayBuffer());
                return { duration: element.duration, time: element.currentTime, bytes: bytes.length,
                    header: String.fromCharCode(...bytes.slice(0, 4)) };
            });
            assert.equal(audio.header, 'RIFF');
            assert.ok(audio.duration > 0);
            const mouths = new Set();
            for (let sample = 0; sample < 6; sample++) {
                mouths.add(await page.locator('#character-image').getAttribute('src'));
                await page.waitForTimeout(100);
            }
            assert.equal(mouths.size, 2, 'Mouth must animate while audio plays');
            await page.locator('#speech-audio').evaluate(element => element.pause());
            assert.match(await page.locator('#character-image').getAttribute('src'), /closed/);
            assert.equal(await page.locator('#character-viewer').getAttribute('data-speaking'), 'false');
            await page.locator('#speech-audio').evaluate(element => element.play());
            await page.waitForFunction(() => !document.querySelector('#speech-audio').paused);
            await page.locator('#speech-audio').evaluate(element => element.pause());
            assert.match(await page.locator('.assistant .message-text').last().textContent(), /桃太郎ラボ/);
            assert.match(await page.locator('#reply-text').textContent(), /桃太郎ラボ/);
            assert.equal(await page.locator('.message').count(), (index + 1) * 2);
            assert.equal(requests[index].history.length, index * 2);
            if (index === 1) assert.equal(await page.locator('#text-input').evaluate(input => input === document.activeElement), true);
            if (!live) {
                assert.equal(await page.locator('.assistant').last().locator('.sources a').count(), 1);
                assert.equal(await page.locator('.search-suggestions').last().getAttribute('sandbox'),
                    'allow-popups allow-popups-to-escape-sandbox');
            }
            console.log(`Turn ${index + 1}: chat/TTS 200; WAV ${audio.bytes} bytes; decoded ${audio.duration}s; lip sync OK`);
        }
        await page.click('#show-history');
        assert.equal(await page.locator('#history-dialog').isVisible(), true);
        assert.equal(await page.locator('.assistant .message-text').last().isVisible(), true);
        await page.press('#close-history', 'Escape');
        assert.equal(await page.locator('#history-dialog').isVisible(), false);
        if (!live) {
            await page.click('#reply-sources');
            assert.equal(await page.locator('.sources a').last().isVisible(), true);
            await page.click('#close-history');
        }
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok((await page.locator('#character-image').boundingBox()).width > 250,
            'The character must remain prominent on mobile');
        const layout = await page.evaluate(() => {
            const button = document.querySelector('#send-button').getBoundingClientRect();
            const input = document.querySelector('#text-input').getBoundingClientRect();
            return { width: document.body.scrollWidth, viewport: innerWidth, bottom: button.bottom,
                height: innerHeight, inputWidth: input.width };
        });
        assert.ok(layout.width <= layout.viewport && layout.bottom <= layout.height && layout.inputWidth > 100);
        await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
        await page.click('#new-chat');
        assert.equal(await page.locator('.message').count(), 0);
        assert.equal(await page.locator('#welcome').isVisible(), true);
        assert.equal(await page.locator('#audio-panel').isVisible(), false);
        assert.equal(await page.locator('#speech-audio').evaluate(audio => audio.paused && !audio.hasAttribute('src')), true);
        await page.locator('#text-input').blur();
        await page.screenshot({ path: path.join(output, 'mobile-welcome.png'), fullPage: true });
        await page.reload();
        assert.equal(await page.locator('#status').textContent(), '会話をはじめましょう');
        if (!live) {
            // Check real browser error recovery, then accept a fresh send.
            await page.unroute(`${base}/tts`);
            await page.route(`${base}/tts`, route => route.fulfill({ status: 502, json: { detail: 'TTS test failure' } }));
            await page.fill('#text-input', '音声エラーの確認');
            await page.click('#send-button');
            await page.waitForFunction(() => document.querySelector('#audio-status').textContent.includes('TTS test failure'));
            assert.match(await page.locator('.assistant .message-text').textContent(), /桃太郎ラボ/);
            assert.equal(await page.locator('#text-input').isEnabled(), true);
            assert.equal(requests[2].history.length, 0, 'Reload must clear history');
            await page.unroute(`${base}/chat`);
            await page.route(`${base}/chat`, route => route.fulfill({ status: 429, json: { detail: 'Quota test failure' } }));
            await page.fill('#text-input', '再試行できる入力');
            await page.click('#send-button');
            await page.waitForFunction(() => document.querySelector('#status').textContent === 'Quota test failure');
            assert.equal(await page.locator('#text-input').inputValue(), '再試行できる入力');
            assert.equal(await page.locator('#text-input').isEnabled(), true);
            assert.equal(await page.locator('.message').count(), 2, 'Failed turns must not duplicate the log');
            await page.unroute(`${base}/chat`);
            await page.route(`${base}/chat`, route => route.fulfill({ json: { response: '<img src=x onerror=alert(1)>' } }));
            await page.click('#send-button');
            await page.waitForFunction(() => !document.querySelector('#text-input').disabled);
            assert.equal(await page.locator('.assistant .message-text').last().textContent(), '<img src=x onerror=alert(1)>');
            assert.equal(await page.locator('#reply-text').textContent(), '<img src=x onerror=alert(1)>');
            assert.equal(await page.locator('#messages img').count(), 0, 'Model text must not become HTML');
            for (let turn = 0; turn < 10; turn++) {
                await page.fill('#text-input', `続き ${turn}`);
                await page.click('#send-button');
                await page.waitForFunction(() => !document.querySelector('#text-input').disabled);
            }
            assert.equal(requests.at(-1).history.length, 20, 'API history stays within ten turns');
            assert.equal(await page.locator('.message').count(), 24, 'Earlier turns remain readable');
            await page.click('#new-chat');
            await page.unroute(`${base}/chat`);
            await page.route(`${base}/chat`, route => route.fulfill({ json: { response: '長い返答の表示確認です。\n'.repeat(80) } }));
            await page.fill('#text-input', 'リセット後の会話');
            await page.click('#send-button');
            await page.waitForFunction(() => !document.querySelector('#text-input').disabled);
            assert.equal(requests.at(-1).history.length, 0, 'New conversation must clear API history');
            for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 460 },
                { width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1280, height: 600 }]) {
                await page.setViewportSize(viewport);
                await page.fill('#text-input', '長い入力の確認です。'.repeat(400));
                const fits = await page.evaluate(() => {
                    const send = document.querySelector('#send-button').getBoundingClientRect();
                    const input = document.querySelector('#text-input').getBoundingClientRect();
                    const character = document.querySelector('#character-image').getBoundingClientRect();
                    return document.body.scrollWidth <= innerWidth && send.bottom <= innerHeight
                        && input.height <= 120 && input.top >= 0 && character.height > 35;
                });
                assert.ok(fits, `Composer must fit ${viewport.width}×${viewport.height}`);
            }
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.locator('#character-viewer').evaluate(viewer => { viewer.dataset.speaking = 'true'; });
            assert.equal(await page.locator('#character-viewer').evaluate(viewer => getComputedStyle(viewer).animationName), 'none');
        }
        assert.deepEqual(errors, []);
        console.log(`${live ? 'LIVE' : 'FIXTURE'} browser checks passed; desktop/mobile screenshots: ${output}`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
