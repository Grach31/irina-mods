# My Space notifications

The notification center is a private Supabase-backed addition to the existing Pages app. It does not send or approve Telegram publications. The worker never calls the Telegram API.

## Components
- `miniapp/notifications.js`, `notifications.css`: center, preferences, unread count, offline read synchronization and explicit push permission.
- `miniapp/sw.js`: visible Web Push and validated same-origin click routing. No caching of sensitive responses.
- `scripts/build_notification_manifest.py`: deployment inventory, semantic content hashes (ignores check timestamps), validated edit receipts.
- `scripts/report_editorial.py`: explicit per-section success/blocking reports; successful recovery supersedes obsolete error pushes.
- `scripts/complete_edit.py`: explicit completion record bound to the request timestamp and exact draft bytes.
- `supabase/functions/myspace-notifications`: owner-verified API, deployment OIDC verification, recovery reconciliation and Web Push.
- `supabase/notifications/schema.sql`: canonical schema/function definitions, not an automatically replayable migration. RLS and revoked browser grants; service-role RPCs are invoker functions.
- `supabase/notifications/scheduler.sql`: one minute DB tick; Edge is invoked only for due work or hourly reconciliation.

## Behavior
- Quiet hours default to 22:00–08:00 Europe/Moscow. All categories defer push; the history records events immediately. Read, expired and superseded events do not push.
- The worker groups due notifications into one visible push per subscription. Successful publication is history-only by default. Same-day editorial updates append to one daily record without repeating an accepted push.
- First successful inventory establishes a silent baseline. Existing materials do not announce on rollout.
- Event keys persist after 90-day notification cleanup. Every delivery has a unique notification/subscription pair, bounded retries, a reclaimable lease and a fencing token.
- Subscriptions are accepted only for known HTTPS browser push hosts. No arbitrary endpoint fetches, client-authorized writes or user metadata authorization.
- A push service acceptance is not proof of display. Real iPhone permission and delivery testing must be performed on the installed PWA.

## Editorial completion
Read the current Supabase request and verify its exact `created_at`. Perform all requested changes and checks. Then run:

```
python scripts/complete_edit.py DRAFT_ID 'REQUEST_CREATED_AT'
```

Commit the receipt with the corrected material. A newer request, changed bytes, rejected/published draft, or failed deployment prevents the completion notification. This does not change the moderation decision.

## Operations
Inspect only nonsecret config fields: `enabled`, `initialized`, `last_reconcile`, `last_success`, `last_error`. Never export the worker token, VAPID private key or subscription endpoints to logs or Pages.

Observe `myspace_push_deliveries`: pending → sending → accepted/failed/skipped. `accepted` means the push service accepted the request. `opened_at` is recorded only when a specific notification is opened from a push. A grouped push opens the notification list; subsequent reads remain explicit.

To stop delivery independently, set `myspace_private.notification_config.enabled=false`. To stop all scheduled work, unschedule `myspace-notification-dispatch`. Existing moderation and Telegram publishing are independent. Keep VAPID keys stable across deployments; rotating them requires resubscribing devices.

## Validation
- `python -m unittest discover -s tests -v`
- `node --test tests/notifications.test.mjs`
- `node --check miniapp/notifications.js` and `node --check miniapp/sw.js`
- `HAPPY_DOM_PATH=/path/to/happy-dom/lib/index.js node tests/notifications-dom.cjs`
- Optional real-browser mobile layout and gesture check: `node tests/notifications-browser.cjs` (Playwright and a working Chromium installation).
- Database transaction/rollback checks: silent baseline, deduplication, 08:00/22:00 boundaries, lease exclusion, retry, acceptance and access restrictions.

Do not claim physical iPhone testing from DOM emulation or a deployment success.
