# marginalia-host

A local Node 22 server that runs the Claude Agent SDK on your papers and streams its work to the Marginalia web app over HTTP and SSE.

## Install

```sh
npm run host:install
```

## Auth

The Agent SDK docs reserve claude.ai login for Anthropic's own products, so the supported credentials are:

- `ANTHROPIC_API_KEY` from the Anthropic Console (pay-as-you-go), or
- `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`.

Set one in the environment or in `~/.config/marginalia/host.env` as `KEY=value` lines. Never pass a key on the command line.

## Start

```sh
npm run host
```

## Pairing

The host prints a pairing URL on start. Open it in Chrome; Chrome asks once for loopback network access. Safari cannot reach the host.

## Token file

The pairing token is stored in a file under `~/.config/marginalia/` so it survives restarts.

## Read/write fence

The agent reads and writes only inside its working directory; paths outside it are denied.

## Bash

Shell access is off by default. Start with `--allow-bash` to enable it.
