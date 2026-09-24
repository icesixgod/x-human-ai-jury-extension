import { canonicalUrl, type Post, type Snapshot } from '../shared/contracts';

const ARTICLE = 'article[data-testid="tweet"]';
export function statusId(path: string) { return path.match(/^\/(?:[A-Za-z0-9_]+|i)\/status\/(\d{1,25})(?:\/.*)?$/)?.[1] ?? null; }
function inQuote(element: Element) {
  // X also renders quote cards as keyboard-focusable links without a test ID.
  return !!element.closest('[data-testid="quoteTweet"], [data-testid="card.wrapper"], div[role="link"][tabindex="0"]');
}
export function protectedPost(article: Element) { return !!article.querySelector('[aria-label*="Protected"], [aria-label*="受保护"], [data-testid="icon-lock"]'); }
export function timestampAnchor(article: Element): HTMLAnchorElement | null {
  for (const time of article.querySelectorAll('time')) {
    if (inQuote(time) || time.closest(ARTICLE) !== article) continue;
    const anchor = time.closest('a'), href = anchor?.getAttribute('href');
    if (!anchor || !href) continue;
    try {
      const url = new URL(href, 'https://x.com');
      if (url.origin === 'https://x.com' && statusId(url.pathname)) return anchor;
    } catch { /* Keep looking for the article's own permalink. */ }
  }
  return null;
}
function articleId(article: Element) {
  const href = timestampAnchor(article)?.getAttribute('href');
  try { return href ? statusId(new URL(href, 'https://x.com').pathname) : null; } catch { return null; }
}
export function extractPost(article: Element): Post | null {
  if (protectedPost(article) || article.querySelector('[data-testid="tweet-text-show-more-link"]')) return null;
  const id = articleId(article);
  const textNode = [...article.querySelectorAll('[data-testid="tweetText"]')].find(e => !inQuote(e) && e.closest(ARTICLE) === article);
  if (!id || !textNode) return null;
  const clone = textNode.cloneNode(true) as Element;
  clone.querySelectorAll('img[alt]').forEach(img => img.replaceWith(img.getAttribute('alt') || ''));
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  const text = clone.textContent?.trim();
  if (!text || text.length > 25000) return null;
  return { id, text, url: canonicalUrl(id) };
}
export function conversationRegion(article: Element): Element | null {
  let parent: Element | null = article.parentElement;
  while (parent) {
    const label = parent.getAttribute('aria-label') || '';
    if (/^Timeline: Conversation$/i.test(label) || /^时间[线軸][:：]\s*(对话|会话|對話)$/.test(label)) return parent;
    parent = parent.parentElement;
  }
  return null;
}
export function afterRecommendation(article: Element, region: Element) {
  const headings = [...region.querySelectorAll('h2, h3, [role="heading"]')];
  return headings.some(h => /^(Discover more|More posts|发现更多|更多帖子|探索更多|相關貼文)$/i.test(h.textContent?.trim() || '') && !!(h.compareDocumentPosition(article) & 4));
}
export function collectReplies(root: Document, focusedId: string, remembered?: { post: Post; region: Element }): { original?: { post: Post; region: Element }; items: { article: Element; snapshot: Snapshot }[]; incomplete: Element[] } {
  const articles = [...root.querySelectorAll(ARTICLE)];
  // Recognize an incomplete/now-protected original before consulting virtual-scroll memory.
  const main = articles.find(article => articleId(article) === focusedId);
  const region = main ? conversationRegion(main) : remembered?.region;
  const post = main ? extractPost(main) : remembered?.post;
  if (!region?.isConnected || (main && protectedPost(main))) return { items: [], incomplete: [] };
  const items: { article: Element; snapshot: Snapshot }[] = [];
  const incomplete: Element[] = [];
  for (const article of articles) {
    if (!region.contains(article) || article === main || afterRecommendation(article, region)) continue;
    if (main && !(main.compareDocumentPosition(article) & 4)) continue;
    if (protectedPost(article)) continue;
    const comment = extractPost(article);
    if (articleId(article) === focusedId) continue;
    if (!comment || !post || post.id !== focusedId) { incomplete.push(article); continue; }
    items.push({ article, snapshot: { original: post, comment, publicConfirmed: true, complete: true } });
  }
  return { original: post ? { post, region } : undefined, items, incomplete };
}
export function toolbarAnchor(article: Element): Element | null {
  return article.querySelector('button[aria-label*="Grok"], [data-testid="grok"]') || article.querySelector('[data-testid="caret"]');
}
