// Installs or removes the plugin in the OpenCode config dir, and keeps the cli.json entry that disables the
// built-in Context block in sync. Usage: node install.mjs install|uninstall [configDir]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DISABLE_BUILTIN = "-opencode.sidebar.context"
const FILES = ["index.js", "tui.js", "shared.js", "package.json"]

const source = dirname(fileURLToPath(import.meta.url))
const [command, override] = process.argv.slice(2)
const configDir = override || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
const target = join(configDir, "plugins", "context-override")
const cliPath = join(configDir, "cli.json")

const fail = (message) => {
  console.error(message)
  process.exit(1)
}

// Only touches our own entry; every other key and plugin is preserved.
function editPlugins(change) {
  let cli = {}
  if (existsSync(cliPath)) {
    try {
      cli = JSON.parse(readFileSync(cliPath, "utf8"))
    } catch {
      fail(`${cliPath} isn't plain JSON (comments?), so it wasn't edited. Add or remove "${DISABLE_BUILTIN}" in its "plugins" array by hand.`)
    }
  }
  const before = cli.plugins ?? []
  const after = change(before)
  if (JSON.stringify(after) === JSON.stringify(before)) return console.log(`${cliPath}: already up to date`)
  mkdirSync(configDir, { recursive: true })
  writeFileSync(cliPath, JSON.stringify({ ...cli, plugins: after }, null, 2) + "\n")
  console.log(`${cliPath}: updated`)
}

if (command === "install") {
  mkdirSync(target, { recursive: true })
  for (const file of FILES) cpSync(join(source, file), join(target, file))
  console.log(`copied ${FILES.join(", ")} to ${target}`)
  editPlugins((plugins) => (plugins.includes(DISABLE_BUILTIN) ? plugins : [...plugins, DISABLE_BUILTIN]))
  console.log("Done. The server half hot-loads; open a new TUI for the sidebar half.")
} else if (command === "uninstall") {
  rmSync(target, { recursive: true, force: true })
  console.log(`removed ${target}`)
  editPlugins((plugins) => plugins.filter((plugin) => plugin !== DISABLE_BUILTIN))
  console.log("Done. Open a new TUI to get the built-in Context block back.")
} else fail("usage: node install.mjs install|uninstall [configDir]")
