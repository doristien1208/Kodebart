import { FieldMapTaskPlan } from './day-plan';
import { affectedRowIds, checkFieldMap, convertRow } from './field-map';
import { MISSING_POLICIES } from './types';

/**
 * 欄位映射純規則（R6 Day 6／R10）。fixture 對照 doc/COLLABORATION.md：
 * 4 個目標欄位（其一為布林 有／無）、8 列資料，其中 4 列的布林來源為空字串。
 * R10：轉換、空白筆數與政策範圍一律依玩家的 assignments；target.sourceId 只是預設／作者參照。
 */

const PLAN: FieldMapTaskPlan = {
  id: 'task.day6.field-map',
  kind: 'field-map',
  sourceFieldIds: ['legacy-id', 'objection-reply', 'contact-result', 'record-date'],
  targets: [
    { id: 'personnel-code', sourceId: 'legacy-id', convert: 'text' },
    { id: 'exclude-flag', sourceId: 'objection-reply', convert: 'boolean', trueValue: '有', falseValue: '無' },
    { id: 'contact-status', sourceId: 'contact-result', convert: 'text' },
    { id: 'effective-date', sourceId: 'record-date', convert: 'text' },
  ],
  rows: [
    ['row.0102', '0102', '', '未接', '2026-09-16'],
    ['row.0314', '0314', '無', '已確認', '2026-09-17'],
    ['row.0521', '0521', '', '待回覆', '2026-09-17'],
    ['row.0716', '0716', '有', '已確認', '2026-09-18'],
    ['row.0905', '0905', '', '未接', '2026-09-18'],
    ['row.1013', '1013', '無', '待回覆', '2026-09-19'],
    ['row.1108', '1108', '無', '已確認', '2026-09-19'],
    ['row.1219', '1219', '', '未接', '2026-09-20'],
  ].map(([id, a, b, c, d]) => ({ id, values: { 'legacy-id': a, 'objection-reply': b, 'contact-result': c, 'record-date': d } })),
};

/** 作者預設的對應（= target.sourceId）；R10 起只是其中一種合法選擇。 */
const CORRECT: Readonly<Record<string, string>> = {
  'personnel-code': 'legacy-id',
  'exclude-flag': 'objection-reply',
  'contact-status': 'contact-result',
  'effective-date': 'record-date',
};
const BLANK_ROWS = ['row.0102', 'row.0521', 'row.0905', 'row.1219'];

/** 文字欄位間的意義配錯：聯絡結果與紀錄日期互換。 */
const TEXT_SWAP: Readonly<Record<string, string>> = {
  ...CORRECT,
  'contact-status': 'record-date',
  'effective-date': 'contact-result',
};

/** 多一個「全為 有／無、沒有空白」的來源欄位，用來驗證空白筆數依實際配對重算。 */
const PLAN_EXTRA: FieldMapTaskPlan = {
  ...PLAN,
  sourceFieldIds: [...PLAN.sourceFieldIds, 'callback-flag'],
  rows: PLAN.rows.map((r, i) => ({ id: r.id, values: { ...r.values, 'callback-flag': i % 2 === 0 ? '有' : '無' } })),
};

function without(target: string): Record<string, string> {
  const a = { ...CORRECT };
  delete a[target];
  return a;
}

describe('affectedRowIds（依玩家對應）', () => {
  it('作者預設對應：只算布林欄位為空的列：4 列，依資料順序', () => {
    expect(affectedRowIds(PLAN, CORRECT)).toEqual(BLANK_ROWS);
  });

  it('文字欄位的空字串不算受影響', () => {
    const plan: FieldMapTaskPlan = {
      ...PLAN,
      rows: [{ id: 'row.x', values: { 'legacy-id': '', 'objection-reply': '有', 'contact-result': '', 'record-date': '' } }],
    };
    expect(affectedRowIds(plan, CORRECT)).toEqual([]);
  });

  it('沒有布林目標時一律沒有受影響列', () => {
    expect(affectedRowIds({ ...PLAN, targets: PLAN.targets.filter((t) => t.convert === 'text') }, CORRECT)).toEqual([]);
  });

  it('布林目標改配沒有空白的欄位 → 沒有受影響列（不看 target.sourceId）', () => {
    expect(affectedRowIds(PLAN_EXTRA, { ...CORRECT, 'exclude-flag': 'callback-flag' })).toEqual([]);
  });

  it('布林目標尚未配對 → 讀到空白，每列都受影響', () => {
    expect(affectedRowIds(PLAN, without('exclude-flag'))).toEqual(PLAN.rows.map((r) => r.id));
  });
});

