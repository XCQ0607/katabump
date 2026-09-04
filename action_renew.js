const { chromium } = require('playwright-extra');
const { chromium: playwrightChromium } = require('playwright');
const stealth = require('puppeteer-extra-plugin-stealth')();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const FormData = require('form-data');
const crypto = require('crypto');
const http = require('http');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

async function sendTelegramMessage(message, imagePath = null) {
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;

    try {
        const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TG_CHAT_ID,
            text: message,
            disable_web_page_preview: true
        });
        console.log('[Telegram] Message sent.');
    } catch (e) {
        console.error('[Telegram] Failed to send message:', e.message);
    }

    if (imagePath && fs.existsSync(imagePath)) {
        try {
            const form = new FormData();
            form.append('chat_id', TG_CHAT_ID);
            form.append('photo', fs.createReadStream(imagePath));
            await axios.post(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, form, {
                headers: form.getHeaders(),
                maxBodyLength: Infinity,
                timeout: 30000
            });
            console.log('[Telegram] Photo sent.');
        } catch (e) {
            console.error('[Telegram] Failed to send photo:', e.message);
        }
    }
}

// 启用 stealth 插件
chromium.use(stealth);

// GitHub Actions 环境下优先使用系统 Chrome；若不存在则自动回退到 Playwright 下载的 Chromium。
const DEFAULT_CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
].filter(Boolean);
const DEBUG_HOST = '127.0.0.1';
const DEBUG_PORT = 9222;

// 确保 localhost 不走代理
process.env.NO_PROXY = 'localhost,127.0.0.1';

// --- Proxy Configuration ---
const HTTP_PROXY = process.env.HTTP_PROXY;
let PROXY_CONFIG = null;

if (HTTP_PROXY) {
    try {
        const proxyUrl = new URL(HTTP_PROXY);
        PROXY_CONFIG = {
            server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
            username: proxyUrl.username ? decodeURIComponent(proxyUrl.username) : undefined,
            password: proxyUrl.password ? decodeURIComponent(proxyUrl.password) : undefined
        };
        console.log(`[代理] 检测到配置: 服务器=${PROXY_CONFIG.server}, 认证=${PROXY_CONFIG.username ? '是' : '否'}`);
    } catch (e) {
        console.error('[代理] TODO HTTP_PROXY 格式无效。期望格式: http://user:pass@host:port 或 http://host:port');
        process.exit(1);
    }
}

