# Server Profile Switcher

Switches a Discord server's whole layout (channels, categories, name, icon,
description) — and optionally the bot's own name/avatar — between two saved
profiles: **RoValues** and **Jaces MM Services**.

## Setup

1. `npm install`
2. Set `DISCORD_TOKEN` as an environment variable (Railway: Variables tab;
   local dev: copy `.env.example` to `.env` and fill it in).
3. That's it for images — `assets-data.js` has the RoValues logo, the Jaces
   server icon, and the Auto Middleman bot avatar baked in as base64, so
   there's no separate file the deploy can lose track of. This is what fixes
   the `ENOENT ... assets/rovalues.png` errors from before: nothing is read
   from disk at runtime anymore.
4. In `config.js`, fill in `adminRoleIds` / `adminUserIds` with the IDs allowed
   to run admin commands (Administrator permission always works too).
5. Invite the bot with **Administrator**, or at minimum: Manage Server,
   Manage Channels, Manage Roles, Manage Guild Expressions (icon).
6. The **server owner's account** needs 2FA enabled — Discord requires this
   for a bot to do destructive actions (create/delete channels) on a server.
7. `npm start`

## Commands (all admin-only)

| Command | What it does |
|---|---|
| `!values` | Wipes the server and rebuilds it as **RoValues** (✅ confirm first) |
| `!jaces` | Wipes the server and rebuilds it as **Jaces MM Services** (✅ confirm first), auto-posts the middleman panel to `mm-req`, the auto-crypto panel to `auto-crypto`, and the invite links to `servers` |
| `+embed <text>` | Deletes your message and reposts the text as an embed |
| `!middleman` | Manually (re)posts the Middleman Service panel — button always shows "Failed" |
| `!auto` | Manually (re)posts the Jace's Auto Middleman panel — buttons always show "Failed" |
| `!send` | Posts one random fake "Trade Completed" transaction on demand |

## Bot identity switching

When `botIdentitySwitch: true` in `config.js` (on by default), running
`!values` or `!jaces` also renames the bot and swaps its avatar:

- **RoValues** → bot becomes "RoValues" using the same logo as the server icon
- **Jaces MM Services** → bot becomes "Auto Middleman" using the LTC/USDT
  split icon

This is **global to the bot account**, not scoped to one server — if this
bot is ever in more than one server, its identity changes everywhere at
once. Discord also rate-limits username and avatar changes to roughly
2 per hour each, so rapid back-to-back switching may hit that limit; if it
does, the bot DMs you the exact error instead of failing silently.

## Auto-poster

Every 5 minutes, posts a fake "Trade Completed" embed (random LTC or USDT
amount, fake transaction ID, `Anonymous`/`Anonymous`) into any channel named
`completed-crypto`. Adjust the channel name or interval in `config.js` under
`autopost`. `!send` posts one on demand, same format.

## If the description still doesn't update

Some servers block description edits unless **Community** is enabled in
Server Settings → Overview. Turn that on and re-run the switch — the bot
will DM you this exact reason if it happens.

## Notes

- All channels in both profiles are locked for `@everyone`: no sending
  messages, no threads, no reactions.
- Status/error messages are sent as a **DM** to whoever ran the command,
  since the channel it was typed in gets deleted mid-switch.
- Channel creation is rate-limited by Discord; a full switch takes a few
  seconds per channel.
