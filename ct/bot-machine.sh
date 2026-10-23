#!/usr/bin/env bash
# Scripts base for runs that did not start from a clone of this repository. The engine
# prefers the clone it was started from (ct/ and install/ next to each other) over this URL.
export COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/kenetrix/discord-bots/main}"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
# shellcheck source=/dev/null
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Source: https://discord.js.org/ | Github: https://github.com/kenetrix/discord-bots

APP="Bot-Machine"
var_tags="${var_tags:-bots;discord;nodejs}"
var_cpu="${var_cpu:-1}"
var_ram="${var_ram:-1024}"
var_disk="${var_disk:-8}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_unprivileged="${var_unprivileged:-1}"

# Application settings. The install script reads them from the environment; all are optional.
# Credentials are never stored in the script or in the defaults file, pass them per run.
export var_bot_name="${var_bot_name:-jarvis}"
export var_bot_repo="${var_bot_repo:-https://github.com/kenetrix/discord-bots.git}"
export var_bot_path="${var_bot_path-bot}"
export var_bot_repo_token="${var_bot_repo_token:-}"
# Local mode: path on the Proxmox host to a .tgz of the bot repo; replaces the git clone
export var_bot_archive="${var_bot_archive:-}"
export var_discord_token="${var_discord_token:-}"
export var_discord_client_id="${var_discord_client_id:-}"
export var_discord_guild_id="${var_discord_guild_id:-}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -x /usr/local/bin/botctl || ! -d /opt/bots ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  msg_info "Updating Bots"
  $STD botctl update-all
  msg_ok "Updated Bots"

  msg_info "Updating OS Packages"
  $STD apt update
  $STD apt -y upgrade
  msg_ok "Updated OS Packages"

  msg_ok "Updated successfully!"
  exit
}

if [[ -n "$var_bot_archive" && ! -f "$var_bot_archive" ]]; then
  echo "var_bot_archive: file not found: $var_bot_archive" >&2
  exit 1
fi

start
build_container
description

if [[ -n "$var_bot_archive" ]]; then
  msg_info "Installing Bot ${var_bot_name} from ${var_bot_archive}"
  pct push "$CTID" "$var_bot_archive" /tmp/bot-source.tgz
  if pct exec "$CTID" -- botctl add "$var_bot_name" --archive /tmp/bot-source.tgz ${var_bot_path:+--path "$var_bot_path"} >/dev/null; then
    msg_ok "Installed Bot ${var_bot_name}"
    if [[ -n "$var_discord_token" && -n "$var_discord_client_id" ]]; then
      msg_info "Configuring and Starting ${var_bot_name}"
      printf '%s\n' "$var_discord_token" | pct exec "$CTID" -- botctl set "$var_bot_name" DISCORD_TOKEN
      printf '%s\n' "$var_discord_client_id" | pct exec "$CTID" -- botctl set "$var_bot_name" CLIENT_ID
      [[ -n "$var_discord_guild_id" ]] && printf '%s\n' "$var_discord_guild_id" | pct exec "$CTID" -- botctl set "$var_bot_name" GUILD_ID
      if pct exec "$CTID" -- botctl start "$var_bot_name" >/dev/null; then
        msg_ok "Configured and Started ${var_bot_name}"
      else
        msg_warn "Could not start ${var_bot_name}; check the values with: botctl env ${var_bot_name}"
      fi
    fi
  else
    msg_warn "Could not install bot ${var_bot_name} from the archive"
  fi
  pct exec "$CTID" -- rm -f /tmp/bot-source.tgz
fi

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Manage the bots inside the container (pct enter ${CTID}) with:${CL}"
echo -e "${TAB}${BGN}botctl list${CL}"
if [[ -z "$var_discord_token" || -z "$var_discord_client_id" ]]; then
  echo -e "${TAB}${BGN}botctl env ${var_bot_name}${CL}"
  echo -e "${TAB}${BGN}botctl start ${var_bot_name}${CL}"
else
  echo -e "${TAB}${BGN}botctl logs ${var_bot_name}${CL}"
fi
