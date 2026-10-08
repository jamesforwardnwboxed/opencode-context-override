# opencode-context-override

An OpenCode **v2** plugin that temporarily changes the context window limit for **one session**, so auto-compaction
waits until you're near the end of a task instead of firing mid-work.

- Click the limit in the sidebar's Context block, or the usage text in the footer (`238.6K (30%) · $4.23`), to open a
  popup and type a new limit (`600000`, `600k`, `1.2m`).
- Compaction then fires at ~90% of the number you typed, and the sidebar `% used` is measured against it.
- Only that session is affected. Other sessions on the same model keep the normal limit.
- It reverts to the normal limit after the next compaction, or when you reset it.

Tested against OpenCode 2.0.25. It uses v2 plugin APIs and will not work on v1.

## Install

Clone it anywhere (not directly into the OpenCode config dir) and run:

```sh
git clone git@github.com:jamesforwardnwboxed/opencode-context-override.git
cd opencode-context-override
make install
```

`make install` does two things:

1. Copies the plugin files into `~/.config/opencode/plugins/context-override/` (or
   `$XDG_CONFIG_HOME/opencode/...`; override with `make install OPENCODE_CONFIG_DIR=/some/dir`).
2. Adds `"-opencode.sidebar.context"` to the `plugins` array in `cli.json`, which turns off the built-in Context
   block. Without that you'd see two Context blocks: a plugin can add to the sidebar but can't edit the built-in
   block. Your other settings and plugins in `cli.json` are left as they are. It's idempotent, and if `cli.json`
   contains comments it won't touch it and tells you what to add by hand.

Re-run `make install` after pulling changes. `make uninstall` removes the plugin and the `cli.json` entry, which
brings the built-in block back. If this plugin ever fails to load, the built-in block stays disabled until you
uninstall.

Then reload:

- **Server half** (`index.js`): hot-loads when the files change, no restart needed. If it doesn't, run
  `opencode reload`. Avoid `opencode service restart` unless you have to; it restarts the shared service and
  interrupts running sessions in every pane.
- **TUI half** (`tui.js`): loads when the TUI starts, so open a new TUI. Running TUIs keep the old sidebar.

## Use

| Action | How |
|---|---|
| Set a limit | Click `(Context window limit: …)` in the sidebar, or click the usage text in the footer, or run `/context-limit` |
| Reset | Enter the standard limit (or leave the box empty) |
| Accepted values | `600000`, `600,000`, `600k`, `1.2m` (10k to 10m) |

The label shows `, override` while a limit is active, and the model name gains a suffix such as `· 600k ctx`.

## How it works

OpenCode has no per-session limit. Compaction and the sidebar both read the limit from the model catalog entry the
session uses. So an override is a **derived catalog entry** (`<model>~ctx600000`): the same API model, provider
settings and pricing, with `limit.context` set to your number and `limit.input` removed (so compaction falls back to
`context`, minus OpenCode's 10% buffer). The session is then switched onto it.

- `index.js` (server): registers the derived models (persisted, so sessions survive restarts), exposes the
  `context-override/set` RPC, switches sessions, and reverts them after a compaction completes. It also hooks
  prompts: the TUI re-sends its own selected model with every prompt and doesn't know about derived models, so if a
  session with an override has been put back on its base model, the hook switches it back before the turn runs.
- `tui.js` (TUI): a replacement Context sidebar block with the clickable limit, a click handler on the footer usage
  text, and the `/context-limit` command. Hand-written against the host's OpenTUI runtime modules, so there is no
  build step.
- `shared.js`: the id convention (`~ctx<tokens>`), input parsing and limit maths used by both halves.

## Things to know

- **No ceiling is enforced.** The provider's real limit may be lower than what you type. If a request is rejected as
  too long, OpenCode compacts and retries.
- **Cost.** Limits may be capped for pricing reasons (some models have a long-context price tier). Check before raising
  a limit by a lot.
- **Model picker.** Each override value adds a catalog entry, and they show up in the model picker. While an override
  is on, picking the same base model from the picker won't stick; use the reset instead.
- **Footer percentage.** The built-in footer measures against the model of the last reply, so right after you change a
  limit it shows the old percentage until the next reply. The sidebar updates immediately.
- **Prompt cache.** The derived model sends the same API model id, so provider-side caching should be unaffected. This
  has not been tested across a switch with a warm cache.
- Ending a drag-selection over the footer usage text also opens the popup.

## Develop

```sh
make check   # unit checks for the parsing and limit maths
```

The server half can be tried without touching your running service: start a private server with throwaway config
(`XDG_CONFIG_HOME`/`XDG_DATA_HOME` set to a temp dir, `opencode serve --port <port>`), define a fake
openai-compatible provider pointing at a local mock, and call `POST /api/rpc/context-override/set` with
`{"input": {"sessionID": "...", "context": 600000}}`.
