import { SourceRecord, ValidationOk, ValidationResult } from './types';
import { VALIDATION_MESSAGES, toPreview, validateRecord } from './validate';

/**
 * 核對人員編號的規則（取代舊的 int／string 型別規則）。
 * 重點：編號一律以字串比對與保存，'0102' 不會變成 102、'102' 也不算相符。
 */
const B102: SourceRecord = { key: 'B102', name: null, code: '0102', refusal: null, refusalApplies: true };
const B607: SourceRecord = { key: 'B607', name: null, code: '0607', refusal: true, refusalApplies: true };
const H17: SourceRecord = { key: 'H17', name: '林予安', code: 'H-17', refusal: null, refusalApplies: false };

function expectOk(result: ValidationResult): ValidationOk {
  if (!result.ok) {
    fail(`expected ok but got error: ${result.error}`);
  }
  return result as ValidationOk;
}

function expectError(result: ValidationResult): string {
  if (result.ok) {
    fail(`expected error but got ok: ${JSON.stringify(result)}`);
    return '';
  }
  return result.error;
}

describe('validateRecord：B102（refusal null、適用拒絕紀錄）', () => {
  it('default_false → ok、code "0102"、refusal false、origin defaulted', () => {
    const ok = expectOk(validateRecord(B102, { value: '0102', policy: 'default_false' }));
    expect(typeof ok.code).toBe('string');
    expect(ok.code).toBe('0102');
    expect(ok.refusal).toBeFalse();
    expect(ok.origin).toBe('defaulted');
  });

  it('request_review → ok、code "0102"、refusal null、origin review', () => {
    const held = expectOk(validateRecord(B102, { value: '0102', policy: 'request_review' }));
    expect(typeof held.code).toBe('string');
    expect(held.code).toBe('0102');
    expect(held.refusal).toBeNull();
    expect(held.origin).toBe('review');
  });

  it('缺 policy → error policyRequired', () => {
    expect(expectError(validateRecord(B102, { value: '0102' }))).toBe(VALIDATION_MESSAGES.policyRequired);
  });

  it('空字串 → error codeRequired', () => {
    expect(expectError(validateRecord(B102, { value: '', policy: 'default_false' }))).toBe(
      VALIDATION_MESSAGES.codeRequired,
    );
  });

  it('只有空白 "   " → error codeRequired', () => {
    expect(expectError(validateRecord(B102, { value: '   ', policy: 'default_false' }))).toBe(
      VALIDATION_MESSAGES.codeRequired,
    );
  });

  it('少了前導零的 "102" → error codeMismatch（前導零不可省略）', () => {
    expect(expectError(validateRecord(B102, { value: '102', policy: 'default_false' }))).toBe(
      VALIDATION_MESSAGES.codeMismatch,
    );
  });

  for (const value of ['友善的人', '0607', 'abc', '１０２', '0102x', '01020', 'NaN', '1e2', '102.5', '-102']) {
    it(`與來源編號不符的 ${JSON.stringify(value)} → error codeMismatch`, () => {
      expect(expectError(validateRecord(B102, { value, policy: 'default_false' }))).toBe(
        VALIDATION_MESSAGES.codeMismatch,
      );
    });
  }

  it('前後空白 " 0102 " → ok（trim 後相符）', () => {
    const ok = expectOk(validateRecord(B102, { value: ' 0102 ', policy: 'default_false' }));
    expect(ok.code).toBe('0102');
    expect(ok.origin).toBe('defaulted');
  });

  it('超長數字字串 → error codeMismatch，不會拋例外', () => {
    expect(expectError(validateRecord(B102, { value: '99999999999999999999', policy: 'default_false' }))).toBe(
      VALIDATION_MESSAGES.codeMismatch,
    );
  });

  it('編號錯誤時先報 codeMismatch，不會先要求 policy', () => {
    expect(expectError(validateRecord(B102, { value: '102' }))).toBe(VALIDATION_MESSAGES.codeMismatch);
    expect(expectError(validateRecord(B102, { value: '' }))).toBe(VALIDATION_MESSAGES.codeRequired);
  });
});

