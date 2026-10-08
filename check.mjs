import assert from "node:assert/strict"
import { cloneID, overrideLimit, parseClone, parseTokens } from "./shared.js"

assert.equal(parseTokens("600000"), 600000)
assert.equal(parseTokens("600,000"), 600000)
assert.equal(parseTokens(" 600k "), 600000)
assert.equal(parseTokens("1.2M"), 1200000)
assert.equal(parseTokens("abc"), undefined)
assert.equal(parseTokens("5"), undefined)
assert.equal(parseTokens("99m"), undefined)

assert.deepEqual(parseClone(cloneID("claude-sonnet-5.5", 600000)), { baseID: "claude-sonnet-5.5", context: 600000 })
assert.deepEqual(parseClone(cloneID("a/b:c~ctx1", 500000)), { baseID: "a/b:c~ctx1", context: 500000 })
assert.equal(parseClone("claude-sonnet-5.5"), undefined)

// input is dropped so compaction (input || context, minus 10%) lands at 90% of the typed window
assert.deepEqual(overrideLimit({ context: 464000, input: 336000, output: 128000 }, 400000), {
  context: 400000,
  output: 128000,
})
// no input limit -> only context moves
assert.deepEqual(overrideLimit({ context: 200000, output: 32000 }, 300000), { context: 300000, output: 32000 })
console.log("ok")
