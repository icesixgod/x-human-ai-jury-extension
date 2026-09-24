import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { acknowledge, emptyState, enqueue } from '../extension/state';
import { contentMessage, contentSender, settingsSender } from '../extension/messages';
import { collectReplies, extractPost, timestampAnchor } from '../extension/dom';
import { snapshot } from './fixtures';
const extensionId='a'.repeat(32);
function article(id:string,text:string,extra=''){return `<article data-testid="tweet"><div data-testid="User-Name"><a href="/writer/status/${id}"><time>now</time></a></div><button aria-label="Ask Grok">Grok</button><button data-testid="caret">More</button><div data-testid="tweetText">${text}</div>${extra}</article>`;}
describe('extension trust boundaries',()=>{
  it('only accepts same-extension top-level X detail page messages',()=>{
    const good={id:extensionId,frameId:0,tab:{id:1},url:'https://x.com/writer/status/123'} as chrome.runtime.MessageSender;
    expect(contentSender(good,extensionId)).toBe(true);
    for(const override of [{id:'b'.repeat(32)},{frameId:1},{url:'https://x.com/messages'},{url:'https://evil.example/writer/status/123'},{tab:undefined}])expect(contentSender({...good,...override},extensionId)).toBe(false);
    expect(settingsSender(good,extensionId)).toBe(false);
    expect(settingsSender({id:extensionId,url:`chrome-extension://${extensionId}/options.html`},extensionId)).toBe(true);
    expect(contentMessage.safeParse({type:'save',key:'attacker'}).success).toBe(false);
    expect(contentMessage.safeParse({type:'analyze',snapshot,url:'https://attacker.example'}).success).toBe(false);
  });
  it('coalesces offline changes and ignores late acknowledgements',()=>{
    let state=emptyState();state=enqueue(state,{id:'same',snapshot,vote:'human',sequence:1});state=enqueue(state,{id:'same',snapshot,vote:null,sequence:2});
    state=JSON.parse(JSON.stringify(state)); // restart persistence boundary
    expect(Object.keys(state.queue)).toHaveLength(1);expect(state.queue.same.vote).toBeNull();
    expect(acknowledge(state,'same',1).queue.same.sequence).toBe(2);
    expect(acknowledge(state,'same',2).queue).toEqual({});
  });
});
describe('conservative X DOM extraction',()=>{
  it('finds the original permalink after an unmarked quoted-post date on a detail page',()=>{
    const original = `<article data-testid="tweet"><div data-testid="tweetText">Original with quote</div><div role="link" tabindex="0"><div data-testid="User-Name"><time>Quoted date</time></div><div data-testid="tweetText">Quoted text</div></div><a href="/writer/status/1"><time>Original date</time></a></article>`;
    const dom=new JSDOM(`<section aria-label="时间线：对话">${original}${article('2','Reply')}<h2>发现更多</h2>${article('3','Unrelated')}</section>`);
    const result=collectReplies(dom.window.document,'1');
    expect(result.original?.post).toMatchObject({id:'1',text:'Original with quote'});
    expect(result.items.map(item=>item.snapshot.comment.id)).toEqual(['2']);
    expect(timestampAnchor(dom.window.document.querySelector('article')!)?.textContent).toBe('Original date');
  });
  it('skips unlinked and non-post dates instead of stopping before a usable timestamp',()=>{
    const dom=new JSDOM(`<article data-testid="tweet"><time>Unlinked</time><a href="/writer"><time>Profile</time></a><a href="/writer/status/1"><time>Post</time></a></article>`);
    expect(timestampAnchor(dom.window.document.querySelector('article')!)?.textContent).toBe('Post');
  });
  it('excludes linked quote timestamps and quote-only text without legacy quote test IDs',()=>{
    const quote='<div role="link" tabindex="0"><a href="/quoted/status/999"><time>Quoted date</time></a><div data-testid="tweetText">Quoted text</div></div>';
    const dom=new JSDOM(`<article data-testid="tweet">${quote}<a href="/writer/status/1"><time>Original date</time></a></article>`);
    const original=dom.window.document.querySelector('article')!;
    expect(timestampAnchor(original)?.getAttribute('href')).toBe('/writer/status/1');
    expect(extractPost(original)).toBeNull();
  });
  it('extracts replies in a conversation and excludes suggested posts',()=>{
    const dom=new JSDOM(`<section aria-label="Timeline: Conversation">${article('1','Original')}${article('2','Reply') }<h2>Discover more</h2>${article('3','Unrelated')}</section>`);
    const result=collectReplies(dom.window.document,'1');expect(result.items).toHaveLength(1);expect(result.items[0].snapshot.comment.id).toBe('2');expect(result.items[0].snapshot.original.id).toBe('1');
    expect(timestampAnchor(result.items[0].article)?.getAttribute('href')).toBe('/writer/status/2');
  });
  it('fails closed outside a known conversation region',()=>{
    const dom=new JSDOM(article('1','Original')+article('2','Reply'));expect(collectReplies(dom.window.document,'1').items).toEqual([]);
  });
  it('discards remembered context when the original becomes truncated or protected',()=>{
    for(const extra of ['<a data-testid="tweet-text-show-more-link">Show more</a>','<span aria-label="Protected account"></span>']){
      const dom=new JSDOM(`<section aria-label="Timeline: Conversation">${article('1','Original')}${article('2','Reply')}</section>`);
      const remembered=collectReplies(dom.window.document,'1').original;
      dom.window.document.querySelector('article')!.insertAdjacentHTML('beforeend',extra);
      const current=collectReplies(dom.window.document,'1',remembered);
      expect(current.original).toBeUndefined();expect(current.items).toEqual([]);
      expect(current.incomplete).toHaveLength(extra.includes('Protected')?0:1);
    }
  });
  it('retains context for virtual scroll and flags incomplete replies without sending them',()=>{
    const dom=new JSDOM(`<section aria-label="Timeline: Conversation">${article('1','Original')}${article('2','Reply')}${article('3','Short','<a data-testid="tweet-text-show-more-link">Show more</a>')}</section>`);
    const remembered=collectReplies(dom.window.document,'1').original;
    dom.window.document.querySelector('article')!.remove();
    const current=collectReplies(dom.window.document,'1',remembered);
    expect(current.items.map(item=>item.snapshot.comment.id)).toEqual(['2']);expect(current.incomplete).toHaveLength(1);
  });
  it('skips protected, truncated and media-only posts',()=>{
    for(const extra of ['<span aria-label="Protected account"></span>','<a data-testid="tweet-text-show-more-link">Show more</a>']){
      const dom=new JSDOM(article('2','Reply',extra));expect(extractPost(dom.window.document.querySelector('article')!)).toBeNull();
    }
    const dom=new JSDOM(article('2',''));expect(extractPost(dom.window.document.querySelector('article')!)).toBeNull();
  });
  it('preserves emoji text and treats hostile markup as text',()=>{
    const dom=new JSDOM(article('2','Hello <img alt="👋"/> &lt;script&gt;alert(1)&lt;/script&gt;'));
    expect(extractPost(dom.window.document.querySelector('article')!)?.text).toBe('Hello 👋 <script>alert(1)</script>');
  });
  it('anchors next to the comment time, ignoring quoted-post timestamps',()=>{
    const dom=new JSDOM(article('2','Reply','<div data-testid="quoteTweet"><a href="/quoted/status/999"><time>Quoted time</time></a></div>'));
    const target=timestampAnchor(dom.window.document.querySelector('article')!);
    expect(target?.textContent).toBe('now');expect(target?.getAttribute('href')).toBe('/writer/status/2');
  });
});

