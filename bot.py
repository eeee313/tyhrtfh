"""
Discord Bot - Full Feature File
--------------------------------
Features:
  +embed <title> | <description> | <hex_color (optional)>
  +say <message>
  !channel               -> turns the current channel into a Counting Channel (count to 1000)
  !panel                 -> posts a ticket-only panel (button -> creates a ticket-name-number channel)
  !support                -> posts a support-only panel (button -> creates a support-name-number channel)
  !welcome                -> sets the current channel to receive "member joined" messages
  !leave                  -> sets the current channel to receive "member left" messages
  Ghost ping on join     -> automatically ghost pings + DMs every new member, no command needed

Requirements:
  pip install -U discord.py

Before running:
  1. Set DISCORD_TOKEN as an environment variable (e.g. in Railway → Variables).
  2. Set STAFF_ROLE_ID to the role that should be able to see/manage tickets (or leave as None).
  3. Category IDs are already set to 1535731589655564308 for both tickets and support,
     since that's the category you gave. Change SUPPORT_CATEGORY_ID if you want a
     separate category later.
  4. TICKET_PING_ROLE_ID (1535727112240242730) is pinged whenever a ticket is created.
  5. GHOST_PING_CHANNEL_ID (1535727447914451004) is where new members get ghost pinged.
"""

import discord
from discord.ext import commands
import json
import os
import re

# =========================================================
# CONFIG
# =========================================================
TOKEN = os.getenv("DISCORD_TOKEN")

TICKET_CATEGORY_ID = 1535731589655564308
SUPPORT_CATEGORY_ID = 1535731589655564308

# Set this to a role ID (int) that should automatically be added to every ticket.
# Example: STAFF_ROLE_ID = 123456789012345678
STAFF_ROLE_ID = None

# Role pinged when a ticket (not support) channel is created
TICKET_PING_ROLE_ID = 1535727112240242730

# Channel the ghost ping is sent/deleted in
GHOST_PING_CHANNEL_ID = 1535727447914451004

COUNTING_DATA_FILE = "counting_data.json"
TICKET_DATA_FILE = "ticket_data.json"
WELCOME_DATA_FILE = "welcome_data.json"
COUNT_GOAL = 1000

# =========================================================
# BOT SETUP
# =========================================================
intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix=["!", "+"], intents=intents, help_command=None)


# =========================================================
# SIMPLE JSON "DATABASE" HELPERS
# =========================================================
def load_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return default


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# counting_data structure:
# { "<channel_id>": {"count": 0, "last_user_id": null} }
counting_data = load_json(COUNTING_DATA_FILE, {})

# ticket_data structure:
# { "ticket_number": 0, "support_number": 0 }
ticket_data = load_json(TICKET_DATA_FILE, {"ticket_number": 0, "support_number": 0})

# welcome_data structure:
# { "welcome_channel_id": None, "leave_channel_id": None }
welcome_data = load_json(WELCOME_DATA_FILE, {"welcome_channel_id": None, "leave_channel_id": None})


def safe_name(name: str) -> str:
    """Make a string safe to use as part of a channel name."""
    name = name.lower()
    name = re.sub(r"[^a-z0-9-]", "-", name)
    name = re.sub(r"-+", "-", name).strip("-")
    return name or "user"


# =========================================================
# EVENTS
# =========================================================
@bot.event
async def on_ready():
    bot.add_view(TicketOnlyView())  # persistent view for the !panel ticket panel
    bot.add_view(SupportOnlyView())  # persistent view for the !support panel
    bot.add_view(CloseTicketView())  # persistent view for the close button
    print(f"Logged in as {bot.user} (ID: {bot.user.id})")
    print("Bot is ready.")


@bot.event
async def on_member_join(member: discord.Member):
    """Ghost ping the new member in the ghost ping channel, DM them, and post a welcome message."""
    channel = member.guild.get_channel(GHOST_PING_CHANNEL_ID)
    if channel is not None:
        try:
            ping_msg = await channel.send(f"{member.mention}")
            await ping_msg.delete()
        except discord.Forbidden:
            pass

    try:
        await member.send(
            f"👻 You got ghost pinged in **{member.guild.name}**!"
        )
    except discord.Forbidden:
        # DMs closed, nothing more we can do
        pass

    welcome_channel_id = welcome_data.get("welcome_channel_id")
    if welcome_channel_id:
        welcome_channel = member.guild.get_channel(welcome_channel_id)
        if welcome_channel is not None:
            embed = discord.Embed(
                title="👋 Welcome!",
                description=f"{member.mention} just joined **{member.guild.name}**!",
                color=discord.Color.green(),
            )
            embed.set_thumbnail(url=member.display_avatar.url)
            embed.set_footer(text=f"Member #{member.guild.member_count}")
            try:
                await welcome_channel.send(embed=embed)
            except discord.Forbidden:
                pass


