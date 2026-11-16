# marginalia-host

A local Node 22 server that runs the Claude Agent SDK on your papers and streams its work to the Marginalia web app over HTTP and SSE.

## Install

```sh
npm run host:install
```

## Auth

The Agent SDK docs reserve claude.ai login for Anthropic's own products, so the supported credentials are:

- `ANTHROPIC_API_KEY` from the Anthropic Console (pay-as-you-go) is the supported path.
- `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` also works, as a convenience.

Set one in the environment or in `~/.config/marginalia/host.env` as `KEY=value` lines (values from the file fill only keys the environment lacks), then `chmod 600 ~/.config/marginalia/host.env`. Never pass a key on the command line. On start the host prints which kind it found, never the value.

## Start

```sh
npm run host
```

Flags, passed after `node host/dist/main.js`:

- `--port 7700` listen port on `127.0.0.1`.
- `--app https://purush-foundry.github.io` the web app origin used for CORS and the pairing URL.
- `--model claude-opus-5-5` and `--effort medium` (`low`, `medium` or `high`).
- `--root ~/.marginalia` where papers, sessions and the token live.
- `--repo <dir>` the Marginalia checkout whose `skills/` load as the `marginalia` plugin; defaults to the repo that holds `host/dist/main.js`.
- `--token <t>` use this token instead of the stored one; `--new-token` replaces the stored one.
- `--read <dir>` a folder the agent may read; repeat for more. See the fence below.
- `--allow-bash` enable shell access. See Bash below.

## Pairing

The host prints a pairing URL on start. Open it in Chrome; Chrome asks once for loopback network access. Safari cannot reach the host.

## Token file

The pairing token is stored in `~/.marginalia/host-token` (mode 600) so it survives restarts. Start with `--new-token` to replace it, which unpairs every browser.

## Read/write fence

The agent works in the paper's folder under `~/.marginalia/papers/`. It writes only inside that folder.

It reads only from an allowlist: the paper's folder, the repo's `skills/` folder, and the owner folders the host was started with. Owner folders come from the `--read <dir>` flags; without any, from `MARGINALIA_READ_DIRS` (colon-separated, also accepted in `host.env`); without that, from `~/Documents`, `~/Desktop` and `~/ToRead`, keeping those that exist. The host prints the list on start. Everything else is unreadable. Inside allowed folders, private paths stay denied: `~/.ssh`, `~/.aws`, `~/.config/marginalia`, `.env` files, `.pem` and `.key` files and similar.

If the fence check fails or times out, the tool call is blocked.

## Bash

Shell access is off by default. `--allow-bash` turns it on for chat sessions and verdict runs. Shell commands run without approval and without the fence. They can read and write anything your user can, including the private paths above, and they run with your API key or OAuth token in their environment. The host prints a warning on start while the flag is on.
