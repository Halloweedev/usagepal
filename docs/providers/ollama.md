# Ollama

Tracks Ollama Cloud credits and (on legacy plans) session/weekly limits using an API key.

## Setup

Set `OLLAMA_API_KEY` in your environment, or create `~/.config/usagepal/ollama.json` containing `{ "apiKey": "..." }`.

## What it shows

- Credit plans: included credits (used vs allowance) and purchased credits balance.
- Legacy plans: session and weekly remaining percentages.

Balances come from `GET https://ollama.com/api/balance`. No local spend or token tracking is performed.