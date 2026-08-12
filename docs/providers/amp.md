# Amp

## Overview

- **Protocol:** JSON-RPC (`POST /api/internal`)
- **URL:** `https://ampcode.com/api/internal`
- **Auth:** API key from Amp CLI (`~/.local/share/amp/secrets.json`)
- **Tier:** Megawatt/Gigawatt subscriptions and/or individual credits

## Authentication

### Credential Source

The plugin reads the API key automatically from `~/.local/share/amp/secrets.json`, created by Amp CLI when you sign in. No manual setup required.

```json
{
  "apiKey@https://ampcode.com/": "sgamp_user_..."
}
```

The key is sent as `Authorization: Bearer <key>` to the JSON-RPC API.

## Data Source

### API Endpoint

```
POST https://ampcode.com/api/internal
Authorization: Bearer <api_key>
Content-Type: application/json

{"method": "userDisplayBalanceInfo", "params": {}}
```

### Response

The response contains a `displayText` string whose contents vary by user tier:

**Subscription:**
```
Signed in as <user>
Subscription <plan>: <percent>% other usage and <percent>% orb usage remaining
```

**Paid credits only:**
```
Signed in as <user>
Individual credits: $<credits> remaining - https://ampcode.com/settings
```

The plugin parses the display text with regex to extract:
- **Subscription:** plan name, other usage remaining, and orb usage remaining
- **Credits:** `Individual credits: $N remaining` → paid credits balance

## Plan Detection

| Condition | Plan |
|-----------|------|
| Subscription present | Subscription plan name, such as `"Megawatt"` |
| No subscription | `"Credits"` |

## Displayed Lines

| Line        | Scope    | Condition                   | Description                            |
|-------------|----------|-----------------------------|----------------------------------------|
| Subscription Usage | overview | Subscription enabled        | Included non-orb subscription usage consumed |
| Orb Usage   | overview | Subscription enabled        | Included orb usage consumed            |
| Credits     | overview | Credits > $0, or credits-only accounts | Individual credits balance      |

## Errors

| Condition              | Message                                                        |
|------------------------|----------------------------------------------------------------|
| Amp not installed      | "Amp not installed. Install Amp Code to get started."          |
| 401/403                | "Session expired. Re-authenticate in Amp Code."               |
| Non-2xx with detail    | Error message from API response                                |
| Non-2xx without detail | "Request failed (HTTP {status}). Try again later."             |
| Unparseable response   | "Could not parse usage data."                                  |
| Network error          | "Request failed. Check your connection."                       |
