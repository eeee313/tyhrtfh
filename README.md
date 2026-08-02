# Server Profile Switcher

Switches a Discord server's layout (channels, categories, name, icon,
description) and the bot's own per-server nickname/avatar/role name between
two saved profiles: **RoValues** and **Jaces MM Services**.

## Setup

1. `npm install`
2. Set `DISCORD_TOKEN` as an environment variable (Railway: Variables tab;
   local dev: copy `.env.example` to `.env`).
3. Images are baked into `assets-data.js` as base64 — nothing is read from
   disk at runtime.
4. In `config.js`, fill in `adminRoleIds` / `adminUserIds` (Administrator
   permission always works too).
5. Invite the bot with **Administrator**, or at minimum: Manage Server,
   Manage Channels, Manage Roles, Manage Nicknames, Manage Guild Expressions.
6. The **Server Members Intent** must be turned on for this bot in the
   Discord Developer Portal (Bot tab) — needed for `!stats`'s random member
   pick.
7. The **server owner's account** needs 2FA enabled — Discord requires this
   for certain administrative bot actions.
8. `npm start`

## Commands

| Command | Who | What it does |
|---|---|---|
| `!values` | admin | Switches this server to **RoValues** (✅ confirm first) |
| `!jaces` | admin | Switches this server to **Jaces MM Services** (✅ confirm first) — layout, icon, description, and bot identity only; nothing auto-posts anymore, use the commands below |
| `!middleman` | admin | Posts the Middleman Service panel — button always shows "Failed" |
| `!crypto` | admin | Posts the Jace's Auto Middleman panel (boxed layout) — buttons always show "Failed" |
| `!servers` | admin | Posts the two Jaces invite links |
| `!autotos` | admin | Posts the auto-crypto ToS/rules messages |
| `!tos` | admin | Posts the manual-middleman ToS/rules messages |
| `!shop` | admin | Posts the "Join 🛒" button |
| `!send` | admin | Posts one random fake "Trade Completed" transaction |
| `!stats` | anyone | Posts a fake rank/volume card into `#commands`, attributed to a random member |
| `+embed <text>` | admin | Deletes your message, reposts it as an embed |
| `+say <text>` | admin | Deletes your message, reposts it as plain text |

All of `!middleman` / `!crypto` / `!servers` / `!autotos` / `!tos` / `!shop`
post into **whatever channel you run them in** — run each one in its
intended channel.

## Bot identity per profile

`!values` / `!jaces` set, in this server only:
- **Nickname** — `RoValues BOT` / `Jaces Middleman BOT`
- **Per-server avatar** — the RoValues logo / the Jaces (JMS) icon
- **Role name** — the role with ID set in `config.botRoleId` gets renamed to
  match the bot's current nickname

None of this touches the bot's global username or avatar — it's all scoped
to this one server via Discord's per-guild member identity, so there's no
cross-server side effect and no global rate-limit risk.

## !stats random member pool

`config.stats.randomPoolId` is tried in this order: a **role** with that ID
→ a **specific member** with that ID → any non-bot member. Needs the Server
Members Intent (see setup step 6) or it silently falls back to whoever ran
the command.

## Jaces MM Services channel layout

`Social` includes `chat`, `commands`, and `🛒`. `#commands` is where
`!stats` posts; the `!shop` button targets an exact **channel ID**
(`config.profiles.jaces.autoPost.shop.channelId`), not a name match — the
RoValues profile also has a channel called `🛒〢sell-your-items`, and
matching by name alone risked posting there instead.

## If the description still doesn't update

Some servers block description edits unless **Community** is enabled in
Server Settings → Overview. The bot DMs you this exact reason if it happens.

## Notes

- All channels in both profiles are locked for `@everyone` (no messages,
  threads, or reactions); admins bypass this via Administrator permission.
- `!values`/`!jaces` hide/show channels rather than deleting and recreating
  them, so switching back and forth is fast and non-destructive.
- Status/error messages for `!values`/`!jaces` are sent as a **DM** to
  whoever ran the command.
- `tosUrl` in `config.js` is a placeholder — swap in the real ToS link.
