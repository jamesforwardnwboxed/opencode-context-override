// Server half of context-override: registers the derived models and switches sessions onto them.
// See shared.js for the approach. The TUI half (tui.tsx) is the user interface.

import { ContextOverride, cloneID, overrideLimit, parseClone } from "./shared.js"

const unwrap = (value) => value?.data ?? value
const kb = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : `${+(n / 1e3).toFixed(1)}k`)

export default {
  id: "context-override",
  async setup(ctx) {
    // Derived models must exist on every start or sessions switched onto them would reference a missing
    // model after a restart, so they're persisted. They're tiny and only ever created on demand.
    const clones = new Map()
    const stored = await ctx.storage.scan({ prefix: "clone/", limit: 1000 })
    for (const { value } of stored.entries) clones.set(`${value.providerID}/${value.id}`, value)

    // A clone must be taken from the base *after* every other transform (boxedcode-config's caps, cost, names)
    // has run, and transforms replay in registration order. So register once now, so sessions keep working
    // straight after a restart, and again once startup has settled so this one is last.
    let transform
    const register = async () => {
      const previous = transform
      transform = await ctx.model.transform((editor) => {
        for (const { providerID, id } of clones.values()) {
          const parsed = parseClone(id)
          const base = parsed && editor.get(providerID, parsed.baseID)
          if (!base) continue
          const source = JSON.parse(JSON.stringify(base))
          editor.update(providerID, id, (draft) => {
            Object.assign(draft, source, {
              id,
              name: `${source.name} · ${kb(parsed.context)} ctx`,
              limit: overrideLimit(source.limit, parsed.context),
            })
          })
        }
      })
      await previous?.dispose()
    }
    await register()
    const settle = setTimeout(() => void register().then(() => ctx.model.reload()).catch(console.error), 3000)
    const registrations = [{ dispose: () => transform.dispose() }]

    const switchTo = async (sessionID, ref, id) => {
      if (ref.id === id) return
      await ctx.session.switchModel({
        sessionID,
        model: { providerID: ref.providerID, id, ...(ref.variant ? { variant: ref.variant } : {}) },
      })
    }

    // Which sessions currently have an override. The TUI sends its own selected model with every prompt and knows
    // nothing about the derived models, so it can silently put a session back on the base model; the prompt hook
    // below undoes that. Persisted so it survives a restart.
    const active = new Map()
    for (const { value } of (await ctx.storage.scan({ prefix: "session/", limit: 1000 })).entries) active.set(value.sessionID, value)
    const track = async (sessionID, entry) => {
      if (entry) {
        active.set(sessionID, entry)
        await ctx.storage.set(`session/${sessionID}`, entry)
      } else if (active.delete(sessionID)) await ctx.storage.remove(`session/${sessionID}`)
    }

    registrations.push(
      await ctx.rpc.register(ContextOverride, {
        set: async ({ sessionID, context }) => {
          const session = unwrap(await ctx.session.get({ sessionID }))
          const ref = session?.model
          if (!ref) throw new Error("Session has no model yet; send a message first.")
          const baseID = parseClone(ref.id)?.baseID ?? ref.id
          const target = context ? cloneID(baseID, context) : baseID
          const key = `${ref.providerID}/${target}`
          if (context && !clones.has(key)) {
            const entry = { providerID: ref.providerID, id: target }
            await ctx.storage.set(`clone/${key}`, entry)
            clones.set(key, entry)
            await register()
            await ctx.model.reload()
          }
          await track(sessionID, context ? { sessionID, providerID: ref.providerID, id: target, baseID } : undefined)
          await switchTo(sessionID, ref, target)
          return { id: target }
        },
      }),
    )

    registrations.push(
      await ctx.session.hook("prompt", async ({ sessionID }) => {
        const want = active.get(sessionID)
        if (!want) return
        try {
          const ref = unwrap(await ctx.session.get({ sessionID }))?.model
          if (!ref || ref.id === want.id) return
          // Back on the base model = the TUI re-sent its selection; anything else = the user chose another model.
          if (ref.providerID === want.providerID && ref.id === want.baseID) await switchTo(sessionID, ref, want.id)
          else await track(sessionID, undefined)
        } catch (error) {
          console.error("context-override: keeping override on prompt failed", error)
        }
      }),
    )

    // Temporary: once a session compacts, the extra headroom is no longer needed, so drop back to the base model.
    const abort = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        const sessionID = event.type === "session.compaction.ended" ? event.data?.sessionID : undefined
        if (!sessionID) continue
        try {
          await track(sessionID, undefined)
          const session = unwrap(await ctx.session.get({ sessionID }))
          const parsed = parseClone(session?.model?.id)
          if (parsed) await switchTo(sessionID, session.model, parsed.baseID)
        } catch (error) {
          console.error("context-override: revert after compaction failed", error)
        }
      }
    })().catch((error) => {
      if (!abort.signal.aborted) console.error("context-override: event loop stopped", error)
    })

    return async () => {
      clearTimeout(settle)
      abort.abort()
      await Promise.all(registrations.map((registration) => registration.dispose()))
    }
  },
}
