import type { Analysis, ReviewState, Snapshot, Vote } from '../shared/contracts';
export type PendingVote = { id: string; snapshot: Snapshot; vote: Vote | null; sequence: number; error?: string; blocked?: boolean };
export type CachedState = { state?: ReviewState; analysis?: Analysis; at: number };
export type LocalState = {
  token: string; enabled: boolean; consent: boolean; rememberKey: boolean; sequence: number;
  queue: Record<string, PendingVote>; cache: Record<string, CachedState>;
};
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join(''); }
export function emptyState(): LocalState { return { token: randomToken(), enabled: false, consent: false, rememberKey: false, sequence: 0, queue: {}, cache: {} }; }
export function enqueue(state: LocalState, operation: PendingVote): LocalState {
  const queue = { ...state.queue, [operation.id]: operation };
  if (Object.keys(queue).length > 100 || new TextEncoder().encode(JSON.stringify(queue)).length > 4 * 1024 * 1024) throw new Error('queue_full');
  return { ...state, sequence: Math.max(state.sequence, operation.sequence), queue };
}
export function acknowledge(state: LocalState, id: string, sequence: number): LocalState {
  if (state.queue[id]?.sequence !== sequence) return state;
  const queue = { ...state.queue }; delete queue[id]; return { ...state, queue };
}
export function trimCache(cache: LocalState['cache']) {
  let bytes = 0;
  return Object.fromEntries(Object.entries(cache).filter(([,v]) => v.at > Date.now() - 86400000).sort((a,b) => b[1].at - a[1].at).slice(0, 60).filter(entry => {
    bytes += new TextEncoder().encode(JSON.stringify(entry)).length;
    return bytes <= 2 * 1024 * 1024;
  }));
}
