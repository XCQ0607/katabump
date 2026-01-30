const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

// 启用 stealth 插件
chromium.use(stealth);

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = "C:\\ChromeData_Katabump";
const DEBUG_PORT = 9222;
const HEADLESS = false;

// --- injected.js 核心逻辑 ---
// 这个脚本会被注入到每个 Frame 中。它劫持 attachShadow 以捕获 Turnstile 的 checkbox，
// 计算其相对于 Frame 视口的位置比例，并存入 window.__turnstile_data 供外部读取。
const INJECTED_SCRIPT = `
(function() {
    // 只在 iframe 中运行（Turnstile 通常在 iframe 里）
    if (window.self === window.top) return;

    // 1. 模拟鼠标屏幕坐标 (尝试保留这个优化)
    try {
        function getRandomInt(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
        let screenX = getRandomInt(800, 1200);
        let screenY = getRandomInt(400, 600);
        
        Object.defineProperty(MouseEvent.prototype, 'screenX', { value: screenX });
        Object.defineProperty(MouseEvent.prototype, 'screenY', { value: screenY });
    } catch (e) { 
        // 忽略错误，如果不允许修改也没关系，不影响主流程
    }

    // 2. 简单的 attachShadow Hook (回退到这个版本，确保能找到元素)
    try {
        const originalAttachShadow = Element.prototype.attachShadow;
        
        Element.prototype.attachShadow = function(init) {
            const shadowRoot = originalAttachShadow.call(this, init);
            
            if (shadowRoot) {
                const checkAndReport = () => {
                    // 尝试在 Shadow Root 中查找 checkbox
                    const checkbox = shadowRoot.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        const rect = checkbox.getBoundingClientRect();
                        // 确保元素已渲染且可见
                        if (rect.width > 0 && rect.height > 0 && window.innerWidth > 0 && window.innerHeight > 0) {
                            const xRatio = (rect.left + rect.width / 2) / window.innerWidth;
                            const yRatio = (rect.top + rect.height / 2) / window.innerHeight;
                            
                            // 暴露数据给 Playwright
                            window.__turnstile_data = { xRatio, yRatio };
                            return true;
                        }
                    }
                    return false;
                };

                // 立即检查一次
                if (!checkAndReport()) {
                    // 如果没找到，监听 DOM 变化
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

// 辅助函数：检测端口是否开放
function checkPort(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}/json/version`, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

