# Server Profile Switcher

Switches a Discord server's whole layout (channels, categories, name, icon,
description) between two saved profiles: **RoValues** and **Jaces** —
plus a few standalone admin commands.

## Setup

1. `npm install`
2. Set `DISCORD_TOKEN` as an environment variable (Railway: Variables tab;
   local dev: copy `.env.example` to `.env` and fill it in).
3. Save the two logo images into `assets/`, **and make sure this folder is
   committed to your git repo** (Railway only deploys what's in the repo):
   - `assets/rovalues.png` — the RoValues logo
   - `assets/jaces.png` — the Jaces pfp
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
| `!values` | Wipes the server and rebuilds it as **RoValues** (asks for ✅ confirm first) |
| `!jaces` | Wipes the server and rebuilds it as **Jaces** (asks for ✅ confirm first) |
| `+embed <text>` | Deletes your message and reposts the text as an embed |
| `!middleman` | Posts the Middleman Service panel (display only — the button always shows "Failed") |
| `!auto` | Posts the Jace's Auto Middleman panel (display only — both buttons always show "Failed") |

## Auto-poster

Every 5 minutes, the bot posts a fake "Trade Completed" embed (random LTC or
USDT amount, fake transaction ID, `Anonymous`/`Anonymous`) into any channel
named `completed-crypto` in a server it's in. Adjust the channel name or
interval in `config.js` under `autopost`.

## Notes

- All channels in both profiles are locked for `@everyone`: no sending
  messages, no threads, no reactions.
- Server description only saves if the server has Discord's Community
  feature enabled — otherwise it fails silently (logged to console) and
  everything else still switches normally.
- Status updates for `!values`/`!jaces` are sent as a **DM** to whoever ran
  the command, since the channel it was typed in gets deleted mid-switch.
- Channel creation is rate-limited by Discord; a full switch takes a few
  seconds per channel.
