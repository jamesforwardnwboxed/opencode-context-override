// Per-session context window override, shared by the server (index.js) and TUI (tui.tsx).
//
// A session can't carry its own limit: compaction and the sidebar both read the limit from the model
// catalog entry the session uses. So an override is a derived catalog entry, "<base>~ctx<tokens>", with the
// same API model and a different limit, and the session is switched onto it. Everything is recoverable from
// the id alone, so no per-session state needs storing.

export const cloneID = (baseID, context) => `${baseID}~ctx${context}`

export const parseClone = (id) => {
  const match = /^(.+)~ctx(\d+)$/.exec(id ?? "")
  return match ? { baseID: match[1], context: Number(match[2]) } : undefined
}

// "600000", "600,000", "600k", "1.2m" -> integer tokens, or undefined if unusable.
export const parseTokens = (text) => {
  const match = /^\s*(\d[\d,]*(?:\.\d+)?)\s*([km]?)\s*$/i.exec(text ?? "")
  if (!match) return undefined
  const scale = { "": 1, k: 1e3, m: 1e6 }[match[2].toLowerCase()]
  const value = Math.round(Number(match[1].replaceAll(",", "")) * scale)
  return value >= 10_000 && value <= 10_000_000 ? value : undefined
}

// The typed number is the window. Compaction triggers off `input || context` minus a 10% buffer, so dropping
// `input` makes it fire at ~90% of the number typed (the sidebar % is measured against context too).
export const overrideLimit = (limit, context) => {
  const { input, ...rest } = limit
  return { ...rest, context }
}

export const ContextOverride = {
  id: "context-override",
  methods: {
    set: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, context: { type: "integer" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  events: {},
}
