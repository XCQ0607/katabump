# Katabump Server Auto-Renewal Tool

[English Version](README_EN.md) | [中文说明](README.md)

这是一个用于自动续期 Katabump 服务器的自动化脚本。它利用 Playwright 和 CDP (Chrome DevTools Protocol) 技术来模拟用户操作，能够有效绕过 Cloudflare Turnstile 验证码，确保持续的服务器服务。

支持 **Windows 本地运行** 和 **GitHub Actions 云端运行**。

## ✨ 特性

- **智能过盾**: 通过 CDP 协议模拟真实鼠标轨迹和点击行为，结合屏幕坐标伪造，高成功率绕过 Cloudflare Turnstile。
- **自动重试**: 内置严格的验证重试机制，如果验证失败会自动重启验证流程。
- **多用户支持**: 支持配置多个账号批量续期。
- **云端/本地**: 既可以在本地电脑跑，也可以利用 GitHub Actions 每天定时自动跑。

---

## 🚀 GitHub Actions 云端运行 (推荐)

这是最省心的方式，配置一次即可每天自动执行。

1. **Fork 本仓库** 到你的 GitHub 账号。
2. 进入你的仓库，点击 **Settings** -> **Secrets and variables** -> **Actions**。
3. 点击 **New repository secret**，添加一个名为 `USERS_JSON` 的 Secret。
4. **Value** 的格式必须是 JSON 数组（请尽量压缩为一行）：
   ```json
   [{"username": "your_email@example.com", "password": "your_password"}, {"username": "another@example.com", "password": "pwd"}]
   ```
5. **(可选) 配置代理**:
   如果 GitHub Actions 的 IP 被屏蔽，或者你想使用特定的 IP 访问，可以添加名为 `HTTP_PROXY` 的 Secret。
   - **格式**:
     - 无认证: `http://ip:port`
     -带认证: `http://username:password@ip:port`
   - **说明**: 脚本会自动检测代理有效性，如果支持认证会自动处理。默认不启用。

6. **(可选) Telegram 通知**  
   续期完成后可收到 Telegram 消息汇总（成功/失败/跳过及每个账号的简要结果）。
   - 在 Telegram 中找 [@BotFather](https://t.me/BotFather) 创建机器人，获得 **Bot Token**。
   - 与你的机器人对话一次（发任意消息），然后访问  
     `https://api.telegram.org/bot<你的TOKEN>/getUpdates`  
     在返回的 JSON 里找到 `"chat":{"id": 数字}`，该数字即为 **Chat ID**。
   - 在仓库 **Settings → Secrets and variables → Actions** 中新增两个 Secret：
     - `TELEGRAM_BOT_TOKEN`：机器人 Token
     - `TELEGRAM_CHAT_ID`：你的 Chat ID（数字或带负号的群组 ID）
   - 不配置则不会发送通知，不影响续期流程。

### 4. 运行结果与截图

- **运行日志**: 在 Actions 中的 `Run Renew Script` 步骤查看。
- **截图留存**: 每次运行（无论成功与否），通过 `Upload Screenshots` 步骤自动上传截图。
  - 你可以在 Workflow 运行详情页的 **Artifacts** 区域下载 `screenshots` 压缩包。
  - 每个账号对应一张截图（`username.png`），方便确认状态。

5. 保存后，进入 **Actions** 页面，启用 Workflow。它会在**每天北京时间 08:00 (UTC 00:00)** 自动运行。
6. 你也可以手动点击 "Run workflow" 立即测试。

---

## 💻 Windows 本地运行指南

如果你想在本地观察运行过程或进行调试，请按以下步骤操作。

### 1. 环境准备

确保你已经安装了 [Node.js](https://nodejs.org/) (建议版本 v18+)。

### 2. 安装依赖

在项目根目录打开终端 (PowerShell 或 CMD)，运行：

```bash
npm install
```

### 3. 配置账号

项目中有一个 `login.json.template` 模板文件。

1. 将其**重命名**为 `login.json`。
2. 用记事本或编辑器打开，填入你的账号密码：
   ```json
   [
       {
           "username": "myemail@gmail.com",
           "password": "mypassword123"
       }
   ]
   ```

   > **注意**: `login.json` 已被加入 `.gitignore`，不会被上传到 GitHub，请放心使用。
   >

### 4. 配置 Chrome 路径

打开 `renew.js` 文件，找到第 11-12 行：

```javascript
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'ChromeData_Katabump');
const HEADLESS = true;
```

* **CHROME_PATH**: 这是你本地 Chrome 浏览器的安装路径。如果你的安装位置不同，请务必修改！
* **USER_DATA_DIR**:
  * 这是一个用于存放 Script 运行时产生的浏览器数据（缓存、Cookie、登录状态等）的文件夹。
  * **作用**: 它能让你的登录状态保持更久，不需要每次运行都重新输入密码。
  * **能不能删？**: **可以删**。如果你想要重置所有状态（彻底清除缓存），只需删除这个文件夹即可。脚本下次运行时会自动重新创建它。
* **HEADLESS**:
  * `false`: 脚本运行时会弹出一个 Chrome 窗口，你可以看到它在做什么。
  * `true`: (默认)脚本在后台无头运行，界面不可见（适合只想静默完成任务时开启）。

### 3. 运行脚本

如果你需要使用代理运行脚本，请设置环境变量 `HTTP_PROXY`：

**Powershell:**
```powershell
$env:HTTP_PROXY="http://user:pass@127.0.0.1:7890"
node renew.js
```

**CMD:**
```cmd
set HTTP_PROXY=http://user:pass@127.0.0.1:7890
node renew.js
```

如果不设置代理，直接运行：
```bash
node renew.js
```

脚本会自动启动 Chrome (如果需要)，逐个处理账号，并在根目录下的 `photo/` 文件夹中保存每个账号运行结束时的截图（`账号名.png`）。窗口（默认无头模式为 false，你可以看到操作过程），并依次为列表中的用户续期。

---

## 🛠️ 项目结构

* `renew.js`: Windows 本地运行的主程序。
* `action_renew.js`: 专门用于 GitHub Actions 环境的脚本（适配 Linux/Headless）。
* `.github/workflows/renew.yml`: GitHub Actions 的定时任务配置文件。
* `login.json`: (需手动创建) 存放本地运行的账号信息。
