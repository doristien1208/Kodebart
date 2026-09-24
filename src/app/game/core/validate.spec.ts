import { SourceRecord, ValidationOk, ValidationResult } from './types';
import { PLAYER_NAME_MAX, VALIDATION_MESSAGES, graphemeLength, isValidCodeString, normalizePlayerName, toPreview, validateRecord } from './validate';

/**
 * 人員編號的規則（R10）：只驗型別與必填（文字、非空白），照玩家輸入原樣保存。
 * 不比對來源、不檢查是否為已知人員、不限長度或前綴；不 trim、不補零、不轉數字、不改大小寫。
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

describe('isValidCodeString（R10）', () => {
  for (const value of ['0102', '102', '0103', '  x ', 'H-17', 'h-17', '林予安', '１０２', '99999999999999999999', '-102']) {
    it(`合法：${JSON.stringify(value)}`, () => {
      expect(isValidCodeString(value)).toBeTrue();
    });
  }

  for (const [label, value] of [
    ['number 102', 102],
    ['null', null],
    ['undefined', undefined],
    ["''", ''],
    ["'   '", '   '],
    ['tab／換行', '\t\n'],
    ['物件', { code: '0102' }],
    ['陣列', ['0102']],
    ['true', true],
  ] as [string, unknown][]) {
    it(`不合法：${label}`, () => {
      expect(isValidCodeString(value)).toBeFalse();
    });
  }
});

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

  it('只有空白 "   " → error codeRequired（純空白視為未填）', () => {
    expect(expectError(validateRecord(B102, { value: '   ', policy: 'default_false' }))).toBe(
      VALIDATION_MESSAGES.codeRequired,
    );
  });

  for (const value of ['0102', '102', '0103', '  x ', ' 0102 ', '0607', 'abc', '１０２', '0102x', '01020', 'NaN', '1e2', '102.5', '-102', '友善的人']) {
    it(`來源 "0102"、輸入 ${JSON.stringify(value)} → ok，原樣保存（不 trim、不補零、不換成來源）`, () => {
      const ok = expectOk(validateRecord(B102, { value, policy: 'default_false' }));
      expect(typeof ok.code).toBe('string');
      expect(ok.code).toBe(value);
      expect(ok.refusal).toBeFalse();
      expect(ok.origin).toBe('defaulted');
    });
  }

  it('與來源相同或不同走同一條成功流程（結果結構一致，只差 code）', () => {
    const same = expectOk(validateRecord(B102, { value: '0102', policy: 'request_review' }));
    const diff = expectOk(validateRecord(B102, { value: '102', policy: 'request_review' }));
    expect({ ...same, code: 'x' }).toEqual({ ...diff, code: 'x' });
    expect(diff.code).toBe('102');
  });

  it('超長數字字串 → ok 原樣保存，不會拋例外也不轉數字', () => {
    const ok = expectOk(validateRecord(B102, { value: '99999999999999999999', policy: 'default_false' }));
    expect(ok.code).toBe('99999999999999999999');
  });

  for (const [label, value] of [
    ['number 102', 102],
    ['null', null],
    ['物件', { v: '0102' }],
  ] as [string, unknown][]) {
    it(`非文字型別（${label}）→ error codeRequired`, () => {
      expect(expectError(validateRecord(B102, { value: value as string, policy: 'default_false' }))).toBe(
        VALIDATION_MESSAGES.codeRequired,
      );
    });
  }

  it('編號錯誤時先報 codeRequired，不會先要求 policy；非來源編號缺 policy 仍報 policyRequired', () => {
    expect(expectError(validateRecord(B102, { value: '' }))).toBe(VALIDATION_MESSAGES.codeRequired);
    expect(expectError(validateRecord(B102, { value: '   ' }))).toBe(VALIDATION_MESSAGES.codeRequired);
    expect(expectError(validateRecord(B102, { value: '102' }))).toBe(VALIDATION_MESSAGES.policyRequired);
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

  it('填入 "0102"（別人的編號）→ ok 原樣保存', () => {
    const ok = expectOk(validateRecord(B607, { value: '0102' }));
    expect(ok.code).toBe('0102');
    expect(ok.refusal).toBeTrue();
  });

  it('少了前導零的 "607" → ok 原樣保存', () => {
    expect(expectOk(validateRecord(B607, { value: '607' })).code).toBe('607');
  });
});

describe('validateRecord：H17（不適用拒絕紀錄）', () => {
  it('"H-17" → ok、code "H-17"、refusal null、origin source', () => {
    const ok = expectOk(validateRecord(H17, { value: 'H-17' }));
    expect(ok.code).toBe('H-17');
    expect(ok.refusal).toBeNull();
    expect(ok.origin).toBe('source');
  });

  it('"h-17" → ok，大小寫原樣保存（不改成來源 "H-17"）', () => {
    const ok = expectOk(validateRecord(H17, { value: 'h-17' }));
    expect(ok.code).toBe('h-17');
    expect(ok.origin).toBe('source');
  });

  it('前後空白原樣保存（不 trim）', () => {
    const ok = expectOk(validateRecord(H17, { value: '  H-17 ' }));
    expect(ok.code).toBe('  H-17 ');
  });

  it('填姓名 "林予安" → ok 原樣保存（不檢查是否為已知人員）', () => {
    expect(expectOk(validateRecord(H17, { value: '林予安' })).code).toBe('林予安');
  });

  it('空字串 → error codeRequired', () => {
    expect(expectError(validateRecord(H17, { value: '' }))).toBe(VALIDATION_MESSAGES.codeRequired);
  });

  it('"H17"（缺連字號）→ ok 原樣保存', () => {
    expect(expectOk(validateRecord(H17, { value: 'H17' })).code).toBe('H17');
  });

  it('不適用拒絕紀錄者不受 policy 影響', () => {
    const ok = expectOk(validateRecord(H17, { value: 'H-17', policy: 'request_review' }));
    expect(ok.origin).toBe('source');
    expect(ok.refusal).toBeNull();
  });
});

describe('VALIDATION_MESSAGES', () => {
  it('只有兩個鍵（codeMismatch 已移除），且訊息不暗示道德立場', () => {
    expect(Object.keys(VALIDATION_MESSAGES).sort()).toEqual(['codeRequired', 'policyRequired']);
    expect(VALIDATION_MESSAGES.codeRequired).toBe('請填寫人員編號。');
    expect(VALIDATION_MESSAGES.policyRequired).toBe('請選擇缺少拒絕紀錄時的處理方式。');
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

/* ---------- 角色名（R12 入職簽名） ---------- */