@bot.event
async def on_member_remove(member: discord.Member):
    """Post a leave message when a member leaves."""
    leave_channel_id = welcome_data.get("leave_channel_id")
    if leave_channel_id:
        leave_channel = member.guild.get_channel(leave_channel_id)
        if leave_channel is not None:
            embed = discord.Embed(
                title="👋 Goodbye",
                description=f"**{member}** has left **{member.guild.name}**.",
                color=discord.Color.dark_grey(),
            )
            embed.set_thumbnail(url=member.display_avatar.url)
            embed.set_footer(text=f"Member #{member.guild.member_count}")
            try:
                await leave_channel.send(embed=embed)
            except discord.Forbidden:
                pass


@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return

    # Let commands run first
    await bot.process_commands(message)

    # ---------------- COUNTING CHANNEL LOGIC ----------------
    channel_id = str(message.channel.id)
    if channel_id in counting_data:
        content = message.content.strip()

        # Ignore command messages (start with our prefixes) so !channel/+embed etc still work
        if content.startswith("!") or content.startswith("+"):
            return

        state = counting_data[channel_id]
        current_count = state["count"]
        last_user_id = state["last_user_id"]

        # Must be a plain positive integer
        if not content.isdigit():
            try:
                await message.delete()
            except discord.Forbidden:
                pass
            return

        number = int(content)
        expected = current_count + 1

        # Same person can't count twice in a row
        if last_user_id == message.author.id:
            state["count"] = 0
            state["last_user_id"] = None
            save_json(COUNTING_DATA_FILE, counting_data)
            try:
                await message.add_reaction("❌")
            except discord.Forbidden:
                pass
            await message.channel.send(
                f"❌ {message.author.mention} you can't count twice in a row! "
                f"Wrong answer — back to **1**."
            )
            return

        # Wrong number
        if number != expected:
            state["count"] = 0
            state["last_user_id"] = None
            save_json(COUNTING_DATA_FILE, counting_data)
            try:
                await message.add_reaction("❌")
            except discord.Forbidden:
                pass
            await message.channel.send(
                f"❌ {message.author.mention} wrong number! Expected **{expected}**. "
                f"Back to **1**."
            )
            return

        # Correct number
        state["count"] = number
        state["last_user_id"] = message.author.id
        save_json(COUNTING_DATA_FILE, counting_data)
        try:
            await message.add_reaction("✅")
        except discord.Forbidden:
            pass

        if number >= COUNT_GOAL:
            await message.channel.send(
                f"🎉 **{message.author.mention} counted all the way to {COUNT_GOAL}!** "
                f"Amazing job everyone! Resetting to 1."
            )
            state["count"] = 0
            state["last_user_id"] = None
            save_json(COUNTING_DATA_FILE, counting_data)


# =========================================================
# +embed COMMAND
# =========================================================
@bot.command(name="embed")
@commands.has_permissions(manage_messages=True)
async def embed_cmd(ctx: commands.Context, *, content: str):
    """
    Usage: +embed Title | Description | #hexcolor (optional)
    Example: +embed Welcome! | Glad to have you here. | #ff0000
    """
    parts = [p.strip() for p in content.split("|")]
    title = parts[0] if len(parts) > 0 else None
    description = parts[1] if len(parts) > 1 else ""
    color_str = parts[2] if len(parts) > 2 else None

    color = discord.Color.blurple()
    if color_str:
        try:
            color = discord.Color(int(color_str.replace("#", ""), 16))
        except ValueError:
            pass

    embed = discord.Embed(title=title, description=description, color=color)
    embed.set_footer(text=f"Sent by {ctx.author.display_name}")

    try:
        await ctx.message.delete()
    except discord.Forbidden:
        pass

    await ctx.send(embed=embed)


@embed_cmd.error
async def embed_cmd_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You need `Manage Messages` permission to use this.", delete_after=5)
    elif isinstance(error, commands.MissingRequiredArgument):
        await ctx.send(
            "❌ Usage: `+embed Title | Description | #hexcolor(optional)`", delete_after=8
        )


# =========================================================
# +say COMMAND
# =========================================================
@bot.command(name="say")
@commands.has_permissions(manage_messages=True)
async def say_cmd(ctx: commands.Context, *, message: str):
    try:
        await ctx.message.delete()
    except discord.Forbidden:
        pass
    await ctx.send(message)


