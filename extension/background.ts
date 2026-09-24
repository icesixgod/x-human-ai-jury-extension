import { AppError, DEFAULT_MODEL, RULE_VERSION, messages, reviewId, reviewStateSchema, snapshotSchema, tally as makeTally, type Analysis, type ReviewState, type Snapshot, type Vote } from '../shared/contracts';
import { callJev } from '../shared/jev';
import { acknowledge, emptyState, enqueue, trimCache, type LocalState } from './state';
import { contentMessage, contentSender, settingsMessage, settingsSender } from './messages';

declare const __API_ORIGIN__: string;
const API = __API_ORIGIN__;
const init = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
})();
let serial: Promise<unknown> = init;
function lock<T>(work: () => Promise<T>): Promise<T> { const result = serial.then(work); serial = result.catch(() => undefined); return result; }
function communityState(input: unknown): ReviewState {
  const result = reviewStateSchema.safeParse(input);
  if (!result.success) throw new AppError('unavailable', 503);
  const raw = result.data;
  // Strip legacy remote model fields on both network and persisted-cache reads.
  const { id, snapshot, tally, contentSource, createdAt, updatedAt, conflict } = raw.review;
  return { review: { id, snapshot, tally: makeTally(tally.human, tally.ai, tally.uncertain ?? 0), contentSource, createdAt, updatedAt, conflict },
    myVote: raw.myVote, sequence: raw.sequence, published: raw.published };
}
async function load(): Promise<LocalState> {
  const saved = (await chrome.storage.local.get('state')).state as LocalState | undefined;
  if (saved) {
    const cache = trimCache(saved.cache);
    for (const entry of Object.values(cache)) {
      if (entry.state) {
        try { entry.state = communityState(entry.state); } catch { entry.state = undefined; }
      }
      if (entry.analysis?.source !== 'client_byok') entry.analysis = undefined;
    }
    return { ...saved, cache };
  }
  const state = emptyState(); await save(state); return state;
}
async function save(state: LocalState) { await chrome.storage.local.set({ state: { ...state, cache: trimCache(state.cache) } }); }
async function getKey() {
  const session = (await chrome.storage.session.get('key')).key;
  const local = (await chrome.storage.local.get('key')).key;
  return typeof session === 'string' && session ? session : typeof local === 'string' ? local : '';
}
async function request(path: string, token: string, payload: Snapshot | { snapshot: Snapshot; vote: Vote | null; sequence: number }, method = 'POST', timeout = 20000): Promise<ReviewState> {
  // `path` is constructed in this module; callers cannot supply destinations.
  let response: Response;
  try { response = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload),
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(timeout) }); }
  catch { throw new AppError('unavailable', 503); }
  const raw = await response.json().catch(() => null) as ReviewState & { error?: string } | null;
  if (!response.ok || !raw) throw new AppError(raw?.error && Object.hasOwn(messages, raw.error) ? raw.error : 'unavailable', response.status);
  const state = communityState(raw);
  const sentSnapshot = 'snapshot' in payload ? payload.snapshot : payload;
  if (state.review.id !== await reviewId(sentSnapshot) || state.review.id !== await reviewId(state.review.snapshot)) throw new AppError('unavailable', 503);
  return state;
}
async function byok(snapshot: Snapshot) {
  const key = await getKey();
  if (!key) throw new AppError('personal_key_required');
  if (!await chrome.permissions.contains({ origins: ['https://api.typesafe.ai/*'] })) throw new AppError('permission');
  return callJev(snapshot, key);
}
function ensureEnabled(state: LocalState) { if (!state.enabled || !state.consent) throw new AppError('disabled'); }
async function storeResult(id: string, remote?: ReviewState, analysis?: Analysis) {
  return lock(async () => {
    const current = await load();
    const prior = current.cache[id];
    // Network requests may finish after a newer vote or community response.
    if (prior?.state && (!remote || prior.state.sequence > remote.sequence ||
      prior.state.sequence === remote.sequence && prior.state.review.updatedAt > remote.review.updatedAt)) remote = prior.state;
    current.sequence = Math.max(current.sequence, remote?.sequence ?? 0);
    const personal = prior?.analysis?.source === 'client_byok' && prior.analysis.model === DEFAULT_MODEL && prior.analysis.ruleVersion === RULE_VERSION ? prior.analysis : undefined;
    current.cache[id] = { state: remote, analysis: analysis ?? personal, at: Date.now() };
    await save(current);
    return { id, state: remote, pending: current.queue[id] ?? null, sequence: current.sequence };
  });
}
const analyses = new Map<string, Promise<unknown>>();
async function evaluate(snapshot: Snapshot) {
  const id = await reviewId(snapshot);
  const existing = analyses.get(id);
  if (existing) return existing;
  if (analyses.size >= 4) throw new AppError('busy', 429);
  const job = evaluateModel(snapshot, id).finally(() => analyses.delete(id));
  analyses.set(id, job);
  return job;
}
async function evaluateModel(snapshot: Snapshot, id: string) {
  const state = await lock(async () => { const state = await load(); ensureEnabled(state); return state; });
  const cached = state.cache[id];
  if (cached?.analysis && (cached.analysis.ruleVersion !== RULE_VERSION || cached.analysis.model !== DEFAULT_MODEL)) cached.analysis = undefined;
  let analysis: Analysis | undefined, error: string | undefined;
  // Community statistics use their own message and never hold up the model result.
  try { analysis = cached?.analysis ?? await byok(snapshot); }
  catch (e) { error = e instanceof AppError ? e.code : 'upstream_unavailable'; }
  return { ...await storeResult(id, undefined, analysis), analysis, error };
}
const statistics = new Map<string, Promise<unknown>>();
async function community(snapshot: Snapshot) {
  const id = await reviewId(snapshot);
  const existing = statistics.get(id);
  if (existing) return existing;
  if (statistics.size >= 8) throw new AppError('busy', 429);
  const job = (async () => {
    const state = await lock(async () => { const state = await load(); ensureEnabled(state); return state; });
    let remote: ReviewState | undefined, communityError: string | undefined;
    try { remote = await request('/api/v1/community', state.token, snapshot, 'POST', 4000); }
    catch (e) { communityError = e instanceof AppError ? e.code : 'unavailable'; }
    return { ...await storeResult(id, remote), communityError };
  })().finally(() => statistics.delete(id));
  statistics.set(id, job);
  return job;
}
const syncing = new Map<string, Promise<void>>();
async function syncOne(id: string) {
  const existing = syncing.get(id);
  if (existing) return existing;
  const job = syncPending(id).finally(() => syncing.delete(id));
  syncing.set(id, job);
  return job;
}
async function syncPending(id: string) {
  const state = await lock(load), pending = state.queue[id];
  if (!pending || !state.enabled || !state.consent) return;
  try {
    const { snapshot, vote, sequence } = pending;
    const remote = await request(`/api/v1/votes/${snapshot.comment.id}`, state.token, { snapshot, vote, sequence }, vote === null ? 'DELETE' : 'PUT', 5000);
    await lock(async () => {
      let current = acknowledge(await load(), id, sequence);
      current.sequence = Math.max(current.sequence, remote.sequence);
      const previous = current.cache[id];
      const newer = previous?.state && previous.state.sequence > remote.sequence ? previous.state : remote;
      const personal = previous?.analysis?.source === 'client_byok' ? previous.analysis : undefined;
      current.cache[id] = { state: newer, analysis: personal, at: Date.now() };
      await save(current);
    });
  } catch (e) {
    const error = e instanceof AppError ? e.code : 'unavailable';
    await lock(async () => {
      const current = await load();
      if (current.queue[id]?.sequence === pending.sequence) {
        current.queue[id] = { ...pending, error, blocked: e instanceof AppError && [400,401,403,410,413,415,422].includes(e.status) };
        await save(current);
      }
    });
  }
}
async function vote(snapshot: Snapshot, choice: Vote | null) {
  const id = await reviewId(snapshot);
  await lock(async () => {
    let state = await load(); ensureEnabled(state);
    const sequence = Math.max(state.sequence + 1, Date.now() * 1000);
    state = enqueue(state, { id, snapshot, vote: choice, sequence });
    // Persist intent before network I/O, without holding the storage lock online.
    await save(state);
  });
  await syncOne(id);
  return lock(async () => {
    const state = await load();
    return { id, state: state.cache[id]?.state, analysis: state.cache[id]?.analysis, pending: state.queue[id] ?? null, sequence: state.sequence };
  });
}
async function syncQueue(manual = false) {
  let state = await lock(load);
  if (!state.consent || !state.enabled) return;
  for (const id of Object.keys(state.queue)) {
    if (!state.queue[id]) continue;
    if (state.queue[id].blocked && !manual) continue;
    await syncOne(id); state = await lock(load);
    if (state.queue[id] && !state.queue[id].blocked) break;
  }
}
async function dispatch(raw: unknown, sender: chrome.runtime.MessageSender) {
  if (settingsSender(sender, chrome.runtime.id)) {
    const message = settingsMessage.parse(raw);
    if (message.type === 'sync') await syncQueue(true);
    return lock(async () => {
    let state = await load();
    if (message.type === 'save') {
      if (message.enabled && !message.consent) throw new AppError('disabled');
      state = { ...state, enabled: message.enabled, consent: message.consent, rememberKey: message.rememberKey };
      const previousKey = await getKey();
      const key = message.key?.trim() || previousKey;
      await chrome.storage.local.remove('key'); await chrome.storage.session.remove('key');
      if (key) await (message.rememberKey ? chrome.storage.local : chrome.storage.session).set({ key });
      await save(state);
    }
    if (message.type === 'clear_key') { await chrome.storage.local.remove('key'); await chrome.storage.session.remove('key'); }
    return { enabled: state.enabled, consent: state.consent, rememberKey: state.rememberKey, hasKey: !!await getKey(), api: API,
      queue: Object.values(state.queue).map(p => ({ id: p.id, commentId: p.snapshot.comment.id, vote: p.vote, error: p.error, blocked: p.blocked })) };
    });
  }
  if (!contentSender(sender, chrome.runtime.id)) throw new AppError('unauthorized', 403);
  const message = contentMessage.parse(raw);
  if (message.type === 'open_options') { await chrome.runtime.openOptionsPage(); return {}; }
  if (message.type === 'enabled') { const state = await lock(load); return { enabled: state.enabled && state.consent }; }
  // Validate again on the trusted side; content-script data is never trusted.
  const snapshot = snapshotSchema.parse(message.snapshot);
  return message.type === 'analyze' ? evaluate(snapshot) : message.type === 'community' ? community(snapshot) : vote(snapshot, message.vote);
}
chrome.runtime.onMessage.addListener((raw, sender, respond) => {
  // Status reads must not wait behind slow network operations while X mutates its DOM.
  const readOnly = contentSender(sender, chrome.runtime.id) && contentMessage.safeParse(raw).success && (raw as {type:string}).type === 'enabled';
  const job = readOnly ? init.then(async () => {
    const state = (await chrome.storage.local.get('state')).state as LocalState | undefined;
    return { enabled: !!(state?.enabled && state?.consent) };
  }) : init.then(() => dispatch(raw, sender));
  job.then(data => respond({ ok: true, data })).catch(e => respond({ ok: false, error: e instanceof AppError ? e.code : e instanceof Error && e.message === 'queue_full' ? 'queue_full' : 'invalid' }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'sync') void syncQueue(); });
chrome.runtime.onStartup.addListener(() => { void syncQueue(); });
chrome.runtime.onInstalled.addListener(details => {
  void chrome.alarms.create('sync', { periodInMinutes: 2 });
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});
chrome.action.onClicked.addListener(() => { void chrome.runtime.openOptionsPage(); });