/** 測試用字元：家庭 ZWJ 表情（4 個人＋3 個 ZWJ，一個字素）、組合字（e＋U+0301，一個字素）、旗幟（兩個區域指示符）。 */
const ZWJ_FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
const E_ACUTE_COMBINING = 'e\u0301';
const FLAG_TW = '\u{1F1F9}\u{1F1FC}';

describe('graphemeLength（使用者可見字元數）', () => {
  it('一般中英文：每個字一個', () => {
    expect(graphemeLength('')).toBe(0);
    expect(graphemeLength('林予安')).toBe(3);
    expect(graphemeLength('Ada Lovelace')).toBe(12);
  });

  it('表情 ZWJ 序列、組合字、旗幟、膚色修飾都算一個', () => {
    expect(ZWJ_FAMILY.length).toBe(11);
    expect(graphemeLength(ZWJ_FAMILY)).toBe(1);
    expect(graphemeLength(E_ACUTE_COMBINING)).toBe(1);
    expect(graphemeLength(FLAG_TW)).toBe(1);
    expect(graphemeLength('\u{1F44D}\u{1F3FD}')).toBe(1);
    expect(graphemeLength(`${ZWJ_FAMILY}${E_ACUTE_COMBINING}林`)).toBe(3);
  });

  it('沒有 Intl.Segmenter 的環境退回以 code point 計（組合字不會被當成 UTF-16 兩個單位）', () => {
    const intl = Intl as unknown as { Segmenter?: unknown };
    const original = intl.Segmenter;
    try {
      intl.Segmenter = undefined;
      expect(graphemeLength('林予安')).toBe(3);
      expect(graphemeLength('\u{1F600}')).toBe(1);
      expect(graphemeLength(E_ACUTE_COMBINING)).toBe(2);
    } finally {
      intl.Segmenter = original;
    }
    expect(graphemeLength(E_ACUTE_COMBINING)).toBe(1);
  });
});

