# ChillrendLifeOS

A private, self-hosted Discord Bot for personal task management (Google Tasks) and financial tracking (Actual Budget), powered by Gemini AI.

## Features

- **Authenticated Access**: Strictly limited to the owner.
- **Task Management** (Google Tasks):
  - `/todo [task]` - Add tasks with Natural Language Processing (AI extracts date/time).
  - `/summary` - View daily tasks.
  - `/backlog` - View undated tasks.
  - `/link` - Connect Google Account.
- **Finance Tracking** (Actual Budget):
  - `/expense [details]` - Log expenses (AI categorizes and sets payee).
  - `/income [details]` - Log income.
  - `/transfer [details]` - Log transfers between accounts.

## Setup

1.  **Clone & Configure**:
    ```bash
    cp .env.example .env
    ```
    Fill in your API keys for Discord, Google, Actual Budget, and Gemini.

2.  **Run with Docker**:
    ```bash
    docker compose up -d --build
    ```

3.  **Deploy Commands**:
    The bot should register commands automatically, but if updates are missing:
    ```bash
    docker compose exec bot npm run deploy
    ```

## Development

- Hot-reloading is enabled. Changes to `src/` will restart the bot.
- **Logs**: `docker compose logs -f bot`

## Tech Stack

- **Node.js** & **Discord.js**
- **Express** (Auth Server)
- **MongoDB** (User/Token Storage)
- **Gemini 1.5 Flash** (NLP)
- **Docker Compose**
