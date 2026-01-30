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

1.  **Fork 本仓库** 到你的 GitHub 账号。
2.  进入你的仓库，点击 **Settings** -> **Secrets and variables** -> **Actions**。
3.  点击 **New repository secret**，添加一个名为 `USERS_JSON` 的 Secret。
4.  **Value** 的格式必须是 JSON 数组（请尽量压缩为一行）：
    ```json
    [{"username": "your_email@example.com", "password": "your_password"}, {"username": "another@example.com", "password": "pwd"}]
    ```
5.  保存后，进入 **Actions** 页面，启用 Workflow。它会在**每天北京时间 08:00 (UTC 00:00)** 自动运行。
6.  你也可以手动点击 "Run workflow" 立即测试。

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

### 4. 配置 Chrome 路径
打开 `renew.js` 文件，找到第 11-12 行：

```javascript
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = "C:\\ChromeData_Katabump";
const HEADLESS = false;
```

*   **CHROME_PATH**: 这是你本地 Chrome 浏览器的安装路径。如果你的安装位置不同，请务必修改！
*   **USER_DATA_DIR**:
    *   这是一个用于存放 Script 运行时产生的浏览器数据（缓存、Cookie、登录状态等）的文件夹。
    *   **作用**: 它能让你的登录状态保持更久，不需要每次运行都重新输入密码。
    *   **能不能删？**: **可以删**。如果你想要重置所有状态（彻底清除缓存），只需删除这个文件夹即可。脚本下次运行时会自动重新创建它。
*   **HEADLESS**:
    *   `false`: (默认) 脚本运行时会弹出一个 Chrome 窗口，你可以看到它在做什么。
    *   `true`: 脚本在后台无头运行，界面不可见（适合只想静默完成任务时开启）。

### 5. 运行脚本
在终端中执行：
```bash
node renew.js
```
脚本会自动启动一个 Chrome 窗口（默认无头模式为 false，你可以看到操作过程），并依次为列表中的用户续期。

---

## 🛠️ 项目结构

*   `renew.js`: Windows 本地运行的主程序。
*   `action_renew.js`: 专门用于 GitHub Actions 环境的脚本（适配 Linux/Headless）。
*   `.github/workflows/renew.yml`: GitHub Actions 的定时任务配置文件。
*   `login.json`: (需手动创建) 存放本地运行的账号信息。