describe('focused reply details',()=>{
  it('reviews the focused comment using the visible original, even with no replies below it',()=>{
    const dom=new JSDOM(`<section aria-label="时间线：对话">${article('1','Original')}${article('2','Focused reply')}</section>`);
    const result=collectReplies(dom.window.document,'2');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].snapshot).toMatchObject({original:{id:'1'},comment:{id:'2'}});
    expect(result.items[0].snapshot).not.toHaveProperty('parent');
    expect(collectReplies(dom.window.document,'1').items[0].snapshot).toEqual(result.items[0].snapshot);
  });
  it('preserves visible parent context without adding review controls to ancestors',()=>{
    const dom=new JSDOM(`<section aria-label="Timeline: Conversation">${article('1','Original')}${article('2','Parent')}${article('3','Focused')}${article('4','Child')}</section>`);
    const result=collectReplies(dom.window.document,'3');
    expect(result.items.map(item=>item.snapshot.comment.id)).toEqual(['3','4']);
    expect(result.items[0].snapshot).toMatchObject({original:{id:'1'},parent:{id:'2'},comment:{id:'3'}});
    expect(result.items[1].snapshot).toMatchObject({original:{id:'3'},comment:{id:'4'}});
  });
  it('offers the original link for collapsed context and mounts a review after expansion',()=>{
    const dom=new JSDOM(`<section aria-label="Timeline: Conversation">${article('1','Original','<button data-testid="tweet-text-show-more-link">Show more</button>')}${article('2','Focused')}</section>`);
    const blocked=collectReplies(dom.window.document,'2');
    expect(blocked.items).toEqual([]);expect(blocked.incomplete).toHaveLength(1);
    expect(blocked.incomplete[0].contextUrl).toBe('https://x.com/i/status/1');
    dom.window.document.querySelector('[data-testid="tweet-text-show-more-link"]')!.remove();
    const expanded=collectReplies(dom.window.document,'2',blocked.original);
    expect(expanded.items[0].snapshot.comment.id).toBe('2');expect(expanded.incomplete).toEqual([]);
  });
  it('retains only same-page context and discards it when ancestors become incomplete or protected',()=>{
    const dom=new JSDOM(`<section aria-label="Timeline: Conversation">${article('1','Original')}${article('2','Focused')}</section>`);
    const original=dom.window.document.querySelector('article')!;
    const remembered=collectReplies(dom.window.document,'2').original;
    original.remove();
    expect(collectReplies(dom.window.document,'2',remembered).items[0].snapshot.original.id).toBe('1');
    dom.window.document.querySelector('section')!.prepend(original);
    original.insertAdjacentHTML('beforeend','<button data-testid="tweet-text-show-more-link">Show more</button>');
    const incomplete=collectReplies(dom.window.document,'2',remembered);
    expect(incomplete.items).toEqual([]);expect(incomplete.original?.replyContext).toBeUndefined();
    original.insertAdjacentHTML('beforeend','<span aria-label="Protected account"></span>');
    expect(collectReplies(dom.window.document,'2',remembered)).toEqual({items:[],incomplete:[]});
  });
  it('does not turn a standalone original into a comment using unrelated or quoted posts',()=>{
    const quoted='<div data-testid="quoteTweet">'+article('99','Quoted')+'</div>';
    const dom=new JSDOM(article('90','Outside')+`<section aria-label="Timeline: Conversation">${article('2','Original',quoted)}</section>`);
    const result=collectReplies(dom.window.document,'2');expect(result.items).toEqual([]);expect(result.incomplete).toEqual([]);
  });
});

it('keeps the root context during partial ancestor virtualization and never reviews ancestors as descendants',()=>{
  const dom=new JSDOM(`<section aria-label="Timeline: Conversation">${article('1','Original')}${article('2','Parent')}${article('3','Focused')}${article('4','Child')}</section>`);
  const [original,,focused]=[...dom.window.document.querySelectorAll('article')];
  let remembered=collectReplies(dom.window.document,'3').original;
  original.remove();
  const partial=collectReplies(dom.window.document,'3',remembered);
  expect(partial.items[0].snapshot).toMatchObject({original:{id:'1'},parent:{id:'2'},comment:{id:'3'}});
  remembered=partial.original;focused.remove();
  expect(collectReplies(dom.window.document,'3',remembered).items.map(item=>item.snapshot.comment.id)).toEqual(['4']);
});
