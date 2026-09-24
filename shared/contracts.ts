import { z } from 'zod';

export const RULE_VERSION = 'authorship-v1';
export const DEFAULT_MODEL = 'jev-1.13.0';
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const postId = z.string().regex(/^\d{1,25}$/);
const text = z.string().min(1).max(25000).refine(v => v.trim().length > 0);
export const postSchema = z.object({
  id: postId, url: z.string().max(200), text,
}).strict().superRefine((v, ctx) => {
  if (v.url !== `https://x.com/i/status/${v.id}`) ctx.addIssue({ code: 'custom', message: 'Noncanonical source URL' });
});
export const snapshotSchema = z.object({
  original: postSchema, comment: postSchema, parent: postSchema.optional(),
  // Legacy field: only a page visibility declaration, never independent proof.
  publicConfirmed: z.literal(true), complete: z.literal(true),
}).strict().refine(v => v.original.id !== v.comment.id, 'A reply must differ from the original');
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Post = z.infer<typeof postSchema>;
export const voteSchema = z.enum(['human', 'ai', 'uncertain']);
export type Vote = z.infer<typeof voteSchema>;
export const analysisSchema = z.object({
  human: z.number().min(0).max(1), ai: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1), model: z.string().min(1).max(80),
  ruleVersion: z.literal(RULE_VERSION), source: z.literal('client_byok'),
  evaluatedAt: z.number(),
}).strict().refine(v => Math.abs(v.human + v.ai - 1) < 0.005);
export type Analysis = z.infer<typeof analysisSchema>;
export type Tally = { human: number; ai: number; uncertain: number; total: number; humanPercent: number | null };
export type Review = {
  id: string; snapshot: Snapshot; tally: Tally;
  contentSource: 'extension_submission' | 'demo'; createdAt: number;
  updatedAt: number; conflict: boolean;
};
export type ReviewState = { review: Review; myVote: Vote | null; sequence: number; published: boolean };
// Network responses are untrusted too. Strip unknown legacy model fields.
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const reviewStateSchema = z.object({
  review: z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/), snapshot: snapshotSchema,
    tally: z.object({ human: count, ai: count, uncertain: count.default(0) })
      .refine(v => Number.isSafeInteger(v.human + v.ai + v.uncertain)),
    contentSource: z.enum(['extension_submission', 'demo']),
    createdAt: count, updatedAt: count, conflict: z.boolean(),
  }),
  myVote: voteSchema.nullable(), sequence: count, published: z.boolean(),
});

export function tally(human: number, ai: number, uncertain = 0): Tally {
  const total = human + ai + uncertain;
  return { human, ai, uncertain, total, humanPercent: total ? Math.round(human / total * 100) : null };
}
export function canonicalUrl(id: string) { return `https://x.com/i/status/${postId.parse(id)}`; }
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export async function reviewId(snapshot: Snapshot) {
  return sha256(JSON.stringify([snapshot.original.id, snapshot.original.text, snapshot.comment.id, snapshot.comment.text,
    snapshot.parent?.id ?? null, snapshot.parent?.text ?? null]));
}
export class AppError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export const messages: Record<string, string> = {
  unavailable: '服务暂不可用', upstream_unavailable: 'Jev 暂不可用', shared_unavailable: '网站仅提供评审团投票，请配置个人 Key',
  personal_key_required: '请在插件设置中配置个人 Jev Key', rate_limit: '请求过于频繁，请稍后重试', busy: '正在排队，请稍后重试',
  public_unconfirmed: '无法确认原帖和评论公开可访问', invalid: '内容不完整或格式有误',
  not_found: '记录不存在或未公开', unauthorized: '匿名凭证无效', key_invalid: '个人 Key 无效',
  permission: '请在插件设置中启用个人 Key 访问权限', stale: '已保留较新的投票', disabled: '请先在插件设置中启用',
  queue_full: '待同步记录已满，请先同步后再投票', hidden: '此记录已由维护者下架',
};
