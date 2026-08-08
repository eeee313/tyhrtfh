"""
Discord Bot - Full Feature File
--------------------------------
Features:
  +embed <title> | <description> | <hex_color (optional)>
  +say <message>
  !channel               -> turns the current channel into a Counting Channel (count to 1000)
  !panel                 -> posts a ticket panel (dropdown -> creates ticket / support channel)

Requirements:
  pip install -U discord.py

Before running:
  1. Set your bot TOKEN below (or set the DISCORD_TOKEN environment variable).
  2. Set STAFF_ROLE_ID to the role that should be able to see/manage tickets (or leave as None).
  3. Category IDs are already set to 1535731589655564308 for both tickets and support,
     since that's the category you gave. Change SUPPORT_CATEGORY_ID if you want a
     separate category later.
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

# Channel the ghost ping is sent/deleted in
GHOST_PING_CHANNEL_ID = 1535727447914451004

COUNTING_DATA_FILE = "counting_data.json"
TICKET_DATA_FILE = "ticket_data.json"
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
    bot.add_view(TicketPanelView())  # persistent view for the ticket panel
    bot.add_view(CloseTicketView())  # persistent view for the close button
    print(f"Logged in as {bot.user} (ID: {bot.user.id})")
    print("Bot is ready.")


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
# TICKET PANEL SYSTEM
# =========================================================
class TicketPanelView(discord.ui.View):
    """Persistent view attached to the ticket panel embed."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.select(
        placeholder="Choose ur reason",
        custom_id="ticket_panel_select",
        options=[
            discord.SelectOption(
                label="Open a Ticket",
                description="General purchase / order ticket",
                emoji="🎫",
                value="ticket",
            ),
            discord.SelectOption(
                label="Support",
                description="Get help / support from staff",
                emoji="🛠️",
                value="support",
            ),
        ],
    )
    async def select_callback(self, interaction: discord.Interaction, select: discord.ui.Select):
        choice = select.values[0]
        await interaction.response.defer(ephemeral=True, thinking=True)

        guild = interaction.guild
        user = interaction.user

        if choice == "ticket":
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
            title=f"{'🎫 Ticket' if choice == 'ticket' else '🛠️ Support'} Opened",
            description=(
                f"Welcome {user.mention}!\n"
                f"Please describe your {'order/issue' if choice == 'ticket' else 'question/issue'} "
                f"and a staff member will be with you shortly."
            ),
            color=discord.Color.red() if choice == "ticket" else discord.Color.blue(),
        )
        await new_channel.send(content=user.mention, embed=open_embed, view=CloseTicketView())

        await interaction.followup.send(f"✅ Created {new_channel.mention}", ephemeral=True)


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
            "**Choose the reason for your ticket below.**\n\n"
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
    await ctx.send(embed=embed, view=TicketPanelView())


@panel_cmd.error
async def panel_cmd_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You need `Administrator` permission to use this.", delete_after=5)


# =========================================================
# +ghostping COMMAND
# =========================================================
@bot.command(name="ghostping")
@commands.has_permissions(manage_messages=True)
async def ghostping_cmd(ctx: commands.Context, member: discord.Member):
    """
    Usage: +ghostping @user
    Pings the user in the ghost ping channel, deletes it instantly,
    then DMs them letting them know they got ghost pinged.
    """
    try:
        await ctx.message.delete()
    except discord.Forbidden:
        pass

    channel = ctx.guild.get_channel(GHOST_PING_CHANNEL_ID)
    if channel is None:
        await ctx.send("❌ Ghost ping channel not found.", delete_after=5)
        return

    ping_msg = await channel.send(f"{member.mention}")
    await ping_msg.delete()

    try:
        await member.send(
            f"👻 You got ghost pinged in **{ctx.guild.name}**, in {channel.mention}!"
        )
    except discord.Forbidden:
        # DMs closed, nothing more we can do
        pass


@ghostping_cmd.error
async def ghostping_cmd_error(ctx, error):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You need `Manage Messages` permission to use this.", delete_after=5)
    elif isinstance(error, commands.MemberNotFound):
        await ctx.send("❌ Couldn't find that member.", delete_after=5)
    elif isinstance(error, commands.MissingRequiredArgument):
        await ctx.send("❌ Usage: `+ghostping @user`", delete_after=5)


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