// --- INJECTED_SCRIPT ---
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

    // 2. 简单的 attachShadow Hook
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
        console.error('[注入] Hook attachShadow 失败:', e);
    }
})();
`;

// 辅助函数：检测代理是否可用
async function checkProxy() {
    if (!PROXY_CONFIG) return true;

    console.log('[代理] 正在验证代理连接...');
    try {
        const axiosConfig = {
            proxy: {
                protocol: 'http',
                host: new URL(PROXY_CONFIG.server).hostname,
                port: new URL(PROXY_CONFIG.server).port,
            },
            timeout: 10000
        };

        if (PROXY_CONFIG.username && PROXY_CONFIG.password) {
            axiosConfig.proxy.auth = {
                username: PROXY_CONFIG.username,
                password: PROXY_CONFIG.password
            };
        }

        await axios.get('https://www.google.com', axiosConfig);
        console.log('[代理] 连接成功！');
        return true;
    } catch (error) {
        console.error(`[代理] 连接失败: ${error.message}`);
        return false;
    }
}

function checkPort(port) {
    return new Promise((resolve) => {
        const req = http.get({ hostname: DEBUG_HOST, port, path: '/json/version', timeout: 2000 }, (res) => {
            res.resume();
            resolve(res.statusCode >= 200 && res.statusCode < 500);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

function getChromeExecutablePath() {
    const candidates = [...DEFAULT_CHROME_CANDIDATES];

    try {
        const playwrightPath = playwrightChromium.executablePath();
        if (playwrightPath) candidates.push(playwrightPath);
    } catch (e) {
        console.log(`[Chrome] 获取 Playwright Chromium 路径失败: ${e.message}`);
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
        console.log(`[Chrome] 候选路径不存在，跳过: ${candidate}`);
    }

    throw new Error(`未找到可用的 Chrome/Chromium。已检查: ${candidates.join(', ')}`);
}

async function launchChrome() {
    console.log('检查 Chrome 是否已在端口 ' + DEBUG_PORT + ' 上运行...');
    if (await checkPort(DEBUG_PORT)) {
        console.log('Chrome 已开启。');
        return;
    }

    const chromePath = getChromeExecutablePath();
    console.log(`正在启动 Chrome (路径: ${chromePath})...`);

    const args = [
        `--remote-debugging-address=${DEBUG_HOST}`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage',
        '--disable-features=UseDBus',
        '--window-size=1280,720',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--user-data-dir=${path.join(require('os').tmpdir(), `katabump-chrome-${process.pid}`)}`
    ];

    if (PROXY_CONFIG) {
        args.push(`--proxy-server=${PROXY_CONFIG.server}`);
        args.push('--proxy-bypass-list=<-loopback>');
    }

    const chrome = spawn(chromePath, args, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            // GitHub Actions 可能继承无效的 D-Bus 地址，避免 Chrome 启动阶段因此退出。
            DBUS_SESSION_BUS_ADDRESS: ''
        }
    });

    let chromeOutput = '';
    const collectChromeOutput = (streamName, data) => {
        const text = data.toString();
        chromeOutput += `[${streamName}] ${text}`;
        const trimmed = text.trim();
        if (trimmed) console.log(`[Chrome ${streamName}] ${trimmed}`);
        if (chromeOutput.length > 8000) chromeOutput = chromeOutput.slice(-8000);
    };

    chrome.stdout.on('data', data => collectChromeOutput('stdout', data));
    chrome.stderr.on('data', data => collectChromeOutput('stderr', data));
    chrome.on('error', err => {
        console.error(`[Chrome] 启动进程失败: ${err.message}`);
    });
    chrome.on('exit', (code, signal) => {
        if (code !== null || signal) console.log(`[Chrome] 进程退出: code=${code}, signal=${signal}`);
    });
    chrome.unref();

    console.log('正在等待 Chrome 初始化...');
    for (let i = 0; i < 30; i++) {
        if (await checkPort(DEBUG_PORT)) break;
        await new Promise(r => setTimeout(r, 1000));
    }

    if (!await checkPort(DEBUG_PORT)) {
        console.error('Chrome 无法在端口 ' + DEBUG_PORT + ' 上启动');
        if (chromeOutput.trim()) {
            console.error(`[Chrome] 最近输出:\n${chromeOutput.trim()}`);
        }
        throw new Error('Chrome 启动失败');
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
        console.error('解析 USERS_JSON 环境变量错误:', e);
    }
    return [];
}

function ensureScreenshotDir() {
    const photoDir = path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
    return photoDir;
}

function safeFileName(value) {
    return String(value || 'unknown').replace(/[^a-z0-9]/gi, '_');
}

const RENEWAL_CACHE_PATH = process.env.RENEWAL_CACHE_PATH || path.join(process.cwd(), '.renewal-cache.json');
const MONTHS = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11
};

function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
}

function getUserCacheKey(user) {
    const digest = crypto.createHash('sha256')
        .update(normalizeUsername(user.username))
        .digest('hex')
        .slice(0, 16);
    return `user_${digest}`;
}

function maskUsername(username) {
    const value = String(username || 'unknown');
    const at = value.indexOf('@');
    if (at <= 1) return '***';
    return `${value.slice(0, 2)}***${value.slice(at)}`;
}

