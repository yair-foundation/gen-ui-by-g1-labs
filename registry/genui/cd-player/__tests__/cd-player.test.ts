import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  isReadyAlbum,
  letteringLines,
  letteringSize,
  playerAnnouncement,
  rackColumns,
  safeAudioUrl,
  safeImageUrl,
  stateFromResult,
} from "../cd-player-utils"
import { cdPlayerSchema, cdPlayerTool } from "../cd-player.schema"

const albums = [
  {
    id: "gold-hour",
    title: "Gold Hour",
    artist: "Velvet Static",
    artwork: { src: "/gen/cd-player/gold-hour.svg", alt: "Cover of Gold Hour" },
    previewUrl: "https://music.example/p/gold-hour.mp3",
  },
  { id: "table-for-six", title: "Table for Six", artist: "Harbour Lights" },
]

describe("isReadyAlbum", () => {
  it("needs an id, a title and an artist", () => {
    assert.equal(isReadyAlbum(albums[1]), true)
    assert.equal(isReadyAlbum({ id: "a", title: "A" }), false)
    assert.equal(isReadyAlbum({ id: "", title: "A", artist: "B" }), false)
    assert.equal(isReadyAlbum({ title: "A", artist: "B" }), false)
    assert.equal(isReadyAlbum(undefined), false)
  })
})

describe("rackColumns", () => {
  it("never leaves one disc alone on a row", () => {
    for (let n = 2; n <= 8; n++) {
      const cols = rackColumns(n)
      const lastRow = n % cols || cols
      assert.ok(n <= cols || lastRow >= 2, `${n} discs in ${cols} columns`)
      assert.ok(cols <= 4)
    }
  })

  it("keeps up to four on one row", () => {
    assert.equal(rackColumns(2), 2)
    assert.equal(rackColumns(4), 4)
    assert.equal(rackColumns(6), 3)
    assert.equal(rackColumns(7), 4)
  })

  it("has at least one column while nothing has streamed", () => {
    assert.equal(rackColumns(0), 1)
  })
})

describe("letteringLines", () => {
  it("splits a name into two even lines around the hub", () => {
    assert.deepEqual(letteringLines("Velvet Static"), ["Velvet", "Static"])
    assert.deepEqual(letteringLines("Sola and the Tides"), [
      "Sola and",
      "the Tides",
    ])
    assert.deepEqual(letteringLines("The Ember Club"), ["The Ember", "Club"])
  })

  it("keeps one word above the hub alone", () => {
    assert.deepEqual(letteringLines("Northbound"), ["Northbound", ""])
    assert.deepEqual(letteringLines("  "), ["", ""])
  })
})

describe("letteringSize", () => {
  it("writes short names at full size and shrinks long ones", () => {
    assert.equal(letteringSize(["Velvet", "Static"]), 15)
    assert.equal(letteringSize(["Northbound", ""]), 15)
    assert.equal(letteringSize(["Harbour", "Lights and Friends"]), 8.3)
    assert.equal(letteringSize(["x".repeat(80), ""]), 6)
  })
})

describe("playerAnnouncement", () => {
  it("says what is on and whether it is paused", () => {
    assert.equal(
      playerAnnouncement(albums[0], false),
      "Playing Gold Hour by Velvet Static",
    )
    assert.equal(
      playerAnnouncement(albums[0], true),
      "Paused Gold Hour by Velvet Static",
    )
    assert.equal(playerAnnouncement(undefined, false), "The player is empty")
  })
})

describe("stateFromResult", () => {
  const ids = albums.map((a) => a.id)

  it("puts the disc from history back in", () => {
    assert.deepEqual(
      stateFromResult({ action: "play", albumId: "gold-hour" }, ids),
      {
        albumId: "gold-hour",
        paused: false,
      },
    )
    assert.deepEqual(
      stateFromResult({ action: "pause", albumId: "gold-hour" }, ids),
      {
        albumId: "gold-hour",
        paused: true,
      },
    )
  })

  it("leaves the player empty without a result or for an unknown album", () => {
    assert.deepEqual(stateFromResult(undefined, ids), {
      albumId: null,
      paused: false,
    })
    assert.deepEqual(
      stateFromResult({ action: "play", albumId: "gone" }, ids),
      {
        albumId: null,
        paused: false,
      },
    )
  })
})

describe("URL guards", () => {
  it("lets artwork load from http(s), same-origin paths and data:image", () => {
    assert.equal(
      safeImageUrl("/gen/cd-player/linen.svg"),
      "/gen/cd-player/linen.svg",
    )
    assert.equal(
      safeImageUrl("https://music.example/a.jpg"),
      "https://music.example/a.jpg",
    )
    assert.equal(
      safeImageUrl("data:image/png;base64,AAAA"),
      "data:image/png;base64,AAAA",
    )
    assert.equal(safeImageUrl("//evil.example/a.jpg"), null)
    assert.equal(safeImageUrl("javascript:alert(1)"), null)
    assert.equal(safeImageUrl("data:text/html,hi"), null)
  })

  it("lets previews load from http(s), blob: and data:audio", () => {
    assert.equal(
      safeAudioUrl("blob:https://site.example/1"),
      "blob:https://site.example/1",
    )
    assert.equal(
      safeAudioUrl("data:audio/wav;base64,AAAA"),
      "data:audio/wav;base64,AAAA",
    )
    assert.equal(
      safeAudioUrl("https://music.example/p.mp3"),
      "https://music.example/p.mp3",
    )
    assert.equal(safeAudioUrl("synth:mid:4"), null)
    assert.equal(safeAudioUrl("data:image/png;base64,AAAA"), null)
    assert.equal(safeAudioUrl(undefined), null)
  })
})

describe("cdPlayerSchema", () => {
  it("accepts the demo's shapes", () => {
    assert.equal(cdPlayerSchema.safeParse({ albums }).success, true)
    assert.equal(
      cdPlayerSchema.safeParse({
        title: "Something to cook to",
        nowPlayingId: "gold-hour",
        albums,
      }).success,
      true,
    )
  })

  it("needs 2–8 albums", () => {
    assert.equal(
      cdPlayerSchema.safeParse({ albums: [albums[0]] }).success,
      false,
    )
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...albums[1],
      id: `a${i}`,
    }))
    assert.equal(cdPlayerSchema.safeParse({ albums: many }).success, false)
  })

  it("names the music player as the neighbour in its tool description", () => {
    assert.match(cdPlayerTool.description, /music player/)
    assert.equal(cdPlayerTool.name, "show_cd_player")
  })
})
