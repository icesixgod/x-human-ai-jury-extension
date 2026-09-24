// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { answer } from './fixtures';
import { tally } from '../shared/contracts';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps errors out of the comment row and makes them available in details', async () => {
  vi.useFakeTimers(); vi.resetModules();
  history.replaceState(null, '', '/writer/status/10001');
  const article = (id: string, text: string) => `<article data-testid="tweet"><div data-testid="User-Name"><a href="/writer/status/${id}"><time>2小时</time></a></div><div data-testid="tweetText">${text}</div></article>`;
  document.body.innerHTML = `<section aria-label="Timeline: Conversation">${article('10001', 'Original')}${article('10002', 'Reply')}</section>`;
  const nativeShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) { return nativeShadow.call(this, { ...init, mode: 'open' }); });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: (entries: unknown[]) => void) {}
    observe(target: Element) { this.callback([{ target, isIntersecting: true }]); }
    unobserve() {} disconnect() {}
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string }) => message.type === 'enabled' ? { ok: true, data: { enabled: true } } : { ok: false, error: 'key_invalid' }) } });
  await import('../extension/content');
  await vi.advanceTimersByTimeAsync(400);
  const shadow = document.querySelector('[data-jury]')!.shadowRoot!;
  expect(shadow.querySelector('.jury')!.textContent).not.toContain('Key');
  expect(shadow.querySelector('.jury')!.textContent).not.toContain('待检测');
  expect(shadow.querySelector('.jury')!.textContent).not.toContain('检测中');
  const panel = shadow.querySelector<HTMLElement>('.panel')!;
  panel.showPopover = () => {}; panel.hidePopover = () => {};
  shadow.querySelector<HTMLButtonElement>('.metric')!.click();
  expect(panel.textContent).toContain('个人 Key 无效');
  expect(panel.textContent).toContain('插件设置');
  expect(panel.textContent).toContain('暂时无法获取社区票数');

  // Reuse the live content script: change the comment version and keep its
  // community response pending while the model responds immediately.
  let release!: (value: unknown) => void;
  const delayed = new Promise(resolve => { release = resolve; });
  const model = { human: .8, ai: .2, confidence: .7, model: answer.model,
    ruleVersion: 'authorship-v1', source: 'client_byok', evaluatedAt: Date.now() };
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (message: any) => {
    if (message.type === 'enabled') return { ok: true, data: { enabled: true } };
    if (message.type === 'community') return delayed;
    return { ok: true, data: { analysis: model, sequence: 0, pending: null } };
  });
  document.querySelectorAll('[data-testid="tweetText"]')[1].textContent = 'Changed reply';
  await vi.advanceTimersByTimeAsync(400);
  const updated = document.querySelector('[data-jury]')!.shadowRoot!;
  expect(updated.querySelector('.metric')!.textContent).toContain('Jev 80%');
  expect(updated.querySelector('.jury')!.textContent).not.toContain('检测中');
  release({ ok: true, data: { sequence: 0, pending: null, communityError: 'unavailable' } });
  await vi.advanceTimersByTimeAsync(10);
  expect(updated.querySelector('.metric')!.textContent).toContain('Jev 80%');
  expect(updated.querySelector('.jury')!.textContent).not.toContain('真人');
  const uncertain = updated.querySelector<HTMLButtonElement>('.uncertain')!;
  expect(uncertain.textContent).toBe('?');expect(uncertain.getAttribute('aria-label')).toBe('不确定');
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (message:any) => ({ok:true,data:{state:{review:{tally:tally(message.vote==='human'?1:0,0,message.vote==='uncertain'?1:0)},myVote:message.vote},sequence:1,pending:null}}));
  uncertain.click();await vi.advanceTimersByTimeAsync(1);
  expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'vote',vote:'uncertain'}));
  expect(uncertain.getAttribute('aria-pressed')).toBe('true');
  expect(updated.querySelector<HTMLButtonElement>('.human')!.getAttribute('aria-pressed')).toBe('false');
  expect(updated.querySelectorAll('.metric')[1].textContent).toContain('评审 0%');
  const detail=updated.querySelector<HTMLElement>('.panel')!;detail.showPopover=()=>{};detail.hidePopover=()=>{};
  updated.querySelector<HTMLButtonElement>('.metric')!.click();
  expect(detail.textContent).toContain('1 票不确定');
  updated.querySelector<HTMLButtonElement>('.human')!.click();await vi.advanceTimersByTimeAsync(1);
  expect(uncertain.getAttribute('aria-pressed')).toBe('false');
  expect(updated.querySelector<HTMLButtonElement>('.human')!.getAttribute('aria-pressed')).toBe('true');

  vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (message:any) => message.type==='enabled' ? {ok:true,data:{enabled:true}} : {ok:true,data:{analysis:model,sequence:0,pending:null}});
  history.replaceState(null,'','/writer/status/10002');
  document.body.innerHTML=`<section aria-label="Timeline: Conversation">${article('10001','Original')}${article('10002','Focused reply')}</section>`;
  await vi.advanceTimersByTimeAsync(400);
  const focused=document.querySelectorAll('article')[1];
  expect(focused.querySelector('[data-jury]')).not.toBeNull();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({type:'analyze',snapshot:expect.objectContaining({original:expect.objectContaining({id:'10001'}),comment:expect.objectContaining({id:'10002'})})}));
  vi.mocked(chrome.runtime.sendMessage).mockClear();
  document.querySelector('article')!.insertAdjacentHTML('beforeend','<button data-testid="tweet-text-show-more-link">Show more</button>');
  await vi.advanceTimersByTimeAsync(400);
  const notice=focused.querySelector('[data-jury]')!.shadowRoot!;
  expect(notice.querySelector('a')?.getAttribute('href')).toBe('https://x.com/i/status/10001');
  expect(notice.textContent).toContain('评审 · 打开原帖');
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({type:'analyze'}));
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({type:'community'}));
});