describe('normalizePlayerName（R12 簽名規則）', () => {
  it('PLAYER_NAME_MAX 為 24', () => {
    expect(PLAYER_NAME_MAX).toBe(24);
  });

  it('去除首尾空白後保存；中間空白、大小寫、全形字元原樣保留', () => {
    expect(normalizePlayerName('  林予安  ')).toBe('林予安');
    expect(normalizePlayerName('\u3000王小明\u3000')).toBe('王小明');
    expect(normalizePlayerName(' Ada  Lovelace ')).toBe('Ada  Lovelace');
    expect(normalizePlayerName('ＡＢＣ')).toBe('ＡＢＣ');
    expect(normalizePlayerName('mixed Case')).toBe('mixed Case');
  });

  it('中文、英文、數字、符號都可以（不套人員編號格式）', () => {
    for (const name of ['林', '陳大文', 'Kim', 'A-17', '0102', '王．小明', "O'Brien"]) {
      expect(normalizePlayerName(name)).withContext(name).toBe(name);
    }
  });

  it('必填：空字串、純空白（含全形空白）→ null', () => {
    for (const raw of ['', ' ', '   ', '\u3000', ' \u3000 ']) expect(normalizePlayerName(raw)).withContext(JSON.stringify(raw)).toBeNull();
  });

  it('長度以字素計：24 個可以、25 個不行（去除首尾空白後計）', () => {
    expect(normalizePlayerName('林'.repeat(24))).toBe('林'.repeat(24));
    expect(normalizePlayerName('林'.repeat(25))).toBeNull();
    expect(normalizePlayerName(`  ${'a'.repeat(24)}  `)).toBe('a'.repeat(24));
    expect(normalizePlayerName('a'.repeat(25))).toBeNull();
  });

  it('表情 ZWJ 序列與組合字各算一個：24 個家庭表情可以（UTF-16 長度遠超 24）、25 個不行', () => {
    const family24 = ZWJ_FAMILY.repeat(24);
    expect(family24.length).toBe(264);
    expect(normalizePlayerName(family24)).toBe(family24);
    expect(normalizePlayerName(ZWJ_FAMILY.repeat(25))).toBeNull();
    const combining24 = E_ACUTE_COMBINING.repeat(24);
    expect(normalizePlayerName(combining24)).toBe(combining24);
    expect(normalizePlayerName(E_ACUTE_COMBINING.repeat(25))).toBeNull();
    expect(normalizePlayerName(`${'林'.repeat(23)}${ZWJ_FAMILY}`)).toBe(`${'林'.repeat(23)}${ZWJ_FAMILY}`);
    expect(normalizePlayerName(`${'林'.repeat(24)}${FLAG_TW}`)).toBeNull();
  });

  it('控制字元（換行、Tab、NUL、DEL、C1、行／段分隔）一律拒絕，即使在中間', () => {
    for (const bad of ['林\n予安', '林\t予安', '林\u0000', '\u0007林', '林\u007f', '林\u0085安', '林\u009f', '林\u2028安', '林\u2029安', '林\r安']) {
      expect(normalizePlayerName(bad)).withContext(JSON.stringify(bad)).toBeNull();
    }
  });

  it('首尾的換行／Tab 屬於空白，會被去除（去除後不含控制字元即可）', () => {
    expect(normalizePlayerName('\n林予安\t')).toBe('林予安');
  });

  it('非字串 → null', () => {
    for (const raw of [null, undefined, 0, 123, true, {}, [], ['林']]) expect(normalizePlayerName(raw)).withContext(String(raw)).toBeNull();
  });

  it('像 HTML 的文字也只是文字（原樣保存，由畫面以插值顯示）', () => {
    expect(normalizePlayerName('<b>林</b>')).toBe('<b>林</b>');
  });
});
