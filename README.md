# ChillrendLifeOS

A private, self-hosted Discord Bot for personal task management (**Vikunja**) and financial tracking (**Actual Budget**), powered by **Gemini AI** and local **SQLite** caching.

Designed for high-productivity single-user environments with minimal overhead and zero friction.

---

## 🚀 Features

### 📋 Task Management (Vikunja Integration)
Directly integrates with your Vikunja Project Kanban board views:
-   **`/todo [title] [description]`** – AI refines your task, structures notes into markdown, and assigns tags and priority.
    -   *Dates Default:* Automatically sets the **Start Date** to `now()`, and calculates your **Due Date** to the end of the work week (**Friday at 6:00 PM**) in your local timezone.
    -   *Kanban Placement:* Placed directly into your active **Backlog** column.
-   **`/backlog`** – View your active backlog (shows both unassigned tasks and Backlog column tasks) and **In Progress** tasks.
-   **`/switch [task] [state]`** – Moves tasks dynamically across Kanban columns. Moving a task into the **Done** column automatically sets its completion status to true.
-   **`/comment [task] [comment]`** – Appends a comment to an active task.
-   **`/daily [date]`** – Generates a plain-text timesheet log of your completed and in-progress tasks.
    -   *Real-time for Today:* Queries live and refreshes instantly.
    -   *Cached for Past Dates:* Retrieves from a local **SQLite database** to eliminate API latency and save AI tokens.
-   **`/wrapup`** – Generates a weekly retro report of completed tasks over the last 7 days.
    -   *Rollover:* Automatically extends any unfinished active tasks to next Friday at 6:00 PM.
    -   *Cleanup:* Unassigns completed tasks from your Kanban "Done" column (sets `bucket_id` to `0`) so the column stays empty and pristine for the new week without deleting any of your task data.

### 📅 Set-and-Forget Automations (Node-Cron)
Runs timezone-aware schedules natively inside your Docker container:
-   **Daily Report (15:30 on Weekdays):** Generates a live workday timesheet summary and sends it directly to your Discord DM.
-   **Weekly Board Wrap-up (Fridays at 20:00):** Compiles your weekly retroactive report, executes the Kanban board cleanup and active task rollover, and sends you a DM update.

### 💰 Financial Tracking (Actual Budget Integration)
-   **`/expense [details]`** – Log expenses using natural language (e.g., `"beli kopi 20k di starbucks"`). Gemini parses the payee, amount, and categorizes it based on your actual budget accounts.
-   **`/income [details]`** – Log income.
-   **`/transfer [details]`** – Log transfers between accounts.
-   **`/balance [query]`** – Query balances for specific accounts, category spending progress, or general net summaries using natural language (e.g., `"sisa budget snacks"`).

### 📡 Finance Webhook & Web-UI
Integrate external services (like n8n, iOS Shortcuts, or web scrapers) with automated decision-making:

#### 🔒 Webhook Security
To prevent unauthorized requests, the webhook endpoint is protected by a **Bearer Token** authentication mechanism.
When sending requests to the webhook, you **MUST** include the following HTTP header:
```http
Authorization: Bearer <your_FINANCE_WEBHOOK_SECRET>
```
This secret token is configured in your `.env` file via the `FINANCE_WEBHOOK_SECRET` variable.

---

#### 📥 Webhook Payload Formats

The `POST /webhook/finance` endpoint accepts flexible JSON objects. Below are the structured payload examples:

##### A. Standard Expense / Income (By Name fallback)
```json
{
  "amount": 45000,
  "account": "GoPay Wallet",
  "category": "🥫 Mandatory Food",
  "payee_name": "Kopi Kenangan",
  "description": "Es Kopi Susu Aren",
  "date": "2026-09-04",
  "type": "expense" // Use "income" for positive income transactions
}
```

##### B. Standard Expense / Income (Using Explicit UUIDs - Recommended for n8n/MCP)
```json
{
  "amount": 25000,
  "account_id": "4e3d68f2-3698-410b-98be-49f974b160a7", // Mandiri Payroll Account UUID
  "category_id": "19b6776a-3d7d-470c-b629-65f6111e0cac", // Snacks Category UUID
  "payee_id": "optional_payee_uuid_here", // If omitted, payee_name is used
  "payee_name": "Alfamart",
  "description": "Camilan sore",
  "date": "2026-09-04",
  "type": "expense"
}
```