describe('convertRow（依玩家對應）', () => {
  const row = (id: string) => PLAN.rows.find((r) => r.id === id)!;

  it('有 → true、無 → false（與政策無關）', () => {
    for (const policy of [...MISSING_POLICIES, null]) {
      expect(convertRow(row('row.0716'), PLAN, CORRECT, policy)['exclude-flag']).toBeTrue();
      expect(convertRow(row('row.0314'), PLAN, CORRECT, policy)['exclude-flag']).toBeFalse();
    }
  });

  it('空值：default_false → false；request_review → null；沒有政策 → null', () => {
    expect(convertRow(row('row.0102'), PLAN, CORRECT, 'default_false')['exclude-flag']).toBeFalse();
    expect(convertRow(row('row.0102'), PLAN, CORRECT, 'request_review')['exclude-flag']).toBeNull();
    expect(convertRow(row('row.0102'), PLAN, CORRECT, null)['exclude-flag']).toBeNull();
  });

  it('文字欄位原字串保留：0102 的前導零不會消失，日期不轉型', () => {
    const out = convertRow(row('row.0102'), PLAN, CORRECT, 'default_false');
    expect(out).toEqual({ 'personnel-code': '0102', 'exclude-flag': false, 'contact-status': '未接', 'effective-date': '2026-09-16' });
    expect(typeof out['personnel-code']).toBe('string');
  });

  it('輸出鍵為目標欄位 id，依目標順序；不含來源欄位 id', () => {
    const out = convertRow(row('row.0314'), PLAN, CORRECT, null);
    expect(Object.keys(out)).toEqual(['personnel-code', 'exclude-flag', 'contact-status', 'effective-date']);
    for (const s of PLAN.sourceFieldIds) expect(s in out).toBeFalse();
  });

  it('文字欄位互換：輸出反映玩家的對應，不依 target.sourceId 矯正', () => {
    const out = convertRow(row('row.0102'), PLAN, TEXT_SWAP, 'default_false');
    expect(out['contact-status']).toBe('2026-09-16');
    expect(out['effective-date']).toBe('未接');
    expect(out['personnel-code']).toBe('0102');
  });

  it('文字目標配到含空白的布林來源欄位：原樣輸出空字串', () => {
    const a = { ...CORRECT, 'personnel-code': 'objection-reply', 'exclude-flag': 'callback-flag', 'contact-status': 'legacy-id' };
    const out = convertRow(PLAN_EXTRA.rows[0], PLAN_EXTRA, a, null);
    expect(out).toEqual({ 'personnel-code': '', 'exclude-flag': true, 'contact-status': '0102', 'effective-date': '2026-09-16' });
  });

  it('無法轉換的布林值（checkFieldMap 會先擋）→ 拋出，不會靜默當 null', () => {
    const odd = { id: 'row.odd', values: { ...row('row.0314').values, 'objection-reply': '不明' } };
    expect(() => convertRow(odd, PLAN, CORRECT, 'default_false')).toThrow();
    expect(() => convertRow(row('row.0102'), PLAN, { ...CORRECT, 'exclude-flag': 'contact-result' }, null)).toThrow();
  });
});

