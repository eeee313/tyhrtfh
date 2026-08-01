# Server Profile Switcher

Switches a Discord server's whole layout (channels, categories, name, icon,
description) between two saved profiles: **RoValues** and **Jaces**.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and paste your bot token in.
3. Save the two logo images into `assets/`:
   - `assets/rovalues.png` — the RoValues logo
   - `assets/jaces.png` — the Jaces pfp
4. In `config.js`, fill in `adminRoleIds` / `adminUserIds` with the IDs allowed
   to run the switch (server owner / Administrator perms always works too).
5. Invite the bot with **Administrator**, or at minimum: Manage Server,
   Manage Channels, Manage Roles, Manage Guild Expressions (icon).
6. `npm start`

## Usage

In any channel, an admin types:

- `!values` → wipes the server and rebuilds it as **RoValues**
- `!jaces` → wipes the server and rebuilds it as **Jaces**

The bot asks for a ✅ reaction confirmation first, since the switch **deletes
every existing channel and category** before rebuilding — this is intentional
per the "switches everything" behavior, but there's no undo.

## Notes

- All channels in both profiles are locked for `@everyone`: no sending
  messages, no threads, no reactions — matching "NO ONE CAN SPEAK, DO
  THREADS, DO REACTIONS ETC." for every category in both layouts.
- `guild.setDescription()` only works if the server has Discord's Community
  feature enabled — otherwise it fails silently (logged to console) and
  everything else still switches normally.
- Channel creation is rate-limited by Discord; a full switch takes a few
  seconds per channel.
