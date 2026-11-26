import { describe, expect, it } from 'vitest';
import {
  ApproveAckRequest,
  HideMessageRequest,
  REPLY_KIND_CATEGORY_KEY,
  RejectReplyRequest,
  RemoveMessageRequest,
  RequestReplyApprovalRequest,
  SENSITIVE_REPLY_KINDS,
  SetAckSettingsRequest,
} from './inbox-replies';

const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('sensitive replies', () => {
  it('every kind follows one approval category', () => {
    expect(Object.keys(REPLY_KIND_CATEGORY_KEY).sort()).toEqual([...SENSITIVE_REPLY_KINDS].sort());
    expect(REPLY_KIND_CATEGORY_KEY.legal_threat).toBe('legal');
    expect(REPLY_KIND_CATEGORY_KEY.personal_data).toBe('legal');
    expect(REPLY_KIND_CATEGORY_KEY.refund_compensation).toBe('financial');
    expect(REPLY_KIND_CATEGORY_KEY.investor).toBe('financial');
    expect(REPLY_KIND_CATEGORY_KEY.media).toBe('crisis');
    expect(REPLY_KIND_CATEGORY_KEY.safety).toBe('crisis');
  });

  it('a request needs a known kind and a text', () => {
    const ok = { socialAccountId: id, engineMessageId: 'm1', text: ' Hello ', kind: 'media' };
    expect(RequestReplyApprovalRequest.parse(ok).text).toBe('Hello');
    expect(RequestReplyApprovalRequest.safeParse({ ...ok, kind: 'gossip' }).success).toBe(false);
    expect(RequestReplyApprovalRequest.safeParse({ ...ok, text: '   ' }).success).toBe(false);
    expect(RequestReplyApprovalRequest.safeParse({ ...ok, text: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('a rejection always carries a reason', () => {
    expect(RejectReplyRequest.safeParse({}).success).toBe(false);
    expect(RejectReplyRequest.safeParse({ reason: 'no' }).success).toBe(false);
    expect(RejectReplyRequest.safeParse({ reason: 'Too much promised.' }).success).toBe(true);
  });
});

describe('moderation', () => {
  const target = { socialAccountId: id, engineMessageId: 'm1' };
  it('hiding needs no reason; deleting and blocking do', () => {
    expect(HideMessageRequest.safeParse(target).success).toBe(true);
    expect(RemoveMessageRequest.safeParse(target).success).toBe(false);
    expect(RemoveMessageRequest.safeParse({ ...target, reason: '    ' }).success).toBe(false);
    expect(RemoveMessageRequest.safeParse({ ...target, reason: 'Abusive language.' }).success).toBe(
      true,
    );
  });
});

describe('acknowledgement', () => {
  it('needs an English text; the Amharic one is optional but not empty', () => {
    const base = { companyId: id, textEn: 'Thank you.', textAm: null, enabled: true };
    expect(SetAckSettingsRequest.safeParse(base).success).toBe(true);
    expect(SetAckSettingsRequest.safeParse({ ...base, textEn: ' ' }).success).toBe(false);
    expect(SetAckSettingsRequest.safeParse({ ...base, textAm: '' }).success).toBe(false);
    expect(SetAckSettingsRequest.safeParse({ ...base, textAm: 'አመሰግናለሁ።' }).success).toBe(true);
  });

  it('an approval names the version that was read', () => {
    expect(ApproveAckRequest.safeParse({ companyId: id, version: 1 }).success).toBe(true);
    expect(ApproveAckRequest.safeParse({ companyId: id }).success).toBe(false);
    expect(ApproveAckRequest.safeParse({ companyId: id, version: 0 }).success).toBe(false);
  });
});