describe('validateRecord：B607（refusal true）', () => {
  it('不需 policy → ok、code "0607"、refusal true、origin source', () => {
    const ok = expectOk(validateRecord(B607, { value: '0607' }));
    expect(ok.code).toBe('0607');
    expect(ok.refusal).toBeTrue();
    expect(ok.origin).toBe('source');
  });

  it('即使給了 policy 也以來源拒絕紀錄為準', () => {
    const ok = expectOk(validateRecord(B607, { value: '0607', policy: 'request_review' }));
    expect(ok.refusal).toBeTrue();
    expect(ok.origin).toBe('source');
  });

  it('填入 0102 → error codeMismatch', () => {
    expect(expectError(validateRecord(B607, { value: '0102' }))).toBe(VALIDATION_MESSAGES.codeMismatch);
  });

  it('少了前導零的 "607" → error codeMismatch', () => {
    expect(expectError(validateRecord(B607, { value: '607' }))).toBe(VALIDATION_MESSAGES.codeMismatch);
  });
});

describe('validateRecord：H17（不適用拒絕紀錄）', () => {
  it('"H-17" → ok、code "H-17"、refusal null、origin source', () => {
    const ok = expectOk(validateRecord(H17, { value: 'H-17' }));
    expect(ok.code).toBe('H-17');
    expect(ok.refusal).toBeNull();
    expect(ok.origin).toBe('source');
  });

  it('"h-17" → ok（忽略大小寫），code 仍回傳來源原字串 "H-17"', () => {
    const ok = expectOk(validateRecord(H17, { value: 'h-17' }));
    expect(ok.code).toBe('H-17');
    expect(ok.origin).toBe('source');
  });

  it('前後空白會被 trim', () => {
    const ok = expectOk(validateRecord(H17, { value: '  H-17 ' }));
    expect(ok.code).toBe('H-17');
  });

  it('填姓名 "林予安" → error codeMismatch（姓名不是輸入欄位）', () => {
    expect(expectError(validateRecord(H17, { value: '林予安' }))).toBe(VALIDATION_MESSAGES.codeMismatch);
  });

  it('空字串 → error codeRequired', () => {
    expect(expectError(validateRecord(H17, { value: '' }))).toBe(VALIDATION_MESSAGES.codeRequired);
  });

  it('"H17"（缺連字號）→ error codeMismatch', () => {
    expect(expectError(validateRecord(H17, { value: 'H17' }))).toBe(VALIDATION_MESSAGES.codeMismatch);
  });

  it('不適用拒絕紀錄者不受 policy 影響', () => {
    const ok = expectOk(validateRecord(H17, { value: 'H-17', policy: 'request_review' }));
    expect(ok.origin).toBe('source');
    expect(ok.refusal).toBeNull();
  });
});

describe('VALIDATION_MESSAGES', () => {
  it('只有三個鍵，且訊息不暗示道德立場', () => {
    expect(Object.keys(VALIDATION_MESSAGES).sort()).toEqual(['codeMismatch', 'codeRequired', 'policyRequired']);
    expect(VALIDATION_MESSAGES.codeRequired).toBe('請填寫人員編號。');
    expect(VALIDATION_MESSAGES.codeMismatch).toBe('請依來源資料填寫人員編號。');
  });
});

describe('toPreview', () => {
  it('review → destination review_queue', () => {
    expect(toPreview({ code: '0102', refusal: null, origin: 'review' })).toEqual({
      personnel_code: '0102',
      refusal_record: null,
      destination: 'review_queue',
    });
  });

  it('defaulted → destination archive', () => {
    expect(toPreview({ code: '0102', refusal: false, origin: 'defaulted' })).toEqual({
      personnel_code: '0102',
      refusal_record: false,
      destination: 'archive',
    });
  });

  it('source → destination archive', () => {
    expect(toPreview({ code: 'H-17', refusal: null, origin: 'source' }).destination).toBe('archive');
    expect(toPreview({ code: '0607', refusal: true, origin: 'source' }).destination).toBe('archive');
  });

  it('personnel_code 為字串且保留前導零', () => {
    const preview = toPreview({ code: '0102', refusal: false, origin: 'defaulted' });
    expect(typeof preview.personnel_code).toBe('string');
    expect(preview.personnel_code).toBe('0102');
    expect(JSON.parse(JSON.stringify(preview)).personnel_code).toBe('0102');
  });

  it('可直接接 validateRecord 的 ok 結果', () => {
    const ok = expectOk(validateRecord(B102, { value: '0102', policy: 'request_review' }));
    expect(toPreview(ok)).toEqual({ personnel_code: '0102', refusal_record: null, destination: 'review_queue' });
  });
});