// 辅助函数：启动原生 Chrome
async function launchNativeChrome() {
    console.log('Checking if Chrome is already running on port ' + DEBUG_PORT + '...');
    if (await checkPort(DEBUG_PORT)) {
        console.log('Chrome is already open.');
        return;
    }

    console.log('Launching native Chrome...');
    const args = [
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${USER_DATA_DIR}`,
        '--no-first-run',
        '--no-default-browser-check'
    ];
    if (HEADLESS) {
        args.push('--headless=new');
    }

    const chrome = spawn(CHROME_PATH, args, {
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

// 从 login.json 读取用户列表
function getUsers() {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'login.json'), 'utf8');
        const json = JSON.parse(data);
        return Array.isArray(json) ? json : (json.users || []);
    } catch (e) {
        console.error('Error reading login.json:', e);
        return [];
    }
}

/**
 * 核心功能：遍历所有 Frames，查找被注入脚本标记的 Turnstile 坐标，
 * 计算绝对屏幕坐标，并使用 CDP 发送原生鼠标点击事件。
 */
async function attemptTurnstileCdp(page) {
    const frames = page.frames();
    for (const frame of frames) {
        try {
            // 检查当前 Frame 是否捕获到了 Turnstile 数据
            const data = await frame.evaluate(() => window.__turnstile_data).catch(() => null);

            if (data) {
                console.log('>> Found Turnstile in frame. Ratios:', data);

                // 获取 iframe 元素在主页面中的位置
                const iframeElement = await frame.frameElement();
                if (!iframeElement) continue;

                const box = await iframeElement.boundingBox();
                if (!box) continue;

                // 计算绝对坐标：iframe 左上角 + (iframe 宽/高 * 比例)
                const clickX = box.x + (box.width * data.xRatio);
                const clickY = box.y + (box.height * data.yRatio);

                console.log(`>> Calculated absolute click coordinates: (${clickX.toFixed(2)}, ${clickY.toFixed(2)})`);

                // 创建 CDP 会话并发送点击命令
                const client = await page.context().newCDPSession(page);

                // 1. Mouse Pressed
                await client.send('Input.dispatchMouseEvent', {
                    type: 'mousePressed',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                // 模拟人类点击持续时间 (50ms - 150ms)
                await new Promise(r => setTimeout(r, 50 + Math.random() * 100));

                // 2. Mouse Released
                await client.send('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                console.log('>> CDP Click sent successfully.');
                await client.detach();
                return true; // 成功点击
            }
        } catch (e) {
            // 忽略 Frame 访问错误（跨域等）
        }
    }
    return false;
}

(async () => {
    const users = getUsers();
    if (users.length === 0) {
        console.log('No users found in login.json');
        return;
    }

    await launchNativeChrome();

    console.log(`Connecting to Chrome instance...`);
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
        return;
    }

    const context = browser.contexts()[0];
    let page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    page.setDefaultTimeout(60000);

    // --- 关键：注入 Hook 脚本 ---
    // 这会在每次页面加载/导航前执行，确保能拦截到 Turnstile 的创建
    await page.addInitScript(INJECTED_SCRIPT);
    console.log('Injection script added to page context.');

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        console.log(`\n=== Processing User ${i + 1}/${users.length}: ${user.username} ===`);

        try {
            if (page.isClosed()) {
                page = await context.newPage();
                await page.addInitScript(INJECTED_SCRIPT); // 新页面也要注入
            }

            // 登录逻辑保持不变...
            console.log('Checking session state...');
            if (page.url().includes('/auth/login')) {
                // Already on login logic
            } else if (page.url().includes('dashboard')) {
                await page.goto('https://dashboard.katabump.com/auth/logout');
                await page.waitForTimeout(2000);
            } else {
                await page.goto('https://dashboard.katabump.com/auth/login');
                await page.waitForTimeout(2000);
                if (page.url().includes('dashboard')) {
                    await page.goto('https://dashboard.katabump.com/auth/logout');
                    await page.waitForTimeout(2000);
                    await page.goto('https://dashboard.katabump.com/auth/login');
                }
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
                // 可能已经登录了，或者是其他 UI 状态
                console.log('Login form interaction error (maybe already logged in?):', e.message);
            }

            console.log('Waiting for "See" link...');
            try {
                await page.getByRole('link', { name: 'See' }).first().waitFor({ timeout: 15000 });
                await page.waitForTimeout(1000);
                await page.getByRole('link', { name: 'See' }).first().click();
            } catch (e) {
                console.log('Could not find "See" button. Checking if already on detail page or login failed.');
                if (page.url().includes('login')) {
                    console.error('Login failed for user ' + user.username);
                    continue;
                }
            }

            let renewSuccess = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                if (attempt > 1) {
                    console.log(`\n[Attempt ${attempt}] Reloading page to reset state...`);
                    await page.reload();
                    await page.waitForTimeout(3000);
                }

                console.log('Looking for Renew button...');
                const renewBtn = page.getByRole('button', { name: 'Renew', exact: true }).first();
                await page.waitForTimeout(2000);

                if (await renewBtn.isVisible()) {
                    await renewBtn.click();
                    console.log('Renew button clicked. Waiting for modal...');

                    const modal = page.locator('#renew-modal');
                    try { await modal.waitFor({ state: 'visible', timeout: 5000 }); } catch (e) { }

                    console.log('Checking for Turnstile (using CDP bypass)...');

                    // 1. 简单鼠标晃动模拟真实感
                    try {
                        const box = await modal.boundingBox();
                        if (box) {
                            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
                        }
                    } catch (e) { }

                    // 2. 验证循环：点击验证码 -> 点击Renew -> 检查错误 -> 循环
                    let verified = false;
                    const confirmBtn = modal.getByRole('button', { name: 'Renew' }); // Modal 里的确认按钮

                    // 既然 Renew 按钮随时可点，我们采用“试错法”
                    // 既然 Renew 按钮随时可点，我们采用“试错法”
                    for (let verifyAttempt = 0; verifyAttempt < 10; verifyAttempt++) {
                        console.log(`\n[Verify Loop ${verifyAttempt + 1}] Processing...`);

                        // 0. 确保模态框已打开
                        const modal = page.locator('#renew-modal');
                        if (!await modal.isVisible()) {
                            console.log('   >> Modal is closed. Clicking main "Renew" button to open...');
                            if (await renewBtn.isVisible()) {
                                await renewBtn.click();
                                try { await modal.waitFor({ state: 'visible', timeout: 5000 }); } catch (e) {
                                    console.log('   >> Modal did not appear after click? Retrying loop...');
                                    continue;
                                }
                                await page.waitForTimeout(1000);
                            } else {
                                console.log('   >> Main Renew button not visible? Maybe already renewed.');
                                break;
                            }
                        }

                        // A. 尝试寻找并点击 Turnstile (增加内部重试，防止太快)
                        let cdpClickResult = false;
                        for (let findAttempt = 0; findAttempt < 5; findAttempt++) {
                            cdpClickResult = await attemptTurnstileCdp(page);
                            if (cdpClickResult) {
                                break; // 找到了并点击了
                            }
                            // 没找到，稍微等一下再找
                            console.log(`   >> [Find Attempt ${findAttempt + 1}/5] Turnstile checkbox not found yet...`);
                            await page.waitForTimeout(1000);
                        }

                        let isTurnstileSuccess = false;

                        if (cdpClickResult) {
                            console.log('   >> CDP Click active. Waiting 8s for Cloudflare check...');
                            // 增加到 8 秒
                            await page.waitForTimeout(8000);
                        } else {
                            console.log('   >> Turnstile checkbox not confirmed after retries.');
                        }

                        // 检测 Turnstile Success
                        const frames = page.frames();
                        for (const f of frames) {
                            if (f.url().includes('cloudflare')) {
                                try {
                                    if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                        console.log('   >> Detected "Success!" in Turnstile iframe.');
                                        isTurnstileSuccess = true;
                                        break;
                                    }
                                } catch (e) { }
                            }
                        }

                        // B. 点击 Renew 确认按钮
                        const confirmBtn = modal.getByRole('button', { name: 'Renew' });
                        if (await confirmBtn.isVisible()) {

                            // 策略优化：如果既没有刚点击过，也没检测到 Success 文字，坚决不点 Renew
                            if (!cdpClickResult && !isTurnstileSuccess) {
                                console.log('   >> 🛑 Not ready (No click & No Success msg). Skipping "Renew" click and retrying loop...');
                                await page.waitForTimeout(2000);
                                continue; // 直接进入下一次大循环，重新找验证码
                            }

                            console.log('   >> Clicking Renew confirm button...');
                            await confirmBtn.click();

                            // C. 检测错误提示
                            let hasError = false;
                            try {
                                const errorMsg = page.getByText('Please complete the captcha to continue');
                                if (await errorMsg.isVisible({ timeout: 2000 })) {
                                    console.log('   >> ⚠️ Error detected: "Please complete the captcha".');
                                    hasError = true;
                                }
                            } catch (e) { }

                            if (hasError) {
                                console.log('   >> Error found. Closing modal to RESTART flow...');
                                try {
                                    const closeBtn = modal.getByLabel('Close');
                                    if (await closeBtn.isVisible()) await closeBtn.click();
                                    else await page.keyboard.press('Escape');
                                } catch (e) { }

                                await page.waitForTimeout(2500);
                                continue; // 只有出错了才重启
                            }

                            // D. 检查成功状态 (模态框消失)
                            await page.waitForTimeout(2000);
                            if (!await modal.isVisible()) {
                                console.log('   >> ✅ Modal closed. Renew successful!');
                                verified = true;
                                break;
                            } else {
                                console.log('   >> Modal still open but no error. Continuing loop...');
                            }
                        } else {
                            console.log('   >> Renew confirm button inside modal not found.');
                            await page.waitForTimeout(1000);
                        }
                    }

                    if (verified) {
                        renewSuccess = true;
                        break; // 成功，跳出外层的 attempt 循环
                    } else {
                        console.log('Warning: Verification loop finished but success not confirmed.');
                        // 尝试关闭模态框
                        try {
                            const closeBtn = modal.getByLabel('Close');
                            if (await closeBtn.isVisible()) await closeBtn.click();
                        } catch (e) { }
                    }

                } else {
                    console.log('Renew button not found (Server might be already renewed).');
                    break;
                }
            }

        } catch (err) {
            console.error(`Error processing user ${user.username}:`, err);
        }

        console.log(`Finished User ${user.username}\n`);
    }

    console.log('All users processed.');
    console.log('Closing browser connection.');
    await browser.close();
})();