function loadRenewalCache() {
    try {
        if (!fs.existsSync(RENEWAL_CACHE_PATH)) return {};
        const parsed = JSON.parse(fs.readFileSync(RENEWAL_CACHE_PATH, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        console.log(`[缓存] 读取续期缓存失败，将忽略: ${e.message}`);
        return {};
    }
}

function saveRenewalCache(cache) {
    try {
        const tempPath = `${RENEWAL_CACHE_PATH}.tmp`;
        fs.writeFileSync(tempPath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
        fs.renameSync(tempPath, RENEWAL_CACHE_PATH);
        console.log(`[缓存] 续期缓存已保存: ${RENEWAL_CACHE_PATH}`);
    } catch (e) {
        console.log(`[缓存] 保存续期缓存失败: ${e.message}`);
    }
}

function parseRenewalDate(dateStr, now = new Date()) {
    const match = String(dateStr || '').trim().match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    if (!Number.isInteger(day) || day < 1 || day > 31 || month === undefined) return null;

    let year = match[3] ? Number(match[3]) : now.getUTCFullYear();
    let candidate = new Date(Date.UTC(year, month, day, 0, 0, 0));
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

    // 站点只返回 "11 June" 这种无年份日期；如果已经是过去日期，按下一年处理。
    if (!match[3] && candidate < todayUtc) {
        year += 1;
        candidate = new Date(Date.UTC(year, month, day, 0, 0, 0));
    }

    if (Number.isNaN(candidate.getTime())) return null;
    return candidate.toISOString().slice(0, 10);
}

const MAX_RENEWAL_SKIP_DAYS = Number(process.env.MAX_RENEWAL_SKIP_DAYS || 7);

function getDaysUntil(dateIso, now = new Date()) {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const target = new Date(`${dateIso}T00:00:00.000Z`);
    if (Number.isNaN(target.getTime())) return null;
    return Math.ceil((target - today) / 86400000);
}

function shouldSkipUntilRenewalDate(cacheEntry, now = new Date()) {
    if (!cacheEntry || !cacheEntry.nextRenewalDate) return false;
    const daysUntil = getDaysUntil(cacheEntry.nextRenewalDate, now);
    if (daysUntil === null) return false;
    if (daysUntil <= 0) return false;
    if (daysUntil > MAX_RENEWAL_SKIP_DAYS) {
        console.log(`[缓存] 缓存日期 ${cacheEntry.nextRenewalDate} 距今 ${daysUntil} 天，超过上限 ${MAX_RENEWAL_SKIP_DAYS} 天，将忽略并按每日检查执行。`);
        return false;
    }
    return true;
}

async function saveScreenshot(page, fileName) {
    const photoDir = ensureScreenshotDir();
    const screenshotPath = path.join(photoDir, fileName);
    try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`截图已保存至: ${screenshotPath}`);
        return screenshotPath;
    } catch (e) {
        console.log('截图失败:', e.message);
        return null;
    }
}

function isTurnstileFrame(frame) {
    const frameUrl = frame.url().toLowerCase();
    return frameUrl.includes('challenges.cloudflare.com') ||
        frameUrl.includes('turnstile') ||
        frameUrl.includes('cloudflare');
}

async function hasTurnstileChallenge(page, modal) {
    // 只把 Cloudflare/Turnstile frame 中的 checkbox 识别为 Turnstile，
    // 避免把新的无验证码续期弹窗或其他普通 iframe 误判为验证码。
    for (const frame of page.frames()) {
        if (!isTurnstileFrame(frame)) continue;

        try {
            const data = await frame.evaluate(() => window.__turnstile_data).catch(() => null);
            if (data) return true;

            const checkbox = frame.locator('input[type="checkbox"], [role="checkbox"]').first();
            if (await checkbox.isVisible({ timeout: 300 })) return true;
        } catch (e) { }
    }

    try {
        const selectors = [
            'iframe[src*="challenges.cloudflare.com"]',
            'iframe[title*="turnstile" i]',
            'iframe[title*="cloudflare" i]'
        ];
        for (const selector of selectors) {
            if (await modal.locator(selector).first().isVisible({ timeout: 300 })) {
                return true;
            }
        }
    } catch (e) { }

    return false;
}

async function waitForTurnstileChallenge(page, modal, timeout = 3000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await hasTurnstileChallenge(page, modal)) return true;
        await page.waitForTimeout(250);
    }
    return false;
}

async function attemptTurnstileCdp(page) {
    const frames = page.frames();
    for (const frame of frames) {
        if (!isTurnstileFrame(frame)) continue;
        try {
            const data = await frame.evaluate(() => window.__turnstile_data).catch(() => null);

            if (data) {
                console.log('>> 在 frame 中发现 Turnstile。比例:', data);

                const iframeElement = await frame.frameElement();
                if (!iframeElement) continue;

                const box = await iframeElement.boundingBox();
                if (!box) continue;

                const clickX = box.x + (box.width * data.xRatio);
                const clickY = box.y + (box.height * data.yRatio);

                console.log(`>> 计算点击坐标: (${clickX.toFixed(2)}, ${clickY.toFixed(2)})`);

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

                console.log('>> CDP 点击已发送。');
                await client.detach();
                return true;
            }
        } catch (e) { }
    }
    return false;
}

