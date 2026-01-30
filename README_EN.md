# Katabump Server Auto-Renewal Tool

[English Version](README_EN.md) | [中文说明](README.md)

This project is an automation script for renewing Katabump servers. It utilizes Playwright and CDP (Chrome DevTools Protocol) to simulate user interactions, effectively specifically targeting the Cloudflare Turnstile CAPTCHA to ensure continuous server service.

It supports both **Windows Local Execution** and **GitHub Actions Cloud Execution**.

## ✨ Features

- **Smart Bypass**: Uses CDP to simulate realistic mouse trajectories and clicks, combined with screen coordinate spoofing, to achieve a high success rate in bypassing Cloudflare Turnstile.
- **Auto-Retry**: Built-in strict verification retry mechanism. It automatically restarts the verification flow if the CAPTCHA check fails.
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
const USER_DATA_DIR = "C:\\ChromeData_Katabump";
const HEADLESS = false;
```

*   **CHROME_PATH**: This is the installation path of your local Chrome browser. Modify this if your installation path is different!
*   **USER_DATA_DIR**:
    *   This folder stores browser data generated during script execution (cache, cookies, sessions, etc.).
    *   **Purpose**: It helps maintain your login session so you don't need to re-enter credentials every time.
    *   **Can it be deleted?**: **Yes**. If you want to reset all states (clear cache completely), simply delete this folder. The script will recreate it the next time it runs.
*   **HEADLESS**:
    *   `false`: (Default) The script launches a visible Chrome window so you can see what it's doing.
    *   `true`: Runs silently in the background (headless mode), useful if you want it to run without disturbing you.

### 5. Run Script
Execute in terminal:
```bash
node renew.js
```
The script will launch a Chrome window (visible by default) and proceed to renew servers for users in the list one by one.

---

## 🛠️ Project Structure

*   `renew.js`: Main script for Windows local execution.
*   `action_renew.js`: Dedicated script for GitHub Actions environment (Linux/Headless adapted).
*   `.github/workflows/renew.yml`: Configuration file for GitHub Actions scheduled tasks.
*   `login.json`: (Manually created) Stores account info for local runs.
