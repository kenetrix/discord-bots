#!/usr/bin/env bash

# Source: https://discord.js.org/ | Github: https://github.com/kenetrix/discord-bots

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

setup_deb_based() {
  msg_error "${APP:-Bot-Machine} runs on Alpine only. Use var_os=alpine."
  exit 1
}

setup_alpine() {
  msg_info "Installing Dependencies"
  $STD apk add --no-cache \
    bash \
    git \
    nodejs \
    npm \
    su-exec \
    nano
  msg_ok "Installed Dependencies"

  msg_info "Creating Bot User"
  addgroup -S bots 2>/dev/null || true
  id bots &>/dev/null || adduser -S -D -h /home/bots -s /sbin/nologin -G bots bots
  install -d -o bots -g bots -m 0750 /opt/bots /var/log/bots
  msg_ok "Created Bot User"

  msg_info "Installing botctl"
cat <<'BOTCTL' >/usr/local/bin/botctl
#!/usr/bin/env bash
# botctl – manage the bots on the bot machine
set -Eeuo pipefail

BOTS_DIR=/opt/bots
BOT_USER=bots

die() { echo "Error: $*" >&2; exit 1; }
as_bot() { su-exec "$BOT_USER" env HOME="/home/$BOT_USER" "$@"; }
need_root() { [[ $EUID -eq 0 ]] || die "Please run as root."; }
check_name() { [[ "${1:-}" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "Invalid bot name '${1:-}' (only a-z, 0-9, -)."; }
exists() { [[ -d "$BOTS_DIR/$1" && -f "/etc/init.d/bot.$1" ]] || die "Bot '$1' does not exist. 'botctl list' shows all bots."; }
app_dir() { sed -n 's/^directory="\(.*\)"$/\1/p' "/etc/init.d/bot.$1"; }
is_active() { rc-service "bot.$1" status >/dev/null 2>&1; }

install_deps() {
  local dir="$1"
  # npm would run "node-gyp rebuild" for better-sqlite3 (needs a compiler); its prebuilt binary is used instead.
  if [[ -f "$dir/package-lock.json" ]]; then
    (cd "$dir" && as_bot npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
  else
    (cd "$dir" && as_bot npm install --omit=dev --ignore-scripts --no-audit --no-fund)
  fi
}

usage() {
  cat <<EOF
Usage: botctl <command> [arguments]

  add <name> <git-url> [--path <subfolder>] [--branch <branch>]
                     Install a bot from a git repo
  env <name>         Edit the bot's .env (token etc.)
  start <name>       Register slash commands (if available) and start
  stop <name>        Stop the bot
  restart <name>     Restart the bot
  update <name>      Pull the latest version, install dependencies, restart
  update-all         Update every installed bot
  set <name> <KEY>   Set KEY in the bot's .env to the value read from stdin
  logs <name>        Show the live log (Ctrl+C to quit)
  status <name>      Show the service status
  list               All bots with status
  remove <name>      Stop and delete the bot

Private repos: git URL with token, e.g.
  https://<token>@github.com/<user>/<repo>.git
EOF
}

cmd_add() {
  need_root
  local name="${1:-}" url="${2:-}" sub="" branch=""
  shift 2 || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --path) sub="${2:-}"; shift 2 ;;
      --branch) branch="${2:-}"; shift 2 ;;
      *) die "Unknown option: $1" ;;
    esac
  done
  check_name "$name"
  [[ -n "$url" ]] || die "Git URL is missing."
  [[ -e "$BOTS_DIR/$name" ]] && die "Bot '$name' already exists."

  local root="$BOTS_DIR/$name"
  # A failed add must not leave a half-installed bot behind.
  ADD_OK=0 ADD_NAME="$name"
  trap 'if [[ $ADD_OK -ne 1 ]]; then rm -rf "$BOTS_DIR/$ADD_NAME" "/etc/init.d/bot.$ADD_NAME"; fi' EXIT
  echo "Cloning ${url//\/\/*@/\/\/***@} …"
  as_bot git clone --quiet --depth 1 ${branch:+--branch "$branch"} "$url" "$root"
  local dir="$root${sub:+/${sub#/}}"
  [[ -f "$dir/package.json" ]] || { rm -rf "$root"; die "No package.json in $dir."; }

  echo "Installing dependencies …"
  install_deps "$dir"

  if [[ ! -f "$dir/.env" ]]; then
    if [[ -f "$dir/.env.example" ]]; then cp "$dir/.env.example" "$dir/.env"; else touch "$dir/.env"; fi
    chown "$BOT_USER:$BOT_USER" "$dir/.env"
    chmod 0600 "$dir/.env"
  fi

  # The bot reads its own .env (dotenv), so the service only needs the working directory.
  cat > "/etc/init.d/bot.$name" <<EOF
#!/sbin/openrc-run
description="Bot $name"
directory="$dir"
command="/usr/bin/npm"
command_args="start --silent"
command_user="$BOT_USER:$BOT_USER"
command_background="yes"
pidfile="/run/bot.$name.pid"
output_log="/var/log/bots/$name.log"
error_log="/var/log/bots/$name.log"
export NODE_ENV=production

depend() {
  need net
}
EOF
  chmod 0755 "/etc/init.d/bot.$name"
  rc-update add "bot.$name" default >/dev/null
  ADD_OK=1

  echo
  echo "Bot '$name' installed in $dir"
  echo "Next steps:"
  echo "  botctl env $name     # enter token and IDs"
  echo "  botctl start $name"
}

cmd_env() {
  exists "$1"
  local dir; dir=$(app_dir "$1")
  "${EDITOR:-nano}" "$dir/.env"
  if is_active "$1"; then
    read -rp "Restart the bot now? [Y/n] " a
    [[ "${a,,}" == "n" ]] || rc-service "bot.$1" restart
  fi
}

register_commands() {
  local dir; dir=$(app_dir "$1")
  (cd "$dir" && as_bot npm run --silent --if-present deploy-commands) || echo "Warning: deploy-commands failed."
}

cmd_start() { exists "$1"; register_commands "$1"; rc-service "bot.$1" start; echo "Started. Log: botctl logs $1"; }

cmd_update() {
  need_root; exists "$1"
  local root="$BOTS_DIR/$1" dir; dir=$(app_dir "$1")
  local branch; branch=$(as_bot git -C "$root" rev-parse --abbrev-ref HEAD)
  local before; before=$(as_bot git -C "$root" rev-parse --short HEAD)
  as_bot git -C "$root" fetch --quiet --depth 1 origin "$branch"
  as_bot git -C "$root" reset --quiet --hard FETCH_HEAD
  local after; after=$(as_bot git -C "$root" rev-parse --short HEAD)
  echo "$1: $before → $after"
  install_deps "$dir"
  register_commands "$1"
  if is_active "$1"; then
    rc-service "bot.$1" restart
    echo "Restarted."
  else
    echo "Not running, so not restarted. Start it with: botctl start $1"
  fi
}

cmd_update_all() {
  need_root
  local root name rc=0
  shopt -s nullglob
  for root in "$BOTS_DIR"/*/; do
    name=$(basename "$root")
    if [[ ! -f "/etc/init.d/bot.$name" ]]; then
      echo "$name: incomplete installation, skipping. Remove it with 'rm -rf $root' and run 'botctl add' again." >&2
      rc=1
      continue
    fi
    cmd_update "$name" || { echo "Update of $name failed." >&2; rc=1; }
  done
  return "$rc"
}

cmd_set() {
  need_root; exists "$1"
  local key="${2:-}" value line file tmp found=0
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || die "Invalid key '$key'."
  IFS= read -r value
  file="$(app_dir "$1")/.env"
  [[ -f "$file" ]] || die "No .env found for '$1'."
  tmp=$(mktemp)
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$key="* ]]; then
      printf '%s=%s\n' "$key" "$value"; found=1
    else
      printf '%s\n' "$line"
    fi
  done <"$file" >"$tmp"
  [[ $found -eq 1 ]] || printf '%s=%s\n' "$key" "$value" >>"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

cmd_list() {
  printf '%-20s %-10s %-9s %s\n' NAME STATUS VERSION DIRECTORY
  shopt -s nullglob
  for root in "$BOTS_DIR"/*/; do
    local name; name=$(basename "$root")
    local state=stopped; is_active "$name" && state=started
    local rev; rev=$(as_bot git -C "$root" rev-parse --short HEAD 2>/dev/null || echo "-")
    printf '%-20s %-10s %-9s %s\n' "$name" "$state" "$rev" "$(app_dir "$name")"
  done
}

cmd_remove() {
  need_root; exists "$1"
  read -rp "Really delete bot '$1' including its data? Type the name to confirm: " a
  [[ "$a" == "$1" ]] || die "Aborted."
  rc-service "bot.$1" stop >/dev/null 2>&1 || true
  rc-update del "bot.$1" default >/dev/null 2>&1 || true
  rm -rf "/etc/init.d/bot.$1" "/var/log/bots/$1.log" "${BOTS_DIR:?}/$1"
  echo "Bot '$1' deleted."
}

cmd="${1:-}"; shift || true
case "$cmd" in
  add) cmd_add "$@" ;;
  env) check_name "${1:-}"; cmd_env "$1" ;;
  start) check_name "${1:-}"; cmd_start "$1" ;;
  stop|restart|status) check_name "${1:-}"; exists "$1"; rc-service "bot.$1" "$cmd" ;;
  update) check_name "${1:-}"; cmd_update "$1" ;;
  update-all) cmd_update_all ;;
  set) check_name "${1:-}"; cmd_set "$1" "${2:-}" ;;
  logs) check_name "${1:-}"; exists "$1"; tail -n 100 -f "/var/log/bots/$1.log" ;;
  list|ls) cmd_list ;;
  remove|rm) check_name "${1:-}"; cmd_remove "$1" ;;
  ""|-h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