@say_cmd.error
async def say_cmd_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You need `Manage Messages` permission to use this.", delete_after=5)
    elif isinstance(error, commands.MissingRequiredArgument):
        await ctx.send("❌ Usage: `+say <message>`", delete_after=5)


# =========================================================
# !channel COMMAND -> sets up counting in the current channel
# =========================================================
@bot.command(name="channel")
@commands.has_permissions(administrator=True)
async def channel_cmd(ctx: commands.Context):
    """Turns the channel this command is run in into a counting channel."""
    channel_id = str(ctx.channel.id)
    counting_data[channel_id] = {"count": 0, "last_user_id": None}
    save_json(COUNTING_DATA_FILE, counting_data)

    embed = discord.Embed(
        title="🔢 Counting Channel Activated",
        description=(
            f"This channel is now a counting channel!\n\n"
            f"**Rules:**\n"
            f"• Count up starting from **1**\n"
            f"• You cannot count twice in a row\n"
            f"• Wrong number resets the count back to **1**\n"
            f"• Goal: reach **{COUNT_GOAL}**!"
        ),
        color=discord.Color.green(),
    )
    await ctx.send(embed=embed)


@channel_cmd.error
async def channel_cmd_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You need `Administrator` permission to use this.", delete_after=5)


# =========================================================
# !welcome / !leave COMMANDS
# =========================================================
@bot.command(name="welcome")
@commands.has_permissions(administrator=True)
async def welcome_cmd(ctx: commands.Context):
    """Sets the current channel as the welcome (join) message channel."""
    welcome_data["welcome_channel_id"] = ctx.channel.id
    save_json(WELCOME_DATA_FILE, welcome_data)
    await ctx.send(f"✅ Welcome messages will now be sent in {ctx.channel.mention}.")


@welcome_cmd.error
async def welcome_cmd_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You need `Administrator` permission to use this.", delete_after=5)


@bot.command(name="leave")
@commands.has_permissions(administrator=True)
async def leave_cmd(ctx: commands.Context):
    """Sets the current channel as the leave message channel."""
    welcome_data["leave_channel_id"] = ctx.channel.id
    save_json(WELCOME_DATA_FILE, welcome_data)
    await ctx.send(f"✅ Leave messages will now be sent in {ctx.channel.mention}.")


@leave_cmd.error
async def leave_cmd_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You need `Administrator` permission to use this.", delete_after=5)


# =========================================================
# TICKET / SUPPORT PANEL SYSTEM
# =========================================================
async def create_ticket_channel(interaction: discord.Interaction, kind: str):
    """kind is either 'ticket' or 'support'."""
    await interaction.response.defer(ephemeral=True, thinking=True)

    guild = interaction.guild
    user = interaction.user

    if kind == "ticket":
        category_id = TICKET_CATEGORY_ID
        prefix = "ticket"
        ticket_data["ticket_number"] += 1
        number = ticket_data["ticket_number"]
    else:
        category_id = SUPPORT_CATEGORY_ID
        prefix = "support"
        ticket_data["support_number"] += 1
        number = ticket_data["support_number"]

    save_json(TICKET_DATA_FILE, ticket_data)

    category = guild.get_channel(category_id)
    if category is None or not isinstance(category, discord.CategoryChannel):
        await interaction.followup.send(
            "❌ Could not find the target category. Ask an admin to check the category ID.",
            ephemeral=True,
        )
        return

    channel_name = f"{prefix}-{safe_name(user.display_name)}-{number}"

    overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        user: discord.PermissionOverwrite(
            view_channel=True, send_messages=True, read_message_history=True
        ),
        guild.me: discord.PermissionOverwrite(
            view_channel=True, send_messages=True, manage_channels=True
        ),
    }

    if STAFF_ROLE_ID:
        staff_role = guild.get_role(STAFF_ROLE_ID)
        if staff_role:
            overwrites[staff_role] = discord.PermissionOverwrite(
                view_channel=True, send_messages=True, read_message_history=True
            )

    new_channel = await guild.create_text_channel(
        name=channel_name,
        category=category,
        overwrites=overwrites,
        reason=f"{prefix.title()} opened by {user}",
    )

    open_embed = discord.Embed(
        title=f"{'🎫 Ticket' if kind == 'ticket' else '🛠️ Support'} Opened",
        description=(
            f"Welcome {user.mention}!\n"
            f"Please describe your {'order/issue' if kind == 'ticket' else 'question/issue'} "
            f"and a staff member will be with you shortly."
        ),
        color=discord.Color.red() if kind == "ticket" else discord.Color.blue(),
    )

    ping_content = user.mention
    if kind == "ticket" and TICKET_PING_ROLE_ID:
        ping_content += f" <@&{TICKET_PING_ROLE_ID}>"

    await new_channel.send(content=ping_content, embed=open_embed, view=CloseTicketView())

    await interaction.followup.send(f"✅ Created {new_channel.mention}", ephemeral=True)


