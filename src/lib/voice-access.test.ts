import { describe, expect, it, vi } from "vitest";
import { canDelete, canUse, createRawVoiceCache, ownerDescription, ownerOf, type RawVoice } from "./voice-access";

const owner = "357a21de-1341-47c1-a2e4-cc6af78b0ffb";
const other = "9fa39297-8035-41d9-9f4c-7e69cf631914";
const clone = (id: string): RawVoice => ({ voice_id: id, category: "cloned", description: ownerDescription(owner) });

describe("clone ownership", () => {
  it("reads the affected clone's exact owner tag as the requesting UUID", () => {
    expect(ownerOf({ voice_id: "id9XP4jzO4K5Bb3T2RE5", description: "lumify-owner:357a21de-1341-47c1-a2e4-cc6af78b0ffb" })).toBe(owner);
  });
  for (const path of ["preview", "TTS", "live convert"]) {
    it(`allows owner ${path} immediately after creation and replacement; denies another user`, async () => {
      let raw = [clone("first")];
      const cache = createRawVoiceCache(async () => raw);
      for (const id of ["first", "replacement"]) {
        if (id === "replacement") { raw = [clone(id)]; cache.invalidate(); }
        const voices = await cache.get();
        const voice = voices.find((v) => v.voice_id === id);
        expect(canUse(voice, owner)).toBe(true);
        expect(canUse(voice, other)).toBe(false);
        expect(voices.filter((v) => ownerOf(v) === other)).toEqual([]);
        if (id === "replacement") expect(canUse(voices.find((v) => v.voice_id === "first"), owner)).toBe(false);
      }
    });
  }
  it("only permits the owner to delete a clone", () => {
    expect(canDelete(clone("first"), owner)).toBe(true);
    expect(canDelete(clone("first"), other)).toBe(false);
    expect(canDelete({ voice_id: "public", category: "premade" }, owner)).toBe(false);
  });
  it("fails closed for missing voices, untagged clones, and malformed tags", () => {
    expect(canUse(undefined, owner)).toBe(false);
    expect(canUse({ voice_id: "private", category: "cloned" }, owner)).toBe(false);
    expect(canUse({ voice_id: "malformed", description: "lumify-owner:" }, owner)).toBe(false);
    expect(canUse({ voice_id: "public", category: "premade" }, owner)).toBe(true);
  });
  it("normalizes tag whitespace and UUID case without accepting email as ownership", () => {
    const v = { voice_id: "voice", description: `note lumify-owner:  ${owner.toUpperCase()}\nextra` };
    expect(ownerOf(v)).toBe(owner);
    expect(canUse(v, owner)).toBe(true);
    expect(canUse(v, "brightsolutionslab@gmail.com")).toBe(false);
  });
});

describe("raw voice cache", () => {
  it("retains descriptions and never caches per-user filtered lists", async () => {
    const raw = [clone("first"), { voice_id: "other", category: "cloned", description: ownerDescription(other) }];
    const load = vi.fn(async () => raw);
    const cache = createRawVoiceCache(load);
    expect((await cache.get()).filter((v) => ownerOf(v) === owner).map((v) => v.voice_id)).toEqual(["first"]);
    expect((await cache.get()).filter((v) => ownerOf(v) === other).map((v) => v.voice_id)).toEqual(["other"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect((await cache.get())[0]?.description).toBe(ownerDescription(owner));
  });
  it("expires after 60 seconds and supports fresh authorization reads", async () => {
    let now = 0;
    const load = vi.fn(async () => [clone("first")]);
    const cache = createRawVoiceCache(load, () => now);
    await cache.get(); now = 59_999; await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
    now = 60_000; await cache.get(); await cache.get(true);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("cannot repopulate stale metadata when invalidated during an in-flight load", async () => {
    let resolve: ((v: RawVoice[]) => void) | undefined;
    const load = vi.fn().mockImplementationOnce(() => new Promise<RawVoice[]>((r) => { resolve = r; })).mockResolvedValue([clone("replacement")]);
    const cache = createRawVoiceCache(load);
    const pending = cache.get(); cache.invalidate(); resolve?.([clone("old")]);
    expect((await pending).map((v) => v.voice_id)).toEqual(["replacement"]);
    expect((await cache.get()).map((v) => v.voice_id)).toEqual(["replacement"]);
  });
});