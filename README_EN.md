# Katabump Server Auto-Renewal Tool

[English Version](README_EN.md) | [中文说明](README.md)

This project is an automation script for renewing Katabump servers. It utilizes Playwright and CDP (Chrome DevTools Protocol) to simulate user interactions, effectively specifically targeting the Cloudflare Turnstile CAPTCHA to ensure continuous server service.

It supports both **Windows Local Execution** and **GitHub Actions Cloud Execution**.

## ✨ Features

- **Adaptive verification**: The renewal modal first checks whether a Cloudflare Turnstile challenge is actually present. If present, the corresponding verification flow runs; otherwise, the script directly clicks the `Renew` button in the modal.
- **Auto-Retry**: Refreshes the page and retries when verification fails or the page enters an unexpected state.
- **Multi-User**: Supports batch renewal for multiple accounts.
- **Cloud/Local**: Can run on your local machine or automatically on part of a daily schedule using GitHub Actions.

---

## 🚀 GitHub Actions Cloud Run (Recommended)

This is the easiest way to set it up once and have it run automatically every day.

1.  **Fork this repository** to your GitHub account.
2.  Go to your repository settings: **Settings** -> **Secrets and variables** -> **Actions**.
3.  Click **New repository secret** and add a secret named `USERS_JSON`.
4.  The **Value** must be a JSON array (condensed into a single line is best):
    ```json
    [{"username": "your_email@example.com", "password": "your_password"}, {"username": "another@example.com", "password": "pwd"}]
    ```
5.  **(Optional) Configure Proxy**:
    If you need to run behind a proxy (e.g. to avoid IP blocks), add a Secret named `HTTP_PROXY`.
    -   **Format**:
        -   No Auth: `http://ip:port`
        -   With Auth: `http://username:password@ip:port`
    -   **Note**: The script validates the proxy before use. Default is disabled.
6.  **(Optional) Telegram Notifications**:
    If you want to receive Telegram notifications (with screenshots) upon renewal success, failure, or skip, add the following Secrets:
    -   `TG_BOT_TOKEN`: Your Telegram Bot Token (from @BotFather).
    -   `TG_CHAT_ID`: Your Chat ID (User ID or Group ID).
    > If not configured, notifications will be skipped.
### 4. Results & Screenshots
- **Logs**: Check real-time logs in the `Run Renew Script` step.
- **Screenshots**: Screenshots are automatically captured for each user (success or failure) and uploaded as artifacts.
  - Download the `screenshots` zip file from the **Artifacts** section of the workflow run summary.
  - Files are named `username.png`.
5.  Save it. Then, go to the **Actions** tab and enable the workflow. It is scheduled to run automatically at **08:00 Beijing Time (00:00 UTC)**.
6.  You can also manually click "Run workflow" to test it immediately.

---

## 💻 Windows Local Execution Guide

Follow these steps if you want to run the script locally on your computer for debugging or monitoring.

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed (version v18+ recommended).

### 2. Install Dependencies
Open a terminal (PowerShell or CMD) in the project root directory and run:
```bash
npm install
```

### 3. Configure Credentials
The project contains a `login.json.template` file.
1. **Rename** it to `login.json`.
2. Open it with a text editor and fill in your account credentials:
   ```json
   [
       {
           "username": "myemail@gmail.com",
           "password": "mypassword123"
       }
   ]
   ```
   > **Note**: `login.json` is included in `.gitignore` and will NOT be uploaded to GitHub.

### 4. Configure Chrome Path
Open the `renew.js` file and look for lines 11-12:

```javascript
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'ChromeData_Katabump');
const HEADLESS = true;
```

*   **CHROME_PATH**: This is the installation path of your local Chrome browser. Modify this if your installation path is different!
*   **USER_DATA_DIR**:
    *   This folder stores browser data generated during script execution (cache, cookies, sessions, etc.).
    *   **Purpose**: It helps maintain your login session so you don't need to re-enter credentials every time.
    *   **Can it be deleted?**: **Yes**. If you want to reset all states (clear cache completely), simply delete this folder. The script will recreate it the next time it runs.
*   **HEADLESS**:
    *   `false`: The script launches a visible Chrome window so you can see what it's doing.
    *   `true`: (Default) Runs silently in the background (headless mode), useful if you want it to run without disturbing you.

### 5. Run Script

If you need to use a proxy, set the `HTTP_PROXY` environment variable:

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

Or just run without proxy:
```bash
node renew.js
```
The script will auto-launch Chrome (if needed), process each account, and save a screenshot (`username.png`) in the `photo/` directory upon completion.

---

## 🛠️ Project Structure

*   `renew.js`: Main script for Windows local execution.
*   `action_renew.js`: Dedicated script for GitHub Actions environment (Linux/Headless adapted).
*   `.github/workflows/renew.yml`: Configuration file for GitHub Actions scheduled tasks.
*   `login.json`: (Manually created) Stores account info for local runs.
