# Pace Alerts

UsagePal can send a macOS notification when one of your usage limits is on pace to run out. Alerts
are set up during first-run onboarding and can be changed later in **Settings → Notifications**.
UsagePal registers with macOS notifications at startup so it appears in **System Settings →
Notifications** before the first alert needs to fire.

## The Triggers

| Trigger | Fires when |
|---|---|
| **Almost Out** | A limit drops below 10% remaining for the current window. |
| **Cutting It Close** | A limit's projected end-of-period usage moves into "close to the limit". |
| **Will Run Out** | A limit is projected to finish before the window resets. |
| **Session Reset** | A session meter returns to 0% used after previous usage. |

Each trigger is independent — enable any combination. Turning all triggers off silences alerts entirely.

## How It Behaves

- **Once per window.** Each trigger fires at most once per metric per reset window, so a limit sitting
  at a high level doesn't re-alert on every refresh. When the window resets, the triggers re-arm.
- **No launch spam.** The first reading after the app starts is recorded as a baseline without firing,
  so a limit that's already high when you open the app doesn't immediately alert.
- **Worsening edges only.** "Cutting It Close" and "Will Run Out" fire on the step into a worse state.
  A limit that jumps straight from healthy to running-out sends the single, more urgent "Will Run Out"
  alert rather than both.
- **Exhausted limits stay quiet.** Once a metric reaches 99-100% used, pace alerts are suppressed for
  that metric because they are no longer useful.
- **Recovery re-arms.** If pace improves and later worsens again, the alert can fire again.
- **Session reset alerts only fire at 0%.** A session reset alert fires when the session goes back to
  0% used, not when it partially recovers.
- **Every provider, every metric.** Any progress meter with a reset window is evaluated; "Almost Out"
  also applies to meters without a pace projection (e.g. a remaining credit balance).

Evaluation runs on each scheduled refresh, so alerts fire even while the panel is closed.

## Notes

- Alerts are best-effort: if macOS notification permission is denied, nothing is delivered until you
  grant it in **System Settings → Notifications → UsagePal**.
- If you skipped notification setup during onboarding, open **Settings → Notifications** in UsagePal
  and enable the alerts you want. If macOS still blocks delivery, use **Open Settings** to allow
  UsagePal in **System Settings → Notifications**.
- Trigger choices persist across restarts. The per-metric "already alerted this window" memory is
  in-memory and resets when the app restarts (which is why the first post-launch reading only baselines).
