# Server Profile Switcher

Switches a Discord server's whole layout (channels, categories, name, icon,
description, bot nickname) between two saved profiles: **RoValues** and
**Jaces MM Services**.

## Setup

1. `npm install`
2. Set `DISCORD_TOKEN` as an environment variable (Railway: Variables tab;
   local dev: copy `.env.example` to `.env` and fill it in).
3. Images are baked into `assets-data.js` as base64 — nothing is read from
   disk at runtime, so there's no separate `assets/` folder to lose track of.
4. In `config.js`, fill in `adminRoleIds` / `adminUserIds` with the IDs allowed
   to run admin-only commands (Administrator permission always works too).
5. Invite the bot with **Administrator**, or at minimum: Manage Server,
   Manage Channels, Manage Roles, Manage Nicknames, Manage Guild Expressions.
6. The **server owner's account** needs 2FA enabled — Discord requires this
   for a bot to do certain destructive/administrative actions on a server.
7. `npm start`

## Commands

| Command | Who | What it does |
|---|---|---|
| `!values` | admin | Switches this server to **RoValues** (✅ confirm first) |
| `!jaces` | admin | Switches this server to **Jaces MM Services** (✅ confirm first), then auto-posts: middleman panel → `mm-req`, auto-crypto panel → `auto-crypto`, ToS/rules messages → `tos-crypto` and `mm-tos`, "Join 🛒" button → `🛒`, invite links → `servers` |
| `+embed <text>` | admin | Deletes your message and reposts the text as an embed |
| `+say <text>` | admin | Deletes your message and reposts the text as plain text (no embed) |
| `!middleman` | admin | Manually (re)posts the Middleman Service panel — button always shows "Failed" |
| `!auto` | admin | Manually (re)posts the Jace's Auto Middleman panel (boxed layout matching the reference screenshot) — buttons always show "Failed" |
| `!send` | admin | Posts one random fake "Trade Completed" transaction on demand |
| `!stats` | anyone | Posts a fake rank/volume card into `#commands`, attributed to a **random member** (see below) |

## How switching works

Instead of deleting and recreating channels every time (destructive, slow,
loses message history), `!values`/`!jaces` **hide** channels that don't
belong to the target profile and **show/create** the ones that do — so
running the same switch twice is fast and non-destructive. Categories and
channels are matched by exact name.

The bot also renames itself (server nickname only, not its global username)
to match the active profile via `botName` in `config.js`.

## Auto-poster

Every 5 minutes, posts a fake "Trade Completed" embed (random LTC or USDT
amount, fake transaction ID, `Anonymous`/`Anonymous`) into any channel named
`completed-crypto`. Adjust the channel name or interval in `config.js` under
`autopost`. `!send` posts one on demand, same format.

## !stats random member pool

`config.stats.randomPoolId` is tried in this order: a **role** with that ID
(picks a random member who has it) → a **specific member** with that ID →
any non-bot member in the server. This needs the **Server Members Intent**
enabled for the bot in the Discord Developer Portal (Bot tab) — without it,
member fetching silently fails and `!stats` falls back to whoever ran the
command.

## Jaces MM Services channel layout

`Social` now includes `chat`, `commands`, and `🛒` alongside the existing
categories. `#commands` is where `!stats` posts its cards; `#🛒` gets a
"Join 🛒" button linking to `config.profiles.jaces.autoPost.shop.inviteUrl`
(currently `discord.gg/jacemarket`). That button now targets an exact
**channel ID**, not a name match — the RoValues profile also has a channel
called `🛒〢sell-your-items`, and matching by name alone could post the
join button there instead of the intended `🛒` channel.

## If the description still doesn't update

Some servers block description edits unless **Community** is enabled in
Server Settings → Overview. Turn that on and re-run the switch — the bot
will DM you this exact reason if it happens.

## Notes

- All channels in both profiles are locked for `@everyone`: no sending
  messages, no threads, no reactions. Admins bypass this via the
  Administrator permission, same as always.
- Status/error messages for `!values`/`!jaces` are sent as a **DM** to
  whoever ran the command.
- `tosUrl` in `config.js` is a placeholder (`https://jaces.xyz/tos`) — swap
  in the real ToS link if it's different.