async function clickLocatorCenter(page, locator, logMessage) {
    const box = await locator.boundingBox();
    if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
        await page.mouse.down();
        await page.waitForTimeout(80 + Math.random() * 120);
        await page.mouse.up();
    } else {
        await locator.click({ timeout: 2000 });
    }
    console.log(logMessage);
    return true;
}

async function clickVisibleCaptchaCheckbox(page, modal) {
    const frameSelectors = ['input[type="checkbox"]', '[role="checkbox"]'];
    for (const frame of page.frames()) {
        try {
            for (const selector of frameSelectors) {
                const checkbox = frame.locator(selector).first();
                if (await checkbox.isVisible({ timeout: 500 })) {
                    await checkbox.click({ timeout: 2000 });
                    console.log('   >> 已点击 frame 内可见 Captcha 复选框。');
                    return true;
                }
            }
        } catch (e) { }
    }

    const selectors = [
        'input[type="checkbox"]',
        'altcha-widget input[type="checkbox"]',
        '[role="checkbox"]'
    ];

    for (const selector of selectors) {
        try {
            const checkbox = modal.locator(selector).first();
            if (await checkbox.isVisible({ timeout: 1000 })) {
                return await clickLocatorCenter(page, checkbox, '   >> 已点击模态框内可见 Captcha 复选框。');
            }
        } catch (e) { }
    }

    try {
        const checkboxByRole = modal.getByRole('checkbox').first();
        if (await checkboxByRole.isVisible({ timeout: 1000 })) {
            return await clickLocatorCenter(page, checkboxByRole, '   >> 已按角色点击 Captcha 复选框。');
        }
    } catch (e) { }

    const widgetSelectors = ['altcha-widget', 'iframe[title*="captcha" i]', 'iframe'];
    for (const selector of widgetSelectors) {
        try {
            const widget = modal.locator(selector).first();
            if (await widget.isVisible({ timeout: 1000 })) {
                const box = await widget.boundingBox();
                if (!box) continue;
                const clickX = box.x + Math.min(28, Math.max(18, box.width * 0.12));
                const clickY = box.y + box.height / 2;
                await page.mouse.move(clickX, clickY, { steps: 8 });
                await page.mouse.down();
                await page.waitForTimeout(80 + Math.random() * 120);
                await page.mouse.up();
                console.log('   >> 已按 Captcha 组件坐标点击复选框区域。');
                return true;
            }
        } catch (e) { }
    }

    try {
        const text = modal.getByText("I'm not a robot", { exact: false }).first();
        if (await text.isVisible({ timeout: 1000 })) {
            return await clickLocatorCenter(page, text, '   >> 已点击 Captcha 文本区域。');
        }
    } catch (e) { }

    return false;
}

