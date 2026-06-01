# Wazuh Agent Installer

A desktop GUI application built with [Tauri v2](https://tauri.app) that provides a guided, wizard-style interface for installing and configuring a full Wazuh security agent stack on Linux and macOS machines.

Instead of running a shell script manually from the terminal, this app walks the user through configuration, previews the installation plan, then executes the `setup-agent.sh` script with elevated privileges — streaming real-time logs directly into the UI.

---

## What it installs

The app runs `setup-agent.sh`, which installs the following components:

**Core (always installed)**
- [Wazuh Agent](https://documentation.wazuh.com/current/installation-guide/wazuh-agent/index.html) — the core security monitoring agent
- [wazuh-cert-oauth2-client](https://github.com/ADORSYS-GIS/wazuh-cert-oauth2) — certificate-based OAuth2 authentication client
- [wazuh-agent-status](https://github.com/ADORSYS-GIS/wazuh-agent-status) — agent health monitoring daemon
- [YARA](https://virustotal.github.io/yara/) — malware detection via YARA rules
- USB DLP active response scripts — blocks/alerts on unauthorized USB storage and HID devices

**Configurable (user choice)**
- **Suricata** (IDS or IPS mode) — high-performance network intrusion detection/prevention
- **Snort** — classic open-source network IDS
- **Trivy** *(optional)* — vulnerability and misconfiguration scanner

---

## Features

- 4-step wizard: **Configure → Components → Review → Install**
- Real-time log streaming from the install script into a terminal-style view
- GUI privilege escalation via `pkexec` (no terminal sudo required)
- System tray icon — minimizes to tray, left-click to toggle, right-click for menu
- Works on Linux and macOS

---

## Prerequisites

Before running the app, make sure you have the following installed:

### System dependencies

**Linux (Debian/Ubuntu)**
```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  policykit-1
```

**macOS**
```bash
xcode-select --install
```

### Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### Node.js
Any recent LTS version (18+). Install via [nvm](https://github.com/nvm-sh/nvm) or your package manager.

### Tauri CLI
```bash
npm install
```

---

## Running in development

```bash
npm run tauri dev
```

This starts the Tauri dev server with hot-reload. The app window will open automatically.

---

## Building a release binary

```bash
npm run tauri build
```

The compiled app and installer packages are output to:
```
src-tauri/target/release/bundle/
```

On Linux this produces a `.deb` and `.AppImage`. On macOS it produces a `.dmg`.

---

## Project structure

```
setup-agent.sh-app/
├── setup-agent.sh              # The bash install script bundled with the app
├── src/
│   ├── index.html              # App UI — 4-step wizard
│   ├── main.js                 # Frontend logic (Tauri JS API calls, event listeners)
│   └── styles.css              # Dark-theme design system
└── src-tauri/
    ├── src/
    │   ├── lib.rs              # Rust backend — tray, install command, log streaming
    │   └── main.rs             # Entry point
    ├── capabilities/
    │   └── default.json        # Tauri permission scopes
    ├── icons/                  # App icons (all sizes)
    ├── Cargo.toml              # Rust dependencies
    └── tauri.conf.json         # Tauri app configuration
```

---

## How it works

1. The user fills in the **Configure** step — Wazuh Manager address, agent name, version, and log level.
2. On the **Components** step, they choose an IDS engine (Suricata or Snort) and optionally enable Trivy.
3. The **Review** step shows a summary of all selected options before anything is run.
4. On **Install**, the app calls the Rust `run_install` command via Tauri's IPC bridge. Rust spawns `pkexec env ... bash setup-agent.sh` with the user's config passed as environment variables. stdout and stderr are streamed line-by-line back to the frontend as `install-log` events and rendered in the terminal view.
5. On completion, a success or failure screen is shown. The app remains in the system tray.

---

## Tray icon

- **Left-click** — toggle the window (show/hide)
- **Right-click** — open menu
  - **Show Installer** — bring the window to focus
  - **Quit** — exit the application

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | [Tauri v2](https://tauri.app) |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Backend | Rust (Tokio async runtime) |
| Privilege escalation | `pkexec` (Linux) |
| Install script | Bash (`setup-agent.sh`) |