describe('checkFieldMap：錯誤', () => {
  it('完全沒選 → incomplete', () => {
    expect(checkFieldMap(PLAN, {}, 'default_false')).toEqual({ ok: false, error: 'incomplete' });
  });

  it('少一個目標 → incomplete；空字串視同未選', () => {
    for (const t of PLAN.targets) {
      expect(checkFieldMap(PLAN, without(t.id), 'default_false')).toEqual({ ok: false, error: 'incomplete' });
      expect(checkFieldMap(PLAN, { ...CORRECT, [t.id]: '' }, 'default_false')).toEqual({ ok: false, error: 'incomplete' });
    }
  });

  it('未知來源 id → incomplete（來源必須存在）', () => {
    expect(checkFieldMap(PLAN, { ...CORRECT, 'contact-status': 'unknown-source' }, 'default_false')).toEqual({ ok: false, error: 'incomplete' });
  });

  it('來源重複 → duplicate（一對一）', () => {
    expect(checkFieldMap(PLAN, { ...CORRECT, 'contact-status': 'legacy-id' }, 'default_false')).toEqual({ ok: false, error: 'duplicate' });
  });

  it('布林目標配到文字來源（含 未接／已確認）→ unconvertible', () => {
    const a = { ...CORRECT, 'exclude-flag': 'contact-result', 'contact-status': 'objection-reply' };
    expect(checkFieldMap(PLAN, a, 'default_false')).toEqual({ ok: false, error: 'unconvertible' });
    expect(checkFieldMap(PLAN, a, undefined)).toEqual({ ok: false, error: 'unconvertible' });
  });

  it('布林目標配到編號欄位（0102…）→ unconvertible', () => {
    const a = { ...CORRECT, 'exclude-flag': 'legacy-id', 'personnel-code': 'objection-reply' };
    expect(checkFieldMap(PLAN, a, 'request_review')).toEqual({ ok: false, error: 'unconvertible' });
  });

  it('只要有一列無法轉換就擋（其他列都是 有／無／空白）', () => {
    const plan: FieldMapTaskPlan = {
      ...PLAN,
      rows: [...PLAN.rows, { id: 'row.odd', values: { ...PLAN.rows[1].values, 'objection-reply': '不明' } }],
    };
    expect(checkFieldMap(plan, CORRECT, 'default_false')).toEqual({ ok: false, error: 'unconvertible' });
  });

  it('作者預設對應但有受影響列且沒選政策 → policyRequired', () => {
    expect(checkFieldMap(PLAN, CORRECT, undefined)).toEqual({ ok: false, error: 'policyRequired' });
  });

  it('錯誤順序：incomplete → duplicate → unconvertible → policyRequired', () => {
    // 同時缺欄且重複 → incomplete
    const missingAndDup = { ...without('effective-date'), 'contact-status': 'legacy-id' };
    expect(checkFieldMap(PLAN, missingAndDup, undefined)).toEqual({ ok: false, error: 'incomplete' });
    // 重複且布林無法轉換、也沒政策 → duplicate
    const dupAndBad = { ...CORRECT, 'exclude-flag': 'contact-result', 'contact-status': 'contact-result' };
    expect(checkFieldMap(PLAN, dupAndBad, undefined)).toEqual({ ok: false, error: 'duplicate' });
    // 無法轉換且沒政策 → unconvertible
    const bad = { ...CORRECT, 'exclude-flag': 'contact-result', 'contact-status': 'objection-reply' };
    expect(checkFieldMap(PLAN, bad, undefined)).toEqual({ ok: false, error: 'unconvertible' });
  });

  it('多餘的非目標鍵不影響判定（只看目標欄位）', () => {
    const extra = { ...CORRECT, 'not-a-target': 'legacy-id' };
    expect(checkFieldMap(PLAN, extra, 'default_false').ok).toBeTrue();
  });

  it('不改動傳入的 assignments 與 plan', () => {
    const a = { ...CORRECT };
    const before = JSON.stringify([a, PLAN]);
    checkFieldMap(PLAN, a, 'default_false');
    checkFieldMap(PLAN, {}, undefined);
    checkFieldMap(PLAN, { ...CORRECT, 'exclude-flag': 'contact-result', 'contact-status': 'objection-reply' }, undefined);
    expect(JSON.stringify([a, PLAN])).toBe(before);
  });
});