(async () => {
    const users = getUsers();
    if (users.length === 0) {
        console.log('未在 process.env.USERS_JSON 中找到用户');
        process.exit(1);
    }

    if (PROXY_CONFIG) {
        const isValid = await checkProxy();
        if (!isValid) {
            console.error('[代理] 代理无效，终止运行。');
            process.exit(1);
        }
    }

    await launchChrome();

    console.log(`正在连接 Chrome...`);
    let browser;
    for (let k = 0; k < 5; k++) {
        try {
            browser = await chromium.connectOverCDP(`http://${DEBUG_HOST}:${DEBUG_PORT}`);
            console.log('连接成功！');
            break;
        } catch (e) {
            console.log(`连接尝试 ${k + 1} 失败。2秒后重试...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (!browser) {
        console.error('连接失败。退出。');
        process.exit(1);
    }

    const context = browser.contexts()[0];
    let page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    page.setDefaultTimeout(60000);
    let hasFailure = false;
    const renewalCache = loadRenewalCache();

    if (PROXY_CONFIG && PROXY_CONFIG.username) {
        console.log('[代理] 正在设置认证...');
        await context.setHTTPCredentials({
            username: PROXY_CONFIG.username,
            password: PROXY_CONFIG.password
        });
    } else {
        await context.setHTTPCredentials(null);
    }

    await page.addInitScript(INJECTED_SCRIPT);
    console.log('注入脚本已添加。');

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        if (!user || !normalizeUsername(user.username) || !user.password) {
            console.error(`[配置] 用户 ${i + 1} 缺少有效的 username 或 password，跳过。`);
            hasFailure = true;
            continue;
        }
        const safeUsername = safeFileName(user.username);
        const cacheKey = getUserCacheKey(user);
        const displayUsername = maskUsername(user.username);
        const cacheEntry = renewalCache[cacheKey];
        console.log(`\n=== 正在处理用户 ${i + 1}/${users.length} (${displayUsername}) ===`);

        if (shouldSkipUntilRenewalDate(cacheEntry)) {
            console.log(`[缓存] 当前未到站点返回的下次可续期日期 ${cacheEntry.nextRenewalDate}，跳过本次运行。`);
            await sendTelegramMessage(`⏳ *续期暂缓*\n用户: ${displayUsername}\n原因: 未到站点返回的下次可续期日期\n下次可用: ${cacheEntry.nextRenewalDate}`);
            continue;
        }

        try {
            if (page.isClosed()) {
                page = await context.newPage();
                // Context credentials apply
                await page.addInitScript(INJECTED_SCRIPT);
            }

            // --- 登录逻辑 (保持原版流程) ---
            if (page.url().includes('/auth/login')) {
                // 已在登录页，继续填写表单
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

            console.log('正在输入凭据...');
            try {
                const emailInput = page.getByRole('textbox', { name: 'Email' });
                await emailInput.waitFor({ state: 'visible', timeout: 5000 });
                await emailInput.fill(user.username);
                const pwdInput = page.getByRole('textbox', { name: 'Password' });
                await pwdInput.fill(user.password);
                await page.waitForTimeout(500);

                // --- Cloudflare Turnstile Bypass for Login ---
                console.log('   >> 正在登录前检查 Turnstile (使用 CDP 绕过)...');
                let cdpClickResult = false;
                for (let findAttempt = 0; findAttempt < 15; findAttempt++) {
                    cdpClickResult = await attemptTurnstileCdp(page);
                    if (cdpClickResult) break;
                    await page.waitForTimeout(1000);
                }

                if (cdpClickResult) {
                    console.log('   >> 登录 CDP 点击生效。正在等待最多 10秒 Cloudflare 成功标志...');
                    for (let waitSec = 0; waitSec < 10; waitSec++) {
                        const frames = page.frames();
                        let isSuccess = false;
                        for (const f of frames) {
                            if (f.url().includes('cloudflare')) {
                                try {
                                    if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                        isSuccess = true;
                                        break;
                                    }
                                } catch (e) { }
                            }
                        }
                        if (isSuccess) {
                            console.log('   >> 登录前 Turnstile 验证成功。');
                            break;
                        }
                        await page.waitForTimeout(1000);
                    }
                } else {
                    console.log('   >> 登录前未检测到或未点击 Turnstile，继续操作...');
                }

                await page.getByRole('button', { name: 'Login', exact: true }).click();

                try {
                    const errorMsg = page.getByText('Incorrect password or no account');
                    if (await errorMsg.isVisible({ timeout: 3000 })) {
                        console.error(`   >> ❌ 登录失败: 用户 ${displayUsername} 账号或密码错误`);
                        hasFailure = true;
                        const failShotPath = await saveScreenshot(page, `${safeUsername}_login_failed.png`);
                        await sendTelegramMessage(`❌ *登录失败*\n用户: ${displayUsername}\n原因: 账号或密码错误`, failShotPath);
                        continue;
                    }
                } catch (e) { }
            } catch (e) {
                console.log('登录错误:', e.message);
            }

            console.log('正在寻找 "See" 链接...');
            try {
                await page.getByRole('link', { name: 'See' }).first().waitFor({ timeout: 15000 });
                await page.waitForTimeout(1000);
                await page.getByRole('link', { name: 'See' }).first().click();
            } catch (e) {
                console.log('未找到 "See" 按钮。');
                continue;
            }

            // --- Renew 逻辑 ---
            let renewSuccess = false;
            let failureReported = false;
            // 2. 一个扁平化的主循环：尝试 Renew 整个流程 (最多 20 次)
            for (let attempt = 1; attempt <= 20; attempt++) {
                let hasCaptchaError = false;

                // 1. 如果是重试 (attempt > 1)，说明之前失败了或者刚刷新完页面
                // 我们直接开始寻找 Renew 按钮
                console.log(`\n[尝试 ${attempt}/20] 正在寻找 Renew 按钮...`);

                const renewBtn = page.getByRole('button', { name: 'Renew', exact: true }).first();
                try {
                    // 稍微等待一下，防止页面刚刷新还没渲染出来
                    await renewBtn.waitFor({ state: 'visible', timeout: 5000 });
                } catch (e) { }

                if (await renewBtn.isVisible()) {
                    await renewBtn.click();
                    console.log('Renew 按钮已点击。等待模态框...');

                    const modal = page.locator('#renew-modal');
                    try { await modal.waitFor({ state: 'visible', timeout: 5000 }); } catch (e) {
                        console.log('模态框未出现？重试中...');
                        continue;
                    }

                    // A. 在模态框里晃晃鼠标
                    try {
                        const box = await modal.boundingBox();
                        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
                    } catch (e) { }

                    // 新版续期弹窗可能完全不包含 Turnstile：此时直接确认续期。
                    // 只有明确检测到 Cloudflare/Turnstile 控件时，才执行验证码处理。
                    const hasTurnstile = await waitForTurnstileChallenge(page, modal);
                    let cdpClickResult = false;
                    if (hasTurnstile) {
                        console.log('检测到 Turnstile，开始执行验证流程...');
                        for (let findAttempt = 0; findAttempt < 30; findAttempt++) {
                            cdpClickResult = await attemptTurnstileCdp(page);
                            if (cdpClickResult) break;
                            console.log(`   >> [寻找尝试 ${findAttempt + 1}/30] 尚未找到 Turnstile 复选框...`);
                            await page.waitForTimeout(1000);
                        }

                        if (cdpClickResult) {
                            console.log('   >> CDP 点击已发送，等待 Cloudflare 检查...');
                            await page.waitForTimeout(8000);
                        } else {
                            console.log('   >> 未能通过 CDP 定位 Turnstile，尝试普通可见控件...');
                            const checkboxClickResult = await clickVisibleCaptchaCheckbox(page, modal);
                            if (checkboxClickResult) await page.waitForTimeout(8000);
                        }
                    } else {
                        console.log('未检测到 Turnstile，直接执行续期确认。');
                    }

                    let isTurnstileSuccess = !hasTurnstile;
                    if (hasTurnstile) {
                        const frames = page.frames();
                        for (const f of frames) {
                            if (!isTurnstileFrame(f)) continue;
                            try {
                                if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                    isTurnstileSuccess = true;
                                    break;
                                }
                            } catch (e) { }
                        }
                    }

                    // 无论是否存在验证码，最终都点击弹窗中的 Renew。
                    // 新版无验证码弹窗会在这一步直接完成续签。
                    const confirmBtn = modal.getByRole('button', { name: 'Renew', exact: true }).last();
                    if (await confirmBtn.isVisible()) {

                        // User Requested: Screenshot BEFORE final click
                        const tsScreenshotName = `${safeUsername}_Turnstile_${attempt}.png`;
                        await saveScreenshot(page, tsScreenshotName);

                        // User Request: 找不到的话这个循环直接下一步点击renew，然后检测有没有Please complete the captcha to continue
                        console.log('   >> 点击 Renew 确认按钮 (无论 Turnstile 状态如何)...');
                        await confirmBtn.click();

                        try {
                            // 1. Check for Errors (Captcha or Date limit)
                            const startVerifyTime = Date.now();
                            while (Date.now() - startVerifyTime < 3000) {
                                // A. Captcha Error
                                if (await page.getByText('Please complete the captcha to continue').isVisible()) {
                                    console.log('   >> ⚠️ 检测到错误: "Please complete the captcha".');
                                    hasCaptchaError = true;
                                    break;
                                }

                                // B. Not Renew Time Error
                                const notTimeLoc = page.getByText("You can't renew your server yet");
                                if (await notTimeLoc.isVisible()) {
                                    const text = await notTimeLoc.innerText();
                                    const match = text.match(/as of\s+(.*?)\s+\(/);
                                    let dateStr = match ? match[1] : 'Unknown Date';
                                    const nextRenewalDate = parseRenewalDate(dateStr);
                                    console.log(`   >> ⏳ 暂无法续期。下次可用时间: ${dateStr}${nextRenewalDate ? ` (${nextRenewalDate})` : ''}`);

                                    if (nextRenewalDate) {
                                        renewalCache[cacheKey] = {
                                            nextRenewalDate,
                                            rawDate: dateStr,
                                            updatedAt: new Date().toISOString()
                                        };
                                        saveRenewalCache(renewalCache);
                                    } else {
                                        delete renewalCache[cacheKey];
                                        saveRenewalCache(renewalCache);
                                    }

                                    // 截图证明
                                    const skipShotPath = await saveScreenshot(page, `${safeUsername}_skip.png`);

                                    await sendTelegramMessage(`⏳ *暂无法续期 (跳过)*\n用户: ${displayUsername}\n原因: 还没到时间\n下次可用: ${nextRenewalDate || dateStr}`, skipShotPath);

                                    renewSuccess = true; // Mark as done to stop retries
                                    try {
                                        const closeBtn = modal.getByLabel('Close');
                                        if (await closeBtn.isVisible()) await closeBtn.click();
                                    } catch (e) { }
                                    break;
                                }
                                await page.waitForTimeout(200);
                            }
                        } catch (e) { }

                        if (renewSuccess) break; // Break loop if not time yet

                        if (hasCaptchaError) {
                            console.log('   >> Error found. Refreshing page to reset Turnstile...');
                            await page.reload();
                            await page.waitForTimeout(3000);
                            continue; // 刷新后，重新开始大循环
                        }

                        // F. 检查成功 (模态框消失)
                        await page.waitForTimeout(2000);
                        if (!await modal.isVisible()) {
                            console.log('   >> ✅ Modal closed. Renew successful!');

                            // 截图成功状态
                            const successShotPath = await saveScreenshot(page, `${safeUsername}_success.png`);

                            await sendTelegramMessage(`✅ *续期成功*\n用户: ${displayUsername}\n状态: 服务器已成功续期！`, successShotPath);
                            renewSuccess = true;
                            break;
                        } else {
                            console.log('   >> 模态框仍打开但无错误？重试循环...');
                            await page.reload();
                            await page.waitForTimeout(3000);
                            continue;
                        }
                    } else {
                        console.log('   >> 未找到模态框内的验证按钮？刷新中...');
                        await page.reload();
                        await page.waitForTimeout(3000);
                        continue;
                    }

                } else {
                    console.log('未找到 Renew 按钮 (服务器可能已续期或页面加载错误)。');
                    break;
                }
            }

            if (!renewSuccess && !failureReported) {
                hasFailure = true;
                const failShotPath = await saveScreenshot(page, `${safeUsername}_renew_failed.png`);
                await sendTelegramMessage(
                    `❌ *续期失败*\n用户: ${displayUsername}\n原因: 未能确认续期成功。请查看截图和 Actions 日志。`,
                    failShotPath
                );
            }
        } catch (err) {
            console.error(`Error processing user:`, err);
            hasFailure = true;
            const errorShotPath = await saveScreenshot(page, `${safeUsername}_error.png`);
            await sendTelegramMessage(
                `❌ *处理失败*\n用户: ${displayUsername}\n原因: 脚本异常: ${err.message}`,
                errorShotPath
            );
        }

        // Snapshot before handling next user
        await saveScreenshot(page, `${safeUsername}.png`);

        console.log(`用户处理完成\n`);
    }

    if (hasFailure) {
        console.error('完成，但存在处理失败的用户。退出码 1，避免 GitHub Actions 假成功。');
        await browser.close();
        process.exit(1);
    }

    console.log('完成。');
    await browser.close();
    process.exit(0);
})();
