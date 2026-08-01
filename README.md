# Server Profile Switcher

Switches a Discord server's whole layout (channels, categories, name, icon,
description) between two saved profiles: **RoValues** and **Jaces** —
plus a few standalone admin commands.

## Setup

1. `npm install`
2. Set `DISCORD_TOKEN` as an environment variable (Railway: Variables tab;
   local dev: copy `.env.example` to `.env` and fill it in).
3. `assets/rovalues.png` and `assets/jaces.png` are already included in this
   package — **commit the whole `assets/` folder to your git repo**, Railway
   only deploys what's actually in the repo. Note: the Jaces icon supplied
   was only 48×48px (a Discord-sized pfp), so it'll look a little soft as a
   full server icon — swap in a higher-res version if you have one.
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
| `!jaces` | Wipes the server and rebuilds it as **Jaces** (✅ confirm first), then auto-posts the middleman panel to `mm-req`, the auto-crypto panel to `auto-crypto`, and the invite links to `servers` |
| `+embed <text>` | Deletes your message and reposts the text as an embed |
| `!middleman` | Manually (re)posts the Middleman Service panel — button always shows "Failed" |
| `!auto` | Manually (re)posts the Jace's Auto Middleman panel — buttons always show "Failed" |

## Auto-poster

Every 5 minutes, posts a fake "Trade Completed" embed (random LTC or USDT
amount, fake transaction ID, `Anonymous`/`Anonymous`) into any channel named
`completed-crypto`. Adjust the channel name or interval in `config.js` under
`autopost`.

## If the icon or description still doesn't update

The bot now DMs you the exact reason when either fails:

- **Icon fails** → almost always means `assets/rovalias.png` or
  `assets/jaces.png` isn't actually present in the deployed repo. Double
  check they're committed (not `.gitignore`d) and pushed.
- **Description fails** → some servers block description edits unless
  **Community** is enabled in Server Settings → Overview. Turn that on and
  re-run the switch.

## Notes

- All channels in both profiles are locked for `@everyone`: no sending
  messages, no threads, no reactions.
- Status/error messages are sent as a **DM** to whoever ran the command,
  since the channel it was typed in gets deleted mid-switch.
- Channel creation is rate-limited by Discord; a full switch takes a few
  seconds per channel.
