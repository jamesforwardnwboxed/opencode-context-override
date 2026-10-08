// TUI half of context-override. Replaces the built-in sidebar "Context" block (disable it with
// "-opencode.sidebar.context" in cli.json) with the same block plus a clickable context window limit.
// Hand-written against the host's OpenTUI runtime modules, like the compiled boxedcode TUI plugin, so there is no build step.

import {
  createComponent,
  createElement,
  createTextNode,
  effect,
  insert,
  insertNode,
  setProp,
} from "opentui:runtime-module:%40opentui%2Fsolid"
import { Show } from "opentui:runtime-module:solid-js"
import { ContextOverride, parseClone, parseTokens } from "./shared.js"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

const node = (tag, props = {}, ...children) => {
  const element = createElement(tag)
  for (const [name, value] of Object.entries(props)) setProp(element, name, value)
  for (const child of children) insertNode(element, child)
  return element
}
const literal = (value) => createTextNode(value)
// Text whose content and colour are re-evaluated reactively.
const text = (content, fg, ...extra) => {
  const element = createElement("text")
  for (const child of extra) insertNode(element, child)
  insert(element, content)
  effect((prev) => setProp(element, "fg", fg(), prev))
  return element
}

// The limit comes from the model id for an override (see shared.js), so a stale model list can't hide it;
// the list is only needed to find the base model's standard limit.
function resolveLimits(models, ref) {
  if (!ref) return undefined
  const parsed = parseClone(ref.id)
  const base = models.find((m) => m.providerID === ref.providerID && m.id === (parsed?.baseID ?? ref.id))
  const standard = base?.limit.context
  const current = parsed?.context ?? standard
  return current === undefined ? undefined : { current, standard: standard ?? current, overridden: parsed !== undefined }
}

// Same selection the built-in block uses: the latest assistant message after the last completed compaction
// (and before any staged revert).
function latestAssistant(messages, revertID) {
  const reverted = revertID ? messages.findIndex((message) => message.id === revertID) : -1
  if (revertID && reverted === -1) return undefined
  const end = reverted === -1 ? messages.length : reverted
  const compacted = messages.findLastIndex((m, i) => m.type === "compaction" && m.status === "completed" && i < end)
  return messages.findLast((m, i) => m.type === "assistant" && m.tokens !== undefined && i > compacted && i < end)
}

function ContextBlock(props) {
  const { context, sessionID, edit } = props
  const theme = context.theme
  const session = () => context.data.session.get(sessionID)
  const models = () => context.data.location.model.list(session()?.location) ?? []
  const message = () => latestAssistant(context.data.session.message.list(sessionID) ?? [], session()?.revert?.messageID)
  const tokens = () => {
    const t = message()?.tokens
    return t ? t.input + t.output + t.reasoning + t.cache.read + t.cache.write : 0
  }
  // The session's current model decides the limit that is actually enforced; fall back to the last message's model.
  const limits = () => resolveLimits(models(), session()?.model ?? message()?.model)
  const limit = () => limits()?.current
  const overridden = () => limits()?.overridden === true
  const cost = () => context.data.session.cost(sessionID)

  const underlined = createElement("u")
  insert(underlined, () => `(Context window limit: ${limit()?.toLocaleString()}${overridden() ? ", override" : ""})`)
  // Open on release: opening on press leaves the release landing on the dialog backdrop, which dismisses it.
  const limitText = node("text", { onMouseUp: edit }, underlined)
  effect((prev) => setProp(limitText, "fg", overridden() ? theme.text.base : theme.text.muted, prev))

  const usageRow = node("box", { flexDirection: "row", flexWrap: "wrap", columnGap: 1 })
  insertNode(usageRow, limitText)
  insert(
    usageRow,
    () => (tokens() > 0 && limit() ? text(() => `${Math.round((tokens() / limit()) * 100)}% used`, () => theme.text.muted) : undefined),
    limitText,
  )

  const title = node("text", {}, node("b", {}, literal("Context")))
  effect((prev) => setProp(title, "fg", theme.text.base, prev))

  // Each reactive child needs its own marker node, or later inserts clobber earlier ones.
  const block = node("box", {}, title)
  const dynamic = (accessor) => {
    const marker = createElement("box")
    insertNode(block, marker)
    insert(block, accessor, marker)
  }
  dynamic(() => (tokens() > 0 ? text(() => `${tokens().toLocaleString()} tokens`, () => theme.text.muted) : undefined))
  dynamic(() => (limit() ? usageRow : undefined))
  dynamic(() => (cost() > 0 ? text(() => `${money.format(cost())} spent`, () => theme.text.muted) : undefined))
  return block
}

export default {
  id: "context-override.tui",
  setup(context) {
    const toast = (message, variant = "info") => context.ui.toast.show({ title: "Context window", message, variant })

    const edit = async (sessionID) => {
      const session = context.data.session.get(sessionID)
      const models = context.data.location.model.list(session?.location) ?? []
      const limits = resolveLimits(models, session?.model)
      if (!limits) return toast("Send a message first, so the session has a model.", "warning")
      const { standard, current } = limits

      const answer = await context.ui.dialog.prompt({
        title: "Context window limit",
        description:
          `Standard limit: ${standard.toLocaleString()} tokens. Applies to this session only; compaction fires at ~90% ` +
          `of it and the override reverts afterwards. Accepts 600000, 600k or 1.2m. Enter the standard limit to reset.`,
        value: String(current),
        placeholder: String(standard),
      })
      if (answer === undefined) return
      const tokens = answer.trim() === "" ? standard : parseTokens(answer)
      if (!tokens) return toast("Enter a token count between 10k and 10m, e.g. 600k.", "error")

      try {
        await context.client.rpc(ContextOverride).set(
          { sessionID, ...(tokens === standard ? {} : { context: tokens }) },
          { location: session.location },
        )
        context.data.location.model.invalidate(session.location)
        context.data.session.invalidate(sessionID)
        await Promise.all([context.data.location.model.sync(session.location), context.data.session.sync(sessionID)])
        toast(tokens === standard ? "Back to the standard limit." : `Limit for this session: ${tokens.toLocaleString()} tokens.`, "success")
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      }
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "context-override.edit",
          title: "Context window limit",
          group: "Context",
          palette: true,
          slash: { name: "context-limit" },
          run: () => {
            const route = context.ui.router.current()
            if (route?.type === "session") void edit(route.sessionID)
            else toast("Open a session first.", "warning")
          },
        },
      ],
    }))

    // The built-in footer usage text ("238.6K (30%) · $4.23") has no click hook, but mouse events bubble up to the
    // root, so recognise that text there. Wraps rather than replaces the root's handler so nothing else is clobbered.
    const footerUsage = /^(?:\s*·\s*)?\d+(?:\.\d+)?[KM]?(?: \(\d+%\))?(?: · \$[\d,.]+)?\s*$/
    const root = context.renderer.root
    const original = root.onMouseEvent
    root.onMouseEvent = function (event) {
      original.call(this, event)
      if (event.type !== "up" || event.button !== 0 || event.defaultPrevented) return
      if (!footerUsage.test(event.target?.plainText ?? "")) return
      const route = context.ui.router.current()
      if (route?.type === "session") void edit(route.sessionID)
    }

    const unslot = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => createComponent(ContextBlock, { context, sessionID, edit: () => void edit(sessionID) }),
    })
    return () => {
      root.onMouseEvent = original
      unslot()
    }
  },
}
