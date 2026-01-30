const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { spawn } = require('child_process');
const http = require('http');

// 启用 stealth 插件
chromium.use(stealth);

// GitHub Actions 环境下的 Chrome 路径 (通常是 google-chrome)
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const DEBUG_PORT = 9222;

// --- INJECTED_SCRIPT (与 renew.js 保持一致) ---
const INJECTED_SCRIPT = `
(function() {
    if (window.self === window.top) return;

    // 1. 模拟鼠标屏幕坐标
    try {
        function getRandomInt(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
        let screenX = getRandomInt(800, 1200);
        let screenY = getRandomInt(400, 600);
        
        Object.defineProperty(MouseEvent.prototype, 'screenX', { value: screenX });
        Object.defineProperty(MouseEvent.prototype, 'screenY', { value: screenY });
    } catch (e) { }

    // 2. 简单的 attachShadow Hook (从 renew.js 移植)
    try {
        const originalAttachShadow = Element.prototype.attachShadow;
        
        Element.prototype.attachShadow = function(init) {
            const shadowRoot = originalAttachShadow.call(this, init);
            
            if (shadowRoot) {
                const checkAndReport = () => {
                    const checkbox = shadowRoot.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        const rect = checkbox.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0 && window.innerWidth > 0 && window.innerHeight > 0) {
                            const xRatio = (rect.left + rect.width / 2) / window.innerWidth;
                            const yRatio = (rect.top + rect.height / 2) / window.innerHeight;
                            window.__turnstile_data = { xRatio, yRatio };
                            return true;
                        }
                    }
                    return false;
                };

                if (!checkAndReport()) {
                    const observer = new MutationObserver(() => {
                        if (checkAndReport()) observer.disconnect();
                    });
                    observer.observe(shadowRoot, { childList: true, subtree: true });
                }
            }
            return shadowRoot;
        };
    } catch (e) {
        console.error('[Injected] Error hooking attachShadow:', e);
    }
})();
`;

