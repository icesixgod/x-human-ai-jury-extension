import { z } from 'zod';
import { snapshotSchema, voteSchema } from '../shared/contracts';
export const contentMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('analyze'), snapshot: snapshotSchema }).strict(),
  z.object({ type: z.literal('community'), snapshot: snapshotSchema }).strict(),
  z.object({ type: z.literal('vote'), snapshot: snapshotSchema, vote: voteSchema.nullable() }).strict(),
  z.object({ type: z.literal('open_options') }).strict(),
  z.object({ type: z.literal('enabled') }).strict(),
]);
export const settingsMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('settings') }).strict(),
  z.object({ type: z.literal('save'), enabled: z.boolean(), consent: z.boolean(), rememberKey: z.boolean(), key: z.string().max(512).optional() }).strict(),
  z.object({ type: z.literal('clear_key') }).strict(),
  z.object({ type: z.literal('sync') }).strict(),
]);
export function contentSender(sender: chrome.runtime.MessageSender, extensionId: string) {
  if (sender.id !== extensionId || sender.frameId !== 0 || typeof sender.tab?.id !== 'number' || !sender.url) return false;
  try { const u = new URL(sender.url); return u.origin === 'https://x.com' && /^\/(?:[A-Za-z0-9_]+|i)\/status\/\d+(?:\/.*)?$/.test(u.pathname); } catch { return false; }
}
export function settingsSender(sender: chrome.runtime.MessageSender, extensionId: string) {
  return sender.id === extensionId && sender.url === `chrome-extension://${extensionId}/options.html`;
}