##### C. Internal Transfer Between Accounts (By Name fallback)
```json
{
  "amount": 500000,
  "account": "Mandiri Payroll Account", // Source account
  "destination_account": "GoPay Wallet", // Destination account
  "description": "Top-up GoPay",
  "date": "2026-09-04",
  "type": "transfer"
}
```

##### D. Internal Transfer Between Accounts (Using Explicit UUIDs)
```json
{
  "amount": 100000,
  "source_account_id": "4e3d68f2-3698-410b-98be-49f974b160a7", // Source Account UUID
  "destination_account_id": "83ecd7d9-c258-4848-93b0-d3f1a325b093", // Destination Account UUID
  "description": "Top-up GoPay wallet from Mandiri",
  "date": "2026-09-04",
  "type": "transfer"
}
```

---

#### 📱 Interactive Bot Flow
1.  The webhook receives a secure POST request and saves it in SQLite with a `pending` status.
2.  It sends you a Discord DM with **[ Accept ]**, **[ Deny ]**, and **[ Modify ]** buttons.
    *   *Accept:* Logs the transaction immediately to Actual Budget and turns the DM embed green.
    *   *Deny:* Rejects the transaction, logs it internally in SQLite, and turns the DM embed red.
3.  **Secure Web-UI Modification:** Clicking *Modify* sends you an ephemeral URL containing a secure cryptographic HMAC validation token.
    -   Opens a styled, responsive dark-theme Web-UI.
    -   Loads accounts and categories live from your Actual Budget server.
    -   Allows modification and logging securely in your browser. Saving automatically updates your Discord DM to green and removes buttons.

---

## 🛠️ Setup & Run

### 1. Configure `.env`
Clone your configuration file:
```bash
cp .env.example .env
```
Populate the parameters in `.env`:
*   **Discord:** `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `OWNER_ID`, `DISCORD_CLIENT_SECRET`.
*   **Vikunja:** `VIKUNJA_API_URL`, `VIKUNJA_PROJECT_ID`, and your individual bucket column IDs. *(You can run `node src/utils/listBuckets.js` once configured to discover these).*
*   **Actual:** `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, `ACTUAL_SYNC_ID`.
*   **Gemini:** `GEMINI_API_KEY`.
*   **Automation:** Set your local timezone `APP_TIMEZONE=Asia/Jakarta`.

### 2. Discover Your Kanban Bucket IDs
Ensure your Vikunja URLs and tokens are set, then run:
```bash
node src/utils/listBuckets.js
```
This utility will output all of your Kanban columns and their respective IDs. Copy these numbers directly into your `.env` file's bucket configuration!

### 3. Deploy Slash Commands
Register the updated commands with Discord:
```bash
npm run deploy
```

### 4. Run with Docker
Start up the service in your self-hosted Docker container:
```bash
docker compose up -d --build
```

---

## 🧠 Robust AI Engine with Self-Healing Parser
Our core Gemini engine (`src/utils/jsonParser.js`) is protected against minor AI hallucinations or format drift. 

If Gemini returns slightly malformed JSON, missing properties, or invalid validation schema types, our parser catches the Zod validation failure, formats the exact errors, and feeds the previous instructions and failures back to Gemini to self-heal. It will attempt this self-correction up to **3 times** with a strict loop-breaker, making your bot's integrations extremely reliable.

---

## 💻 Tech Stack
-   **Runtime:** Node.js (ESM/CJS)
-   **Framework:** Discord.js v14 & Express v5
-   **Database:** Better-SQLite3 (Local persistent app cache & state logs)
-   **AI:** Google Gemini 2.5 Flash (`@google/genai` new SDK)
-   **Scheduling:** Node-Cron & Date-Fns (Timezone-Aware)
-   **Interface:** TailwindCSS & EJS (Dark-themed Web-UI)
