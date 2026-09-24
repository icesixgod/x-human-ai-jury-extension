import { messages, type Analysis, type ReviewState, type Snapshot, type Vote } from '../shared/contracts';
import { collectReplies, statusId, timestampAnchor } from './dom';
import type { PendingVote } from './state';

type Result = { state?: ReviewState; analysis?: Analysis; error?: string; communityError?: string; pending?: PendingVote | null; sequence?: number };
async function send(message: unknown): Promise<any> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'unavailable');
  return response.data;
}
const styles = `:host{display:inline-flex;vertical-align:middle;color:inherit;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;flex:0 0 auto;white-space:nowrap;margin-inline-start:6px;position:relative}*{box-sizing:border-box}.jury{display:flex;gap:3px;align-items:center;flex-wrap:nowrap;justify-content:flex-start;white-space:nowrap}button{font:inherit;color:inherit;background:transparent;border:0;border-radius:6px;min-height:30px;cursor:pointer;padding:4px 5px}button:hover{background:#1d9bf01c}button:focus-visible{outline:2px solid #1d9bf0}button:disabled{opacity:.5;cursor:wait}.jury>button{flex:none}.metric{font-size:11px;white-space:nowrap}.compact{display:none}.vote{font-size:17px;min-width:28px}.human[aria-pressed=true]{background:#14b8a62b;color:#059669}.ai[aria-pressed=true]{background:#f973162b;color:#f97316}.uncertain[aria-pressed=true]{background:#64748b33;color:inherit;box-shadow:inset 0 0 0 1px #64748b}.panel{position:fixed;inset:auto;margin:0;width:300px;white-space:normal;max-width:80vw;background:Canvas;color:CanvasText;color-scheme:inherit;border:1px solid #8886;border-radius:12px;box-shadow:0 8px 24px #0003;padding:14px;z-index:100;line-height:1.6;font-size:13px}.panel:not(:popover-open){display:none}p{margin:0 0 8px}a{color:#1d9bf0}small{opacity:.7} @media(max-width:650px){.jury{gap:2px}button{padding-inline:4px}.vote{min-width:24px}} @media(max-width:480px){.full{display:none}.compact{display:inline}.jury{gap:1px}.jury>button{padding-inline:2px}.vote{min-width:20px}}`;
let pageId: string | null = null;
let remembered: ReturnType<typeof collectReplies>['original'];
const mounted = new Map<Element, { host: HTMLElement; remove: () => void; signature: string; snapshot: Snapshot; refresh: () => Promise<void>; community: () => Promise<void>; done: boolean }>();
const notices = new Map<Element, { remove: () => void }>();
function insertAfterTime(anchor: HTMLAnchorElement, host: HTMLElement) {
  const parent = anchor.parentElement!;
  const properties = ['flex-wrap', 'white-space', 'overflow-x', 'scrollbar-width'] as const;
  const values = ['nowrap', 'nowrap', 'auto', 'none'];
  const previous = properties.map(property => [parent.style.getPropertyValue(property), parent.style.getPropertyPriority(property)]);
  properties.forEach((property, index) => parent.style.setProperty(property, values[index]));
  parent.insertBefore(host, anchor.nextSibling);
  return () => {
    host.remove();
    properties.forEach((property, index) => {
      if (parent.style.getPropertyValue(property) !== values[index]) return;
      const [value, priority] = previous[index];
      if (value) parent.style.setProperty(property, value, priority); else parent.style.removeProperty(property);
    });
  };
}
let active = 0;
const waiting = new Set<Element>();
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) waiting.add(entry.target); else waiting.delete(entry.target);
  drain();
}, { threshold: 0.15 });
function drain() {
  while (active < 4 && waiting.size) {
    const article = waiting.values().next().value!; waiting.delete(article);
    const item = mounted.get(article);
    if (!item || item.done || !article.isConnected) continue;
    item.done = true; active++;
    Promise.resolve(item.refresh()).finally(() => { active--; drain(); });
  }
}
function mount(article: Element, snapshot: Snapshot) {
  const signature = JSON.stringify(snapshot), previous = mounted.get(article);
  const ink = getComputedStyle(article).color.match(/[\d.]+/g)?.slice(0,3).map(Number);
  const colorScheme = ink && ink[0] * .2126 + ink[1] * .7152 + ink[2] * .0722 > 128 ? 'dark' : 'light';
  if (previous?.signature === signature) { previous.host.style.colorScheme = colorScheme; return; }
  if (previous) { previous.remove(); observer.unobserve(article); }
  const anchor = timestampAnchor(article);
  if (!anchor?.parentElement) return;
  const host = document.createElement('span'); host.setAttribute('data-jury', '');
  host.style.colorScheme = colorScheme;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style'); style.textContent = styles; shadow.append(style);
  const wrapper = document.createElement('span'); wrapper.className = 'jury'; shadow.append(wrapper);
  const jev = document.createElement('button'), community = document.createElement('button');
  jev.className = community.className = 'metric'; jev.textContent = 'Jev 待检测'; community.textContent = '评审 —';
  function metric(button: HTMLButtonElement, full: string, compact: string, label = full) {
    const normal = document.createElement('span'), short = document.createElement('span');
    normal.className = 'full'; normal.textContent = full;
    short.className = 'compact'; short.textContent = compact;
    button.replaceChildren(normal, short); button.title = label; button.setAttribute('aria-label', label);
  }
  const human = document.createElement('button'), ai = document.createElement('button'), uncertain = document.createElement('button');
  human.className = 'vote human'; human.textContent = '✓'; human.title = '主要由真人写作'; human.setAttribute('aria-label', human.title);
  ai.className = 'vote ai'; ai.textContent = '×'; ai.title = '主要由 AI 生成'; ai.setAttribute('aria-label', ai.title);
  uncertain.className = 'vote uncertain'; uncertain.textContent = '?'; uncertain.title = '不确定'; uncertain.setAttribute('aria-label', uncertain.title);
  const panel = document.createElement('div'); panel.className = 'panel'; panel.setAttribute('popover','auto'); panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','人机评审详情');
  wrapper.append(jev, community, human, ai, uncertain); shadow.append(panel);
  let result: Result = {};
  let modelLoading = false, retryCount = 0, generation = 0, communityRunning = false, lastCommunityAt = 0;
  const setError = (error: unknown) => render({ ...result, error: error instanceof Error ? error.message : 'unavailable' });
  function details() {
    panel.replaceChildren();
    const lines = [result.analysis ? `Jev：真人 ${Math.round(result.analysis.human * 100)}% / AI ${Math.round(result.analysis.ai * 100)}%。置信度 ${Math.round(result.analysis.confidence * 100)}%。使用个人 Key；仅保存在本机，不上传评审网站。` : 'Jev 暂无判定。',
      ...(result.error ? [`检测状态：${messages[result.error] || '暂无法判断'}。可重新检测或打开插件设置检查 Key。`] : []),
      result.state ? `评审：${result.state.review.tally.human} 票真人 / ${result.state.review.tally.ai} 票 AI / ${result.state.review.tally.uncertain ?? 0} 票不确定。百分比为真人票占全部投票的比例。匿名安装身份不代表真实人数。` : '评审服务暂未连接，暂时无法获取社区票数。',
      ...(result.communityError && result.state ? ['当前无法更新评审统计，显示上次缓存的票数。'] : []),
      ...(result.pending ? [`你的${result.pending.vote === null ? '撤票' : result.pending.vote === 'human' ? '真人票' : result.pending.vote === 'uncertain' ? '不确定票' : 'AI 票'}已保存到本机，尚未同步。${result.pending.error ? `${messages[result.pending.error] || '服务暂不可用'}。` : ''}恢复连接后会同步最新选择。`] : []),
      `原帖：${snapshot.original.text.slice(0, 240)}${snapshot.original.text.length > 240 ? '…' : ''}`,
      '内容直接来自当前 X 页面的文字快照，未独立核实公开性或原文真实性。',
      '按主要写作者判断。模型概率与评审投票均不能证明作者身份。'];
    for (const text of lines) { const p = document.createElement('p'); p.textContent = text; panel.append(p); }
    if (result.state?.published) {
      const a = document.createElement('a');
      a.href = `${__API_ORIGIN__}/reviews/${result.state.review.id}`; a.textContent = '查看公开记录 ↗'; a.target = '_blank'; a.rel = 'noopener noreferrer'; panel.append(a);
    }
    const withdraw = document.createElement('button'); withdraw.textContent = '撤回我的投票'; withdraw.onclick = () => void cast(null); panel.append(withdraw);
    const retry = document.createElement('button'); retry.textContent = '重新检测'; retry.onclick = async () => {
      retry.disabled = true;
      await mounted.get(article)?.refresh();
      retry.disabled = false;
    }; panel.append(retry);
    const settings = document.createElement('button'); settings.textContent = '插件设置'; settings.onclick = () => void send({ type: 'open_options' }).catch(setError); panel.append(settings);
    const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => panel.hidePopover(); panel.append(close);
  }
  function render(next: Result) {
    // Model and community responses arrive independently. A late read cannot
    // roll back a vote or erase a personal result already shown to the user.
    const older = (next.sequence ?? 0) < (result.sequence ?? 0);
    const previous = result;
    result = { ...result, ...next, analysis: next.analysis ?? result.analysis,
      state: next.state ?? result.state, sequence: Math.max(result.sequence ?? 0, next.sequence ?? 0) };
    if (older) { result.state = previous.state; result.pending = previous.pending; }
    const a = result.analysis;
    result.analysis = a ?? undefined;
    metric(jev, a ? `Jev ${Math.round(a.human * 100)}%${a.confidence < .5 ? ' ?' : ''}` : modelLoading ? 'Jev 检测中' : 'Jev 暂无结果',
      a ? `Jev ${Math.round(a.human * 100)}%${a.confidence < .5 ? '?' : ''}` : modelLoading ? 'Jev …' : 'Jev —',
      a ? `Jev 真人写作概率 ${Math.round(a.human * 100)}%` : modelLoading ? 'Jev 检测中' : 'Jev 暂无结果');
    const tally = result.state?.review.tally;
    metric(community, tally?.total ? `评审 ${tally.humanPercent}%` : result.pending ? '评审 待同步' : tally ? '暂无评审' : '评审 —',
      tally?.total ? `评审 ${tally.humanPercent}%` : result.pending ? '评审 待同步' : tally ? '暂无评审' : '评审 —',
      tally?.total ? `真人票占全部投票 ${tally.humanPercent}% · ${tally.total}票（不确定 ${tally.uncertain ?? 0}票）` : '暂无评审统计');
    const selected = result.pending ? result.pending.vote : result.state?.myVote;
    human.setAttribute('aria-pressed', String(selected === 'human')); ai.setAttribute('aria-pressed', String(selected === 'ai'));
    uncertain.setAttribute('aria-pressed', String(selected === 'uncertain'));
    jev.title += a?.confidence !== undefined && a.confidence < .5 ? ' · 模型不确定，点击查看详情' : ' · 点击查看详情';
    community.title += result.pending ? ' · 投票已存本机，点击查看同步状态' : ' · 点击查看详情';
    if (panel.matches(':popover-open')) details();
  }
  async function cast(choice: Vote | null) {
    human.disabled = ai.disabled = uncertain.disabled = true;
    try { render(await send({ type: 'vote', snapshot, vote: choice })); } catch (e) { setError(e); }
    finally { human.disabled = ai.disabled = uncertain.disabled = false; }
  }
  human.onclick = e => { e.stopPropagation(); void cast('human'); }; ai.onclick = e => { e.stopPropagation(); void cast('ai'); };
  uncertain.onclick = e => { e.stopPropagation(); void cast('uncertain'); };
  jev.onclick = community.onclick = e => {
    e.stopPropagation();
    if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
    details(); panel.showPopover();
    const box = host.getBoundingClientRect(), size = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(box.left, innerWidth - size.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(box.bottom + 6, innerHeight - size.height - 8))}px`;
  };
  host.addEventListener('click', e => e.stopPropagation());
  const remove = insertAfterTime(anchor, host);
  const updateCommunity = async () => {
    if (communityRunning) return;
    communityRunning = true; lastCommunityAt = Date.now();
    try { const next = await send({ type: 'community', snapshot }); if (host.isConnected) render(next); }
    catch (e) { if (host.isConnected) render({ communityError: e instanceof Error ? e.message : 'unavailable' }); }
    finally { communityRunning = false; }
  };
  mounted.set(article, { host, remove, signature, snapshot, done: false, community: async () => {
    if (Date.now() - lastCommunityAt >= 15000 && (result.pending || result.communityError || !result.state)) await updateCommunity();
  }, refresh: async () => {
    const current = ++generation;
    modelLoading = true;
    if (!result.analysis) metric(jev, 'Jev 检测中', 'Jev …');
    // Neither the request nor the concurrency slot waits for community I/O.
    void updateCommunity();
    try {
      const next = await send({ type: 'analyze', snapshot });
      if (!host.isConnected || generation !== current) return;
      modelLoading = false; retryCount = 0; render(next);
    } catch (e) {
      if (!host.isConnected || generation !== current) return;
      modelLoading = false; setError(e);
      if (e instanceof Error && e.message === 'busy' && retryCount++ < 4) setTimeout(() => {
        const item = mounted.get(article), rect = article.getBoundingClientRect();
        if (item?.host === host && rect.bottom > 0 && rect.top < innerHeight) { item.done = false; waiting.add(article); drain(); }
      }, 3000);
    }
  } });
  observer.observe(article);
}
declare const __API_ORIGIN__: string;
let enabled = false;
function showIncomplete(article: Element) {
  if (notices.has(article)) return;
  const anchor = timestampAnchor(article);
  if (!anchor?.parentElement) return;
  const host = document.createElement('span'); host.setAttribute('data-jury', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style'); style.textContent = styles;
  const label = document.createElement('span'); label.className = 'metric'; label.textContent = '上下文不足';
  label.title = '原帖或评论不完整，未发送检测。请展开全文后重试。';
  shadow.append(style, label); notices.set(article, { remove: insertAfterTime(anchor, host) });
}
async function scan() {
  const id = statusId(location.pathname);
  if (id !== pageId) { for (const item of mounted.values()) item.remove(); for (const notice of notices.values()) notice.remove(); notices.clear(); mounted.clear(); waiting.clear(); observer.disconnect(); remembered = undefined; pageId = id; }
  if (!id) return;
  try { enabled = (await send({ type: 'enabled' })).enabled; } catch { return; }
  if (id !== statusId(location.pathname)) return;
  const data = enabled ? collectReplies(document, id, remembered) : { items: [], incomplete: [], original: undefined }; remembered = data.original;
  const eligible = new Set(data.items.map(item => item.article));
  for (const [article, item] of mounted) if (!article.isConnected || !eligible.has(article)) { item.remove(); observer.unobserve(article); waiting.delete(article); mounted.delete(article); }
  for (const [article, notice] of notices) if (!article.isConnected || !data.incomplete.includes(article)) { notice.remove(); notices.delete(article); }
  for (const { article, snapshot } of data.items) mount(article, snapshot);
  if (!document.hidden) for (const [article, item] of mounted) {
    const rect = article.getBoundingClientRect();
    if (item.done && rect.bottom > 0 && rect.top < innerHeight) void item.community();
  }
  for (const article of data.incomplete) showIncomplete(article);
}
let scheduled = false;
function schedule() { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; void scan(); }, 350); }
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
window.addEventListener('popstate', schedule);
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
setInterval(schedule, 3000); // catches X SPA navigation without patching its JavaScript
schedule();
