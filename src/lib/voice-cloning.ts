export const CLONE_COST = 150;
export const MAX_CLONE_BYTES = 3 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

export function enforceCloneWindow(createdAt: string[], now: number) {
  const recent = createdAt.map(Date.parse).filter((at) => at > now - DAY_MS).sort((a, b) => a - b);
  if (recent.length < 5) return;
  const hours = Math.max(1, Math.ceil((recent[recent.length - 5] + DAY_MS - now) / 3_600_000));
  throw new Error(`You've used your 5 clones for today — you can clone again in about ${hours}h.`);
}

/** Serialized by a database operation lease at the authenticated caller. */
export async function createReplacement(deps: {
  createdAt: string[]; now: number;
  charge: () => Promise<boolean>;
  ownedVoiceIds: () => Promise<string[]>;
  deleteOwned: (id: string) => Promise<void>;
  create: () => Promise<string>;
  record: (id: string) => Promise<void>;
  refund: () => Promise<void>;
}) {
  enforceCloneWindow(deps.createdAt, deps.now);
  const oldIds = await deps.ownedVoiceIds();
  if (!(await deps.charge())) throw new Error(`Voice cloning costs ${CLONE_COST} credits and your balance is too low. Top up your wallet to continue.`);
  let deleted = false;
  let newId: string | undefined;
  try {
    for (const id of oldIds) {
      await deps.deleteOwned(id);
      deleted = true;
    }
    newId = await deps.create();
    if (!newId) throw new Error("Voice cloning returned no voice.");
    await deps.record(newId);
    return newId;
  } catch (error) {
    if (newId) await deps.deleteOwned(newId).catch(() => undefined);
    await deps.refund();
    if (deleted) throw new Error("Your old voice was deleted, but the new voice couldn't be created. Your 150 credits were refunded and your custom voice slot is empty. Please try again.");
    throw error;
  }
}