# Install UX Writing Intelligence on macOS

This installer sets up the Figma plugin, its local Python runtime, Ollama, and
the approved `qwen3.5:4b` model. It does not install a background login service;
the runtime is started and stopped explicitly.

## Prerequisites

- macOS on Apple Silicon (`arm64`) or Intel (`x86_64`)
- Git and access to the private GitHub repository
- Figma Desktop
- Internet access for the initial dependencies and model download

Homebrew is used for missing system dependencies. If Homebrew itself is
missing, the installer explains the official installation step and asks for
confirmation before it runs anything that may request administrator approval.

## Quick install

```bash
git clone https://github.com/ShortwabeCustom/ux-writing-intelligence.git
cd ux-writing-intelligence
./scripts/install-mac.sh
```

The installer is idempotent: rerunning it reuses healthy dependencies, the
Python virtual environment, the existing Ollama model, and a healthy runtime.

## Import the plugin in Figma

Open Figma Desktop and choose **Plugins > Development > Import plugin from
manifest...**. Select:

```text
ux-writing-intelligence/manifest.json
```

The installer also prints the exact absolute path for the current clone.

## Runtime commands

Run these commands from the repository root:

```bash
./scripts/start-runtime.sh
./scripts/status-runtime.sh
./scripts/stop-runtime.sh
./scripts/verify-install.sh
```

The runtime listens only at `http://127.0.0.1:8787`. Ollama listens only at
`127.0.0.1:11434`. These scripts do not create a LaunchAgent, launchd daemon,
Homebrew service, firewall rule, or LAN listener.

## Update

Save or commit your own work before updating, then run:

```bash
git pull --ff-only
./scripts/install-mac.sh
```

Rerunning the installer updates dependencies only when needed and rebuilds the
plugin from the repository's locked source.

## Privacy and cloud configuration

In **Solo local** mode, AI content is processed on this Mac by the local
runtime and Ollama. No API key is required for local-only operation. Cloud
configuration remains optional and separate; this installer neither requests
nor stores cloud credentials.