describe('checkFieldMap：通過', () => {
  for (const policy of MISSING_POLICIES) {
    it(`政策 ${policy} 合法：rowCount 8、affectedCount 4、blankPolicy ${policy}`, () => {
      const check = checkFieldMap(PLAN, CORRECT, policy);
      expect(check.ok).toBeTrue();
      if (!check.ok) return;
      const { result } = check;
      expect(result.rowCount).toBe(8);
      expect(result.affectedCount).toBe(4);
      expect(result.blankPolicy).toBe(policy);
      expect(result.rows.map((r) => r.id)).toEqual(PLAN.rows.map((r) => r.id));
      for (const r of result.rows) {
        const expected = BLANK_ROWS.includes(r.id) ? (policy === 'default_false' ? false : null) : r.id === 'row.0716';
        expect(r.values['exclude-flag']).withContext(r.id).toBe(expected);
        expect(r.values['personnel-code']).toBe(r.id.slice('row.'.length));
      }
      expect(result.rows[0].values['personnel-code']).toBe('0102');
    });
  }

  it('兩種政策只差在空值列的 exclude-flag；其餘欄位逐字相同', () => {
    const a = checkFieldMap(PLAN, CORRECT, 'default_false');
    const b = checkFieldMap(PLAN, CORRECT, 'request_review');
    if (!a.ok || !b.ok) return fail('both policies should pass');
    a.result.rows.forEach((row, i) => {
      const other = b.result.rows[i];
      for (const key of ['personnel-code', 'contact-status', 'effective-date']) expect(row.values[key]).toBe(other.values[key]);
      if (!BLANK_ROWS.includes(row.id)) expect(row.values['exclude-flag']).toBe(other.values['exclude-flag']);
    });
  });

  it('文字欄位間配錯（聯絡結果 ↔ 紀錄日期）可以提交，輸出反映互換', () => {
    const check = checkFieldMap(PLAN, TEXT_SWAP, 'default_false');
    expect(check.ok).toBeTrue();
    if (!check.ok) return;
    expect(check.result.affectedCount).toBe(4);
    expect(check.result.rows[0].values).toEqual({
      'personnel-code': '0102',
      'exclude-flag': false,
      'contact-status': '2026-09-16',
      'effective-date': '未接',
    });
    check.result.rows.forEach((r, i) => {
      expect(r.values['contact-status']).toBe(PLAN.rows[i].values['record-date']);
      expect(r.values['effective-date']).toBe(PLAN.rows[i].values['contact-result']);
    });
    const ref = checkFieldMap(PLAN, CORRECT, 'default_false');
    expect(ref.ok && JSON.stringify(ref.result) === JSON.stringify(check.result)).toBeFalse();
  });

  it('全部文字欄位輪換（布林欄位不變）也可提交', () => {
    const rotated = { ...CORRECT, 'personnel-code': 'record-date', 'contact-status': 'legacy-id', 'effective-date': 'contact-result' };
    const check = checkFieldMap(PLAN, rotated, 'request_review');
    expect(check.ok).toBeTrue();
    if (!check.ok) return;
    expect(check.result.rows[0].values).toEqual({
      'personnel-code': '2026-09-16',
      'exclude-flag': null,
      'contact-status': '0102',
      'effective-date': '未接',
    });
  });

  it('布林目標改配沒有空白的欄位 → affectedCount 0、不需政策、blankPolicy null', () => {
    const a = { ...CORRECT, 'exclude-flag': 'callback-flag' };
    const none = checkFieldMap(PLAN_EXTRA, a, undefined);
    expect(none.ok).toBeTrue();
    if (!none.ok) return;
    expect(none.result).toEqual(jasmine.objectContaining({ rowCount: 8, affectedCount: 0, blankPolicy: null }));
    none.result.rows.forEach((r, i) => expect(r.values['exclude-flag']).toBe(i % 2 === 0));
    // 即使選了政策也不套用
    const chosen = checkFieldMap(PLAN_EXTRA, a, 'default_false');
    expect(chosen.ok && chosen.result.blankPolicy).toBeNull();
    // 同一份 plan 用作者預設對應，仍是 4 列受影響、需要政策
    expect(checkFieldMap(PLAN_EXTRA, CORRECT, undefined)).toEqual({ ok: false, error: 'policyRequired' });
  });

  it('文字目標配到含空白的來源欄位，不計入受影響列', () => {
    const a = { ...CORRECT, 'exclude-flag': 'callback-flag', 'contact-status': 'objection-reply', 'effective-date': 'contact-result', 'personnel-code': 'record-date' };
    const check = checkFieldMap(PLAN_EXTRA, a, undefined);
    expect(check.ok).toBeTrue();
    if (!check.ok) return;
    expect(check.result.affectedCount).toBe(0);
    expect(check.result.rows[0].values['contact-status']).toBe('');
  });

  it('沒有受影響列時不需要政策，blankPolicy 記為 null（即使有選）', () => {
    const plan: FieldMapTaskPlan = { ...PLAN, rows: PLAN.rows.filter((r) => !BLANK_ROWS.includes(r.id)) };
    const none = checkFieldMap(plan, CORRECT, undefined);
    expect(none.ok).toBeTrue();
    if (!none.ok) return;
    expect(none.result).toEqual(jasmine.objectContaining({ rowCount: 4, affectedCount: 0, blankPolicy: null }));
    const chosen = checkFieldMap(plan, CORRECT, 'request_review');
    expect(chosen.ok && chosen.result.blankPolicy).toBeNull();
  });

  it('結果可 JSON 往返：null、false、"0102" 皆保留', () => {
    const check = checkFieldMap(PLAN, CORRECT, 'request_review');
    const restored = JSON.parse(JSON.stringify(check));
    expect(restored).toEqual(check);
    expect(restored.result.rows[0].values).toEqual({ 'personnel-code': '0102', 'exclude-flag': null, 'contact-status': '未接', 'effective-date': '2026-09-16' });
  });
});
