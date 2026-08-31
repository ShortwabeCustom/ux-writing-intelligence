# Install UX Writing Intelligence on macOS

This package is for designers using Figma Desktop on an Apple silicon Mac.
It contains the prebuilt Figma plugin and its local runtime. You do not need a
GitHub account, Git, `gh`, Node, npm, or a cloud API key for **Solo local**.

The first setup needs internet access to install any missing system software,
Python packages, Ollama, and the `qwen3.5:4b` model. The model download can take
several minutes. Homebrew may ask for macOS administrator authorization if it
is not already installed.

## Install

1. Unzip the downloaded package.
2. Open Terminal, type `cd ` (including the trailing space), drag the unzipped
   folder into Terminal, and press Return.
3. Run:

   ```bash
   ./scripts/install-mac.sh
   ```

4. Wait for `Installation complete`. The installer prints the exact manifest
   path to import.
5. In Figma Desktop, choose **Plugins > Development > Import plugin from
   manifest...** and select `manifest.json` from this folder.
6. Open UX Writing Intelligence and choose **Solo local**.

The installer is safe to run again. It reuses a compatible Python environment,
the installed Ollama application and model, and a healthy local runtime.

## Start, stop, status, and verification

From the unzipped package folder, use:

```bash
./scripts/start-runtime.sh
./scripts/stop-runtime.sh
./scripts/status-runtime.sh
./scripts/verify-install.sh
```

Keep the unzipped folder after importing the plugin: it contains the runtime.
Moving it while the runtime is running is not supported; stop it first.

## Privacy

In **Solo local**, text is analyzed on this Mac. The runtime listens only on
`127.0.0.1:8787`, and Ollama only on `127.0.0.1:11434`; neither is exposed to
the local network. No GitHub credential or cloud API key is requested or
stored by this installer. Cloud analysis, if used separately, remains optional.

The installer does not create a login item, LaunchAgent, Homebrew service, or
firewall rule. Runtime lifecycle remains under the commands above.