class TicketOnlyView(discord.ui.View):
    """Persistent view attached to the !panel embed - creates ticket channels."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Create Ticket", style=discord.ButtonStyle.danger, custom_id="create_ticket_button", emoji="🎫"
    )
    async def create_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await create_ticket_channel(interaction, "ticket")


class SupportOnlyView(discord.ui.View):
    """Persistent view attached to the !support embed - creates support channels."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Create Support", style=discord.ButtonStyle.primary, custom_id="create_support_button", emoji="🛠️"
    )
    async def create_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await create_ticket_channel(interaction, "support")


class CloseTicketView(discord.ui.View):
    """Persistent view with a close button, attached inside each ticket channel."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Close Ticket", style=discord.ButtonStyle.danger, custom_id="close_ticket_button", emoji="🔒"
    )
    async def close_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message("🔒 Closing this channel in 5 seconds...")
        await interaction.channel.edit(name=f"closed-{interaction.channel.name}"[:100])
        await discord.utils.sleep_until(discord.utils.utcnow() + __import__("datetime").timedelta(seconds=5))
        try:
            await interaction.channel.delete(reason=f"Closed by {interaction.user}")
        except discord.Forbidden:
            pass


@bot.command(name="panel")
@commands.has_permissions(administrator=True)
async def panel_cmd(ctx: commands.Context):
    """Posts the ticket panel in the current channel."""
    embed = discord.Embed(
        title="🛒 Shop Tickets",
        description=(
            "Do you want to open a ticket to contact us?\n"
            "**Click below to create your ticket.**\n\n"
            "**__Terms & Conditions__**\n"
            "• Payments are only via PayPal or LTC.\n"
            "• If you send money to the wrong address, no refund will be provided.\n"
            "• Payments must be sent in $ (USD) or € (EUR).\n"
            "• If an item gets revoked, no refund or replacement will be given.\n"
            "• Accusing us of scamming = instant ban.\n\n"
            "**⚠️ Buying from us means accepting the TOS**"
        ),
        color=discord.Color.dark_red(),
    )
    await ctx.send(embed=embed, view=TicketOnlyView())


@panel_cmd.error
async def panel_cmd_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You need `Administrator` permission to use this.", delete_after=5)


@bot.command(name="support")
@commands.has_permissions(administrator=True)
async def support_cmd(ctx: commands.Context):
    """Posts the support panel in the current channel."""
    embed = discord.Embed(
        title="🛠️ Support",
        description=(
            "Need help or have a question?\n"
            "**Click below to open a support channel** and a staff member will assist you."
        ),
        color=discord.Color.blue(),
    )
    await ctx.send(embed=embed, view=SupportOnlyView())


@support_cmd.error
async def support_cmd_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You need `Administrator` permission to use this.", delete_after=5)


# =========================================================
# +dm COMMAND
# =========================================================
@bot.command(name="dm")
@commands.has_permissions(administrator=True)
async def dm_cmd(ctx: commands.Context, role: discord.Role, *, message: str):
    """
    Usage: +dm @role <message>
    DMs every member who has the given role.
    """
    try:
        await ctx.message.delete()
    except discord.Forbidden:
        pass

    status_msg = await ctx.send(f"📨 Sending DMs to **{len(role.members)}** members with {role.mention}...")

    sent = 0
    failed = 0
    for member in role.members:
        if member.bot:
            continue
        try:
            await member.send(message)
            sent += 1
        except discord.Forbidden:
            failed += 1

    await status_msg.edit(
        content=f"✅ Done. Sent to **{sent}** member(s). Failed (DMs closed): **{failed}**."
    )


@dm_cmd.error
async def dm_cmd_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You need `Administrator` permission to use this.", delete_after=5)
    elif isinstance(error, commands.RoleNotFound):
        await ctx.send("❌ Couldn't find that role.", delete_after=5)
    elif isinstance(error, commands.MissingRequiredArgument):
        await ctx.send("❌ Usage: `+dm @role <message>`", delete_after=5)


# =========================================================
# RUN
# =========================================================
if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit(
            "❌ DISCORD_TOKEN environment variable is not set. "
            "In Railway: go to your project → Variables → add DISCORD_TOKEN with your bot token."
        )
    bot.run(TOKEN)
