#!/usr/bin/env bash
# =============================================================================
#  Bot machine – Proxmox VE helper script
#  Creates a Debian LXC that runs multiple bots (Node.js), each as its own
#  systemd service. Managed inside the container with `botctl`.
#
#  Run on the Proxmox host as root:
#    bash bot-machine.sh
#
#  Without dialogs (all values optional, defaults otherwise):
#    CTID=120 HOSTNAME=bot-machine CORES=1 RAM=1024 DISK=8 STORAGE=local-lvm \
#    BRIDGE=vmbr0 IP=dhcp NODE_MAJOR=24 bash bot-machine.sh --yes
# =============================================================================
set -Eeuo pipefail

# ---------- Output -----------------------------------------------------------
YW=$'\033[33m'; GN=$'\033[1;92m'; RD=$'\033[01;31m'; BL=$'\033[36m'; CL=$'\033[m'
msg_info() { printf ' %s…%s %s\n' "$YW" "$CL" "$1"; }
msg_ok()   { printf ' %s✔%s %s\n' "$GN" "$CL" "$1"; }
msg_err()  { printf ' %s✖%s %s\n' "$RD" "$CL" "$1" >&2; }
die()      { msg_err "$1"; exit 1; }
trap 'msg_err "Aborted at line $LINENO: $BASH_COMMAND"' ERR

