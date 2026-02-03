/**
 * Telegram 通知模块
 * 通过 Bot API 发送消息和图片，需配置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID
 */
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function isConfigured() {
    return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

/**
 * 发送 Telegram 文本消息
 * @param {string} text - 消息内容（支持 Markdown/HTML，见 parse_mode）
 * @param {string} [parseMode='HTML'] - 'HTML' | 'Markdown' | 'MarkdownV2'
 * @returns {Promise<boolean>} 是否发送成功
 */
async function sendMessage(text, parseMode = 'HTML') {
    if (!isConfigured()) {
        console.log('[Telegram] TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID 未配置，跳过通知');
        return false;
    }
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        const payload = {
            chat_id: TELEGRAM_CHAT_ID,
            text,
            parse_mode: parseMode,
            disable_web_page_preview: true
        };
        await axios.post(url, payload, { timeout: 10000 });
        console.log('[Telegram] 通知已发送');
        return true;
    } catch (err) {
        console.error('[Telegram] 发送失败:', err.response?.data || err.message);
        return false;
    }
}

/**
 * 转义 HTML 特殊字符，避免在 parse_mode=HTML 下格式错误
 */
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * 格式化续期结果并发送 Telegram 通知
 * @param {Array<{username:string, status:string, message?:string}>} results - 每用户结果
 * @param {string} [summary] - 可选总体摘要，如 "全部完成" / "部分失败"
 */
async function notifyRenewResults(results, summary = '') {
    const lines = ['<b>🔔 Katabump 续期完成</b>', ''];
    if (summary) {
        lines.push(summary);
        lines.push('');
    }
    const statusEmoji = { success: '✅', fail: '❌', skip: '⏭️' };
    for (const r of results) {
        const emoji = statusEmoji[r.status] || '•';
        const user = escapeHtml(r.username);
        const msg = r.message ? escapeHtml(r.message) : r.status;
        lines.push(`${emoji} ${user}: ${msg}`);
    }
    const text = lines.join('\n');
    return sendMessage(text);
}

/**
 * 发送一张图片到 Telegram
 * @param {string} filePath - 图片本地路径
 * @param {string} [caption] - 可选说明文字（caption 最长 1024 字符）
 * @returns {Promise<boolean>}
 */
async function sendPhoto(filePath, caption = '') {
    if (!isConfigured()) return false;
    if (!fs.existsSync(filePath)) {
        console.error('[Telegram] 文件不存在:', filePath);
        return false;
    }
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    try {
        const form = new FormData();
        form.append('chat_id', TELEGRAM_CHAT_ID);
        form.append('photo', fs.createReadStream(filePath), { filename: path.basename(filePath) });
        if (caption) form.append('caption', caption);
        await axios.post(url, form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 60000
        });
        return true;
    } catch (err) {
        console.error('[Telegram] 发送图片失败:', filePath, err.response?.data || err.message);
        return false;
    }
}

/**
 * 将指定目录下所有截图发送到 Telegram（按文件名排序）
 * @param {string} dirPath - 截图目录，如 process.cwd() + '/screenshots'
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function sendScreenshotsFromDir(dirPath) {
    if (!isConfigured()) return { sent: 0, failed: 0 };
    if (!fs.existsSync(dirPath)) {
        console.log('[Telegram] 截图目录不存在，跳过发送:', dirPath);
        return { sent: 0, failed: 0 };
    }
    const files = fs.readdirSync(dirPath)
        .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
        .map(f => path.join(dirPath, f))
        .filter(p => fs.statSync(p).isFile())
        .sort();
    let sent = 0;
    let failed = 0;
    for (const filePath of files) {
        const caption = path.basename(filePath, path.extname(filePath));
        const ok = await sendPhoto(filePath, caption);
        if (ok) sent++; else failed++;
        await new Promise(r => setTimeout(r, 500));
    }
    if (files.length > 0) {
        console.log(`[Telegram] 截图已发送: ${sent} 张${failed ? `, 失败 ${failed} 张` : ''}`);
    }
    return { sent, failed };
}

module.exports = {
    isConfigured,
    sendMessage,
    sendPhoto,
    sendScreenshotsFromDir,
    notifyRenewResults,
    escapeHtml
};
