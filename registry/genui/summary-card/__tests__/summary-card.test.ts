import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { toJSONSchema } from "zod"

import { summaryCardSchema, summaryIcons } from "../summary-card.schema"

const card = (icon: string) => ({
  title: "Q3 at a glance",
  facts: [
    { label: "Revenue", value: "$4.6M", icon: "wallet" },
    { label: "Net retention", value: "108%", icon },
  ],
})

describe("summaryCardSchema", () => {
  it("keeps a listed icon", () => {
    const parsed = summaryCardSchema.parse(card("trending-up"))
    assert.equal(parsed.facts[1].icon, "trending-up")
  })

  it("drops an icon outside the list instead of failing the card", () => {
    const result = summaryCardSchema.safeParse(card("rocket"))
    assert.ok(result.success)
    assert.equal(result.data.facts[0].icon, "wallet")
    assert.equal(result.data.facts[1].icon, undefined)
  })

  it("still lists the icon names in the tool's JSON schema", () => {
    const json = JSON.stringify(toJSONSchema(summaryCardSchema))
    for (const name of summaryIcons) assert.ok(json.includes(`"${name}"`), name)
  })
})
