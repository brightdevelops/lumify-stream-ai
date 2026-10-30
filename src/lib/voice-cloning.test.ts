import { describe, expect, it, vi } from "vitest";
import { CLONE_COST, MAX_CLONE_BYTES, createReplacement, enforceCloneWindow } from "./voice-cloning";

const now = Date.parse("2026-10-30T07:09:00Z");
const hour = 3_600_000;
const rows = (ages: number[]) => ages.map((age) => new Date(now - age * hour).toISOString());
function setup(createdAt: string[] = []) {
  let balance = 1000;
  const voices = new Set(["old-owned-voice"]);
  const recorded: string[] = [];
  let next = 0;
  const order: string[] = [];
  const deps = {
    createdAt, now,
    ownedVoiceIds: vi.fn(async () => [...voices]),
    charge: vi.fn(async () => { if (balance < CLONE_COST) return false; balance -= CLONE_COST; return true; }),
    deleteOwned: vi.fn(async (id: string) => { if (!voices.has(id)) throw new Error("Not owned"); voices.delete(id); order.push("delete"); }),
    create: vi.fn(async () => { const id = `new-${++next}`; voices.add(id); order.push("create"); return id; }),
    record: vi.fn(async (id: string) => { recorded.push(id); createdAt.push(new Date(now).toISOString()); }),
    refund: vi.fn(async () => { balance += CLONE_COST; }),
  };
  return { deps, voices, recorded, order, balance: () => balance, setBalance: (n: number) => { balance = n; } };
}
describe("voice cloning rules", () => {
  it("charges 150 per replacement and leaves only the new active voice, deleting first", async () => {
    const s = setup();
    const first = await createReplacement(s.deps);
    expect([...s.voices]).toEqual([first]);
    expect(s.balance()).toBe(850);
    const second = await createReplacement(s.deps);
    expect([...s.voices]).toEqual([second]);
    expect(s.balance()).toBe(700);
    expect(s.recorded).toEqual([first, second]);
    expect(s.order).toEqual(["delete", "create", "delete", "create"]);
  });
  it("refusal charges nothing: creation six is refused before charging or deleting", async () => {
    const s = setup(rows([23, 20, 10, 5, 1]));
    await expect(createReplacement(s.deps)).rejects.toThrow("You've used your 5 voice clones for today — you can clone again in about 1h.");
    expect(s.balance()).toBe(1000);
    expect(s.deps.charge).not.toHaveBeenCalled();
    expect(s.deps.refund).not.toHaveBeenCalled();
    expect(s.deps.deleteOwned).not.toHaveBeenCalled();
    expect(s.deps.create).not.toHaveBeenCalled();
  });
  it("first clone of the day succeeds and charges exactly 150", async () => {
    const s = setup();
    await createReplacement(s.deps);
    expect(s.balance()).toBe(850);
    expect(s.deps.charge).toHaveBeenCalledTimes(1);
  });
  it("allows five successful clones in 24h and refuses only the sixth", async () => {
    const s = setup([]);
    for (let i = 0; i < 5; i++) await createReplacement(s.deps);
    expect(s.balance()).toBe(250);
    await expect(createReplacement(s.deps)).rejects.toThrow("5 voice clones");
    expect(s.balance()).toBe(250);
    expect(s.deps.charge).toHaveBeenCalledTimes(5);
  });
  it("refunded failures do not count toward the limit", async () => {
    const s = setup(rows([3, 2, 1, 0.5]));
    s.deps.create.mockRejectedValueOnce(new Error("Provider failed"));
    await expect(createReplacement(s.deps)).rejects.toThrow();
    await createReplacement(s.deps);
    expect(s.balance()).toBe(850);
  });
  it("ignores rows older than 24 hours", () => {
    expect(() => enforceCloneWindow(rows([30, 25, 24.1, 48, 72, 1]), now)).not.toThrow();
  });
  it("frees capacity exactly when a successful attempt reaches 24 hours", () => {
    const attempts = rows([24, 20, 10, 5, 1]);
    expect(() => enforceCloneWindow(attempts, now - 1)).toThrow();
    expect(() => enforceCloneWindow(attempts, now)).not.toThrow();
  });
  it("refunds provider create failure after deletion, leaving an empty slot and no successful row", async () => {
    const s = setup();
    s.deps.create.mockRejectedValue(new Error("Provider failed"));
    await expect(createReplacement(s.deps)).rejects.toThrow("slot is empty. Please try again.");
    expect(s.balance()).toBe(1000);
    expect(s.voices.size).toBe(0);
    expect(s.recorded).toEqual([]);
  });
  it("refunds a failed ownership-checked delete without creating a new voice", async () => {
    const s = setup();
    s.deps.deleteOwned.mockRejectedValue(new Error("Not owned"));
    await expect(createReplacement(s.deps)).rejects.toThrow("Not owned");
    expect(s.deps.create).not.toHaveBeenCalled();
    expect(s.balance()).toBe(1000);
    expect([...s.voices]).toEqual(["old-owned-voice"]);
  });
  it("insufficient balance never deletes the current voice or creates another", async () => {
    const s = setup(); s.setBalance(149);
    await expect(createReplacement(s.deps)).rejects.toThrow("balance is too low");
    expect(s.balance()).toBe(149);
    expect(s.deps.deleteOwned).not.toHaveBeenCalled();
    expect(s.deps.create).not.toHaveBeenCalled();
  });
  it("keeps the 3 MB upload cap and 150-credit price", () => {
    expect(MAX_CLONE_BYTES).toBe(3 * 1024 * 1024);
    expect(CLONE_COST).toBe(150);
  });
});