header() {
  clear 2>/dev/null || true
  cat <<EOF
${BL}
   ___       __    __  ___         __   _
  / _ )___  / /_  /  |/  /__ _____/ /  (_)__  ___
 / _  / _ \/ __/ / /|_/ / _ \`/ __/ _ \/ / _ \/ -_)
/____/\___/\__/ /_/  /_/\_,_/\__/_//_/_/_//_/\__/
${CL}
  LXC for self-hosted bots (Node.js + systemd)
EOF
  echo
}

# ---------- Prerequisites ----------------------------------------------------
ASSUME_YES=0
[[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && ASSUME_YES=1

header
[[ $EUID -eq 0 ]] || die "Please run as root on the Proxmox host."
command -v pct >/dev/null && command -v pveam >/dev/null || die "Proxmox VE not found (pct/pveam missing)."
if [[ $ASSUME_YES -eq 0 ]] && ! command -v whiptail >/dev/null; then
  die "whiptail is missing. Install it with 'apt install whiptail' or use --yes."
fi

# ---------- Defaults ---------------------------------------------------------
CTID="${CTID:-$(pvesh get /cluster/nextid)}"
HOSTNAME="${HOSTNAME_CT:-${HOSTNAME:-bot-machine}}"
# The Proxmox host's own shell HOSTNAME is not a sensible default.
[[ "$HOSTNAME" == "$(hostname)" ]] && HOSTNAME="bot-machine"
CORES="${CORES:-1}"
RAM="${RAM:-1024}"
SWAP="${SWAP:-512}"
DISK="${DISK:-8}"
BRIDGE="${BRIDGE:-vmbr0}"
IP="${IP:-dhcp}"
GATEWAY="${GATEWAY:-}"
NODE_MAJOR="${NODE_MAJOR:-24}"
ROOT_PASSWORD="${ROOT_PASSWORD:-}"

# Container storage: first storage that supports container root filesystems
mapfile -t ROOT_STORAGES < <(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 {print $1}')
[[ ${#ROOT_STORAGES[@]} -gt 0 ]] || die "No storage with content type 'rootdir' found."
STORAGE="${STORAGE:-${ROOT_STORAGES[0]}}"

TMPL_STORAGE="${TMPL_STORAGE:-$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 {print $1; exit}')}"
[[ -n "$TMPL_STORAGE" ]] || die "No storage with content type 'vztmpl' (templates) found."

# ---------- Dialogs ----------------------------------------------------------
ask() { # ask <title> <question> <default>
  whiptail --title "$1" --inputbox "$2" 10 60 "$3" 3>&1 1>&2 2>&3 || die "Aborted."
}

if [[ $ASSUME_YES -eq 0 ]]; then
  if whiptail --title "Bot machine" --yesno \
    "Create with default values?\n\nCT-ID: $CTID\nHostname: $HOSTNAME\nCPU: $CORES core(s), RAM: $RAM MB, disk: $DISK GB\nStorage: $STORAGE, network: $BRIDGE ($IP)\nNode.js: $NODE_MAJOR\n\n'No' opens the advanced settings." \
    18 64; then
    :
  else
    CTID=$(ask "CT-ID" "Container ID" "$CTID")
    HOSTNAME=$(ask "Hostname" "Container hostname" "$HOSTNAME")
    CORES=$(ask "CPU" "Number of CPU cores" "$CORES")
    RAM=$(ask "RAM" "Memory in MB (plan for about 150 MB per bot)" "$RAM")
    DISK=$(ask "Disk" "Disk size in GB" "$DISK")
    if [[ ${#ROOT_STORAGES[@]} -gt 1 ]]; then
      menu=(); for s in "${ROOT_STORAGES[@]}"; do menu+=("$s" ""); done
      STORAGE=$(whiptail --title "Storage" --menu "Storage for the container" 16 60 6 "${menu[@]}" 3>&1 1>&2 2>&3) || die "Aborted."
    fi
    BRIDGE=$(ask "Network" "Bridge" "$BRIDGE")
    IP=$(ask "Network" "IPv4: 'dhcp' or static with CIDR, e.g. 192.168.1.50/24" "$IP")
    if [[ "$IP" != "dhcp" ]]; then
      GATEWAY=$(ask "Network" "Gateway" "${GATEWAY:-${IP%.*}.1}")
    fi
    NODE_MAJOR=$(ask "Node.js" "Node.js major version" "$NODE_MAJOR")
    ROOT_PASSWORD=$(whiptail --title "Root password" --passwordbox \
      "Root password for the container (empty = no password, access via 'pct enter $CTID')" 10 60 3>&1 1>&2 2>&3) || die "Aborted."
  fi
fi

[[ "$CTID" =~ ^[0-9]+$ ]] || die "Invalid CT ID: $CTID"
pct status "$CTID" &>/dev/null && die "CT ID $CTID is already in use."
[[ "$HOSTNAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]*$ ]] || die "Invalid hostname: $HOSTNAME"

# ---------- Template ---------------------------------------------------------
msg_info "Updating template list"
pveam update >/dev/null
TEMPLATE=$(pveam available --section system | awk '{print $2}' | grep -E '^debian-1[23]-standard_' | sort -V | tail -n1)
[[ -n "$TEMPLATE" ]] || die "No Debian template found."
msg_ok "Template: $TEMPLATE"

if ! grep -q "$TEMPLATE" <<< "$(pveam list "$TMPL_STORAGE")"; then
  msg_info "Downloading template"
  pveam download "$TMPL_STORAGE" "$TEMPLATE" >/dev/null
  msg_ok "Template downloaded"
fi

# ---------- Create container -------------------------------------------------
NET="name=eth0,bridge=$BRIDGE,ip=$IP"
[[ -n "$GATEWAY" ]] && NET+=",gw=$GATEWAY"

msg_info "Creating container $CTID"
pct create "$CTID" "$TMPL_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$HOSTNAME" \
  --cores "$CORES" --memory "$RAM" --swap "$SWAP" \
  --rootfs "$STORAGE:$DISK" \
  --net0 "$NET" \
  --unprivileged 1 --features nesting=1 \
  --onboot 1 --ostype debian --timezone host \
  --tags bots \
  --description "Bot machine: bots live in /opt/bots, managed with 'botctl'." \
  ${ROOT_PASSWORD:+--password "$ROOT_PASSWORD"} >/dev/null
msg_ok "Container $CTID ($HOSTNAME) created"

msg_info "Starting container"
pct start "$CTID"
for _ in $(seq 1 30); do
  pct exec "$CTID" -- getent hosts deb.debian.org &>/dev/null && break
  sleep 1
done
pct exec "$CTID" -- getent hosts deb.debian.org &>/dev/null || die "Container has no network (DNS)."
msg_ok "Container is running and has network"

# ---------- Install inside the container -------------------------------------
msg_info "Installing Node.js $NODE_MAJOR, git and botctl (takes 1 to 3 minutes)"
pct exec "$CTID" -- env NODE_MAJOR="$NODE_MAJOR" bash -s >/dev/null <<'INSTALL'
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git build-essential python3 nano >/dev/null

# Node.js via NodeSource
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update -qq
apt-get install -y -qq nodejs >/dev/null

# Dedicated unprivileged user for all bots
id bots &>/dev/null || useradd --system --create-home --home-dir /home/bots --shell /usr/sbin/nologin bots
install -d -o bots -g bots -m 0750 /opt/bots

# systemd template: every bot runs as bot@<name>
cat > /etc/systemd/system/bot@.service <<'UNIT'
[Unit]
Description=Bot %i
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bots
Group=bots
# botctl sets WorkingDirectory and EnvironmentFile per bot in bot@<name>.service.d/
WorkingDirectory=/opt/bots/%i
ExecStart=/usr/bin/npm start --silent
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5
KillMode=mixed
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
INSTALL

# Push botctl separately to keep the heredoc above readable
pct exec "$CTID" -- bash -c 'cat > /usr/local/bin/botctl && chmod 0755 /usr/local/bin/botctl' <<'BOTCTL'
#!/usr/bin/env bash
# botctl – manage the bots on the bot machine
set -Eeuo pipefail

BOTS_DIR=/opt/bots
BOT_USER=bots

die() { echo "Error: $*" >&2; exit 1; }
as_bot() { runuser -u "$BOT_USER" -- env HOME="/home/$BOT_USER" "$@"; }
need_root() { [[ $EUID -eq 0 ]] || die "Please run as root."; }
check_name() { [[ "${1:-}" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "Invalid bot name '${1:-}' (only a-z, 0-9, -)."; }
exists() { [[ -d "$BOTS_DIR/$1" ]] || die "Bot '$1' does not exist. 'botctl list' shows all bots."; }
app_dir() { systemctl show -p WorkingDirectory --value "bot@$1"; }

install_deps() {
  local dir="$1"
  if [[ -f "$dir/package-lock.json" ]]; then
    (cd "$dir" && as_bot npm ci --omit=dev --no-audit --no-fund)
  else
    (cd "$dir" && as_bot npm install --omit=dev --no-audit --no-fund)
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
  logs <name>        Show the live log (Ctrl+C to quit)
  status <name>      Show the systemd status
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
  echo "Cloning $url …"
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

  install -d "/etc/systemd/system/bot@$name.service.d"
  cat > "/etc/systemd/system/bot@$name.service.d/override.conf" <<EOF
[Service]
WorkingDirectory=$dir
EnvironmentFile=-$dir/.env
EOF
  systemctl daemon-reload
  systemctl enable --quiet "bot@$name"

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
  if systemctl is-active --quiet "bot@$1"; then
    read -rp "Restart the bot now? [Y/n] " a
    [[ "${a,,}" == "n" ]] || systemctl restart "bot@$1"
  fi
}

register_commands() {
  local dir; dir=$(app_dir "$1")
  (cd "$dir" && as_bot npm run --silent --if-present deploy-commands) || echo "Warning: deploy-commands failed."
}

cmd_start() { exists "$1"; register_commands "$1"; systemctl start "bot@$1"; echo "Started. Log: botctl logs $1"; }

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
  systemctl restart "bot@$1"
  echo "Restarted."
}

cmd_list() {
  printf '%-20s %-10s %-9s %s\n' NAME STATUS VERSION DIRECTORY
  shopt -s nullglob
  for root in "$BOTS_DIR"/*/; do
    local name; name=$(basename "$root")
    local state; state=$(systemctl is-active "bot@$name" 2>/dev/null || true)
    local rev; rev=$(as_bot git -C "$root" rev-parse --short HEAD 2>/dev/null || echo "-")
    printf '%-20s %-10s %-9s %s\n' "$name" "$state" "$rev" "$(app_dir "$name")"
  done
}

cmd_remove() {
  need_root; exists "$1"
  read -rp "Really delete bot '$1' including its data? Type the name to confirm: " a
  [[ "$a" == "$1" ]] || die "Aborted."
  systemctl disable --now --quiet "bot@$1" || true
  rm -rf "/etc/systemd/system/bot@$1.service.d" "${BOTS_DIR:?}/$1"
  systemctl daemon-reload
  echo "Bot '$1' deleted."
}

cmd="${1:-}"; shift || true
case "$cmd" in
  add) cmd_add "$@" ;;
  env) check_name "${1:-}"; cmd_env "$1" ;;
  start) check_name "${1:-}"; cmd_start "$1" ;;
  stop|restart|status) check_name "${1:-}"; exists "$1"; systemctl "$cmd" "bot@$1" ;;
  update) check_name "${1:-}"; cmd_update "$1" ;;
  logs) check_name "${1:-}"; exists "$1"; journalctl -u "bot@$1" -n 100 -f ;;
  list|ls) cmd_list ;;
  remove|rm) check_name "${1:-}"; cmd_remove "$1" ;;
  ""|-h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
BOTCTL
msg_ok "Node.js $(pct exec "$CTID" -- node -v), git and botctl installed"

# ---------- Optional: set up the first bot right away -------------------------
add_first_bot() {
  local name url sub
  name=$(ask "Add bot" "Bot name (a-z, 0-9, -)" "jarvis")
  url=$(ask "Add bot" "Git URL (private: https://<token>@github.com/<user>/<repo>.git)" "")
  sub=$(ask "Add bot" "Subfolder in the repo containing package.json (empty = root)" "bot")
  pct exec "$CTID" -- botctl add "$name" "$url" ${sub:+--path "$sub"} || { msg_err "botctl add failed."; return; }

  # Prompt for empty values from .env.example and write them to .env
  local dir; dir=$(pct exec "$CTID" -- systemctl show -p WorkingDirectory --value "bot@$name")
  local env_content; env_content=$(pct exec "$CTID" -- cat "$dir/.env")
  local new_env="" line key val
  while IFS= read -r line; do
    if [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=$ ]]; then
      key="${BASH_REMATCH[1]}"
      if [[ "$key" =~ TOKEN|SECRET|PASSWORD|KEY ]]; then
        val=$(whiptail --title "$name: .env" --passwordbox "$key (leave empty to skip)" 10 64 3>&1 1>&2 2>&3) || val=""
      else
        val=$(whiptail --title "$name: .env" --inputbox "$key (leave empty to skip)" 10 64 3>&1 1>&2 2>&3) || val=""
      fi
      line="$key=$val"
    fi
    new_env+="$line"$'\n'
  done <<< "$env_content"
  printf '%s' "$new_env" | pct exec "$CTID" -- bash -c "cat > '$dir/.env'"

  if whiptail --title "$name" --yesno "Start bot '$name' now?" 8 50; then
    pct exec "$CTID" -- botctl start "$name"
  fi
}

if [[ $ASSUME_YES -eq 0 ]] && whiptail --title "Bot machine" --yesno "The container is ready. Add a bot from a git repo right now?" 10 60; then
  add_first_bot
fi

# ---------- Done -------------------------------------------------------------
CT_IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
echo
msg_ok "Bot machine $HOSTNAME (CT $CTID) is ready${CT_IP:+, IP $CT_IP}"
cat <<EOF

  Enter the container:  ${BL}pct enter $CTID${CL}
  Add a bot:            ${BL}botctl add <name> <git-url> --path <subfolder>${CL}
  Overview:             ${BL}botctl list${CL}
  Help:                 ${BL}botctl help${CL}

EOF