function checkPort(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}/json/version`, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

async function launchChrome() {
    console.log('Checking if Chrome is already running on port ' + DEBUG_PORT + '...');
    if (await checkPort(DEBUG_PORT)) {
        console.log('Chrome is already open.');
        return;
    }

    console.log(`Launching Chrome from ${CHROME_PATH}...`);
    const chrome = spawn(CHROME_PATH, [
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--headless=new', // 云端必须 headless
        '--disable-gpu',
        '--window-size=1280,720'
    ], {
        detached: true,
        stdio: 'ignore'
    });
    chrome.unref();

    console.log('Waiting for Chrome to initialize...');
    for (let i = 0; i < 20; i++) {
        if (await checkPort(DEBUG_PORT)) break;
        await new Promise(r => setTimeout(r, 1000));
    }
}

function getUsers() {
    // 从环境变量读取 JSON 字符串
    // GitHub Actions Secret: USERS_JSON = [{"username":..., "password":...}]
    try {
        if (process.env.USERS_JSON) {
            const parsed = JSON.parse(process.env.USERS_JSON);
            return Array.isArray(parsed) ? parsed : (parsed.users || []);
        }
    } catch (e) {
        console.error('Error parsing USERS_JSON env var:', e);
    }
    return [];
}

async function attemptTurnstileCdp(page) {
    const frames = page.frames();
    for (const frame of frames) {
        try {
            const data = await frame.evaluate(() => window.__turnstile_data).catch(() => null);

            if (data) {
                console.log('>> Found Turnstile in frame. Ratios:', data);

                const iframeElement = await frame.frameElement();
                if (!iframeElement) continue;

                const box = await iframeElement.boundingBox();
                if (!box) continue;

                const clickX = box.x + (box.width * data.xRatio);
                const clickY = box.y + (box.height * data.yRatio);

                console.log(`>> Calculated click: (${clickX.toFixed(2)}, ${clickY.toFixed(2)})`);

                const client = await page.context().newCDPSession(page);

                await client.send('Input.dispatchMouseEvent', {
                    type: 'mousePressed',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                await new Promise(r => setTimeout(r, 50 + Math.random() * 100));

                await client.send('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                console.log('>> CDP Click sent.');
                await client.detach();
                return true;
            }
        } catch (e) { }
    }
    return false;
}

(async () => {
    const users = getUsers();
    if (users.length === 0) {
        console.log('No users found in process.env.USERS_JSON');
        process.exit(1);
    }

    await launchChrome();

    console.log(`Connecting to Chrome...`);
    let browser;
    for (let k = 0; k < 5; k++) {
        try {
            browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
            console.log('Successfully connected!');
            break;
        } catch (e) {
            console.log(`Connection attempt ${k + 1} failed. Retrying in 2s...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (!browser) {
        console.error('Failed to connect. Exiting.');
        process.exit(1);
    }

    const context = browser.contexts()[0];
    let page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    page.setDefaultTimeout(60000);

    await page.addInitScript(INJECTED_SCRIPT);
    console.log('Injection script added.');

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        console.log(`\n=== Processing User ${i + 1}/${users.length} ===`); // 隐去具体邮箱 logging

        try {
            if (page.isClosed()) {
                page = await context.newPage();
                await page.addInitScript(INJECTED_SCRIPT);
            }

            // --- 登录逻辑 (简略版，逻辑一致) ---
            if (page.url().includes('dashboard')) {
                await page.goto('https://dashboard.katabump.com/auth/logout');
                await page.waitForTimeout(2000);
            }
            // 总是先去登录页
            await page.goto('https://dashboard.katabump.com/auth/login');
            await page.waitForTimeout(2000);
            if (page.url().includes('dashboard')) {
                // 如果登出没成功，再次登出
                await page.goto('https://dashboard.katabump.com/auth/logout');
                await page.waitForTimeout(2000);
                await page.goto('https://dashboard.katabump.com/auth/login');
            }

            console.log('Filling credentials...');
            try {
                const emailInput = page.getByRole('textbox', { name: 'Email' });
                await emailInput.waitFor({ state: 'visible', timeout: 5000 });
                await emailInput.fill(user.username);
                const pwdInput = page.getByRole('textbox', { name: 'Password' });
                await pwdInput.fill(user.password);
                await page.waitForTimeout(500);
                await page.getByRole('button', { name: 'Login', exact: true }).click();
            } catch (e) {
                console.log('Login error:', e.message);
            }

            console.log('Waiting for "See" link...');
            try {
                await page.getByRole('link', { name: 'See' }).first().waitFor({ timeout: 15000 });
                await page.waitForTimeout(1000);
                await page.getByRole('link', { name: 'See' }).first().click();
            } catch (e) {
                console.log('Could not find "See" button.');
                continue;
            }

            // --- Renew 逻辑 (与 renew.js 核心一致) ---
            let renewSuccess = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                if (attempt > 1) {
                    console.log(`[Attempt ${attempt}] Reloading...`);
                    await page.reload();
                    await page.waitForTimeout(3000);
                }

                console.log('Looking for Renew button...');
                const renewBtn = page.getByRole('button', { name: 'Renew', exact: true }).first();
                await page.waitForTimeout(2000);

                if (await renewBtn.isVisible()) {
                    await renewBtn.click();
                    const modal = page.locator('#renew-modal');
                    try { await modal.waitFor({ state: 'visible', timeout: 5000 }); } catch (e) { }

                    // Mouse move simulation
                    try {
                        const box = await modal.boundingBox();
                        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
                    } catch (e) { }

                    // Verify Loop
                    let verified = false;

                    for (let verifyAttempt = 0; verifyAttempt < 10; verifyAttempt++) {
                        console.log(`[Verify Loop ${verifyAttempt + 1}]...`);

                        if (!await modal.isVisible()) {
                            if (await renewBtn.isVisible()) {
                                await renewBtn.click();
                                try { await modal.waitFor({ state: 'visible', timeout: 5000 }); } catch (e) { continue; }
                                await page.waitForTimeout(1000);
                            } else {
                                break;
                            }
                        }

                        // A. Find Turnstile
                        let cdpClickResult = false;
                        for (let findAttempt = 0; findAttempt < 5; findAttempt++) {
                            cdpClickResult = await attemptTurnstileCdp(page);
                            if (cdpClickResult) break;
                            await page.waitForTimeout(1000);
                        }

                        let isTurnstileSuccess = false;
                        if (cdpClickResult) {
                            console.log('   >> CDP active, waiting 8s...');
                            await page.waitForTimeout(8000);
                        } else {
                            // wait a bit
                            await page.waitForTimeout(1000);
                        }

                        // Check Success
                        const frames = page.frames();
                        for (const f of frames) {
                            if (f.url().includes('cloudflare')) {
                                try {
                                    if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                        isTurnstileSuccess = true;
                                        break;
                                    }
                                } catch (e) { }
                            }
                        }

                        const confirmBtn = modal.getByRole('button', { name: 'Renew' });
                        if (await confirmBtn.isVisible()) {
                            if (!cdpClickResult && !isTurnstileSuccess) {
                                console.log('   >> Not ready, skipping click...');
                                await page.waitForTimeout(2000);
                                continue;
                            }

                            console.log('   >> Clicking Renew...');
                            await confirmBtn.click();

                            // Error Check
                            let hasError = false;
                            try {
                                const errorMsg = page.getByText('Please complete the captcha to continue');
                                if (await errorMsg.isVisible({ timeout: 2000 })) hasError = true;
                            } catch (e) { }

                            if (hasError) {
                                console.log('   >> Error detected. Resetting...');
                                try {
                                    const closeBtn = modal.getByLabel('Close');
                                    if (await closeBtn.isVisible()) await closeBtn.click();
                                    else await page.keyboard.press('Escape');
                                } catch (e) { }
                                await page.waitForTimeout(2500);
                                continue;
                            }

                            await page.waitForTimeout(2000);
                            if (!await modal.isVisible()) {
                                console.log('   >> Renew successful!');
                                verified = true;
                                break;
                            }
                        } else {
                            await page.waitForTimeout(1000);
                        }
                    }

                    if (verified) {
                        renewSuccess = true;
                        break;
                    } else {
                        try {
                            const closeBtn = modal.getByLabel('Close');
                            if (await closeBtn.isVisible()) await closeBtn.click();
                        } catch (e) { }
                    }
                } else {
                    console.log('Renew button not found (Already renewed?)');
                    break;
                }
            }
        } catch (err) {
            console.error(`Error processing user:`, err);
        }
    }

    console.log('Done.');
    await browser.close();
    process.exit(0);
})();