BOTCTL
  chmod 0755 /usr/local/bin/botctl
  msg_ok "Installed botctl"

  # Optional inputs, exported by ct/bot-machine.sh: var_bot_name, var_bot_repo, var_bot_path,
  # var_bot_repo_token, var_web_password, var_discord_token, var_discord_client_id, var_discord_guild_id
  BOT_NAME="${var_bot_name:-jarvis}"
  BOT_REPO="${var_bot_repo:-https://github.com/kenetrix/discord-bots.git}"
  BOT_PATH="${var_bot_path-bot}"
  if [[ -n "${var_bot_repo_token:-}" ]]; then
    BOT_REPO="${BOT_REPO/https:\/\//https:\/\/x-access-token:${var_bot_repo_token}@}"
  fi

  msg_info "Installing Bot ${BOT_NAME}"
  if botctl add "$BOT_NAME" "$BOT_REPO" ${BOT_PATH:+--path "$BOT_PATH"}; then
    msg_ok "Installed Bot ${BOT_NAME}"

    if [[ -n "${var_discord_token:-}" && -n "${var_discord_client_id:-}" ]]; then
      msg_info "Configuring and Starting ${BOT_NAME}"
      printf '%s\n' "$var_discord_token" | botctl set "$BOT_NAME" DISCORD_TOKEN
      printf '%s\n' "$var_discord_client_id" | botctl set "$BOT_NAME" CLIENT_ID
      [[ -n "${var_discord_guild_id:-}" ]] && printf '%s\n' "$var_discord_guild_id" | botctl set "$BOT_NAME" GUILD_ID
      if $STD botctl start "$BOT_NAME"; then
        msg_ok "Configured and Started ${BOT_NAME}"
      else
        msg_warn "Could not start ${BOT_NAME}; check the values with: botctl env ${BOT_NAME}"
      fi
    else
      msg_warn "No Discord credentials given. Finish with: botctl env ${BOT_NAME} && botctl start ${BOT_NAME}"
    fi
  else
    msg_warn "Could not install bot ${BOT_NAME} from ${BOT_REPO//\/\/*@/\/\/***@}. Add it later with: botctl add <name> <git-url> --path <subfolder>"
  fi

  # Web interface for botctl (webui/ in this repository). Optional input: var_web_password.
  msg_info "Installing Web Interface"
  WEBUI_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/kenetrix/discord-bots/main}/webui"
  install -d -m 0750 /opt/botctl-web /etc/botctl-web
  if wget -qO /opt/botctl-web/server.js "$WEBUI_URL/server.js" && wget -qO /opt/botctl-web/index.html "$WEBUI_URL/index.html"; then
    WEB_PASSWORD="${var_web_password:-$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)}"
    printf '%s\n' "$WEB_PASSWORD" >/etc/botctl-web/password
    chmod 0600 /etc/botctl-web/password
    cat <<'WEBSERVICE' >/etc/init.d/botctl-web
#!/sbin/openrc-run
description="botctl web interface"
command="/usr/bin/node"
command_args="/opt/botctl-web/server.js"
command_background="yes"
pidfile="/run/botctl-web.pid"
output_log="/var/log/botctl-web.log"
error_log="/var/log/botctl-web.log"

depend() {
  need net
}
WEBSERVICE
    chmod 0755 /etc/init.d/botctl-web
    $STD rc-update add botctl-web default
    $STD rc-service botctl-web start
    msg_ok "Installed Web Interface"
  else
    msg_warn "Could not download the web interface from $WEBUI_URL"
  fi
}

run_os_setup

motd_ssh
customize
cleanup_lxc
