import { RECORDS } from '../content/records';
import { rand } from './rand';
import {
  EVENT_IDS,
  INTERVENTION_THRESHOLD,
  advanceToDay2,
  allArchived,
  archivedCount,
  canReply,
  commitArchive,
  completeDay1,
  createSave,
  isArranged,
  isArrangedInSave,
  markReceiptOpened,
  markReportOpened,
  resolveNight,
  setDraft,
  submitReply,
  withEvent,
} from './rules';
import { isValidSave } from './save-schema';
import {
  ArchivedRecord,
  Draft,
  MISSING_POLICIES,
  MissingPolicy,
  NightResult,
  REPLIES,
  RecordKey,
  Reply,
  SAVE_VERSION,
  SaveV2,
  SourceRecord,
  ValidationOk,
} from './types';
import { validateRecord } from './validate';

/* ---------- 測試輔助：用真正的 validateRecord 產生 ok 結果，走完整流程 ---------- */

function record(key: RecordKey): SourceRecord {
  const r = RECORDS.find((x) => x.key === key);
  if (!r) throw new Error(`Unknown record ${key}`);
  return r;
}

function okFor(key: RecordKey, draft: Draft): ValidationOk {
  const r = validateRecord(record(key), draft);
  if (!r.ok) throw new Error(`validation failed for ${key}: ${r.error}`);
  return r;
}

function archiveAll(save: SaveV2, b102Policy: MissingPolicy): SaveV2 {
  let s = save;
  s = setDraft(s, 'H17', { value: 'H-17' });
  s = commitArchive(s, 'H17', okFor('H17', s.drafts['H17']!));
  s = setDraft(s, 'B102', { value: '0102', policy: b102Policy });
  s = commitArchive(s, 'B102', okFor('B102', s.drafts['B102']!));
  s = setDraft(s, 'B607', { value: '0607' });
  s = commitArchive(s, 'B607', okFor('B607', s.drafts['B607']!));
  return s;
}

function playToOvernight(seed: number, b102Policy: MissingPolicy): SaveV2 {
  return completeDay1(archiveAll(createSave(seed), b102Policy), RECORDS);
}

function playToDay2(seed: number, b102Policy: MissingPolicy): SaveV2 {
  return advanceToDay2(playToOvernight(seed, b102Policy));
}

function playFull(seed: number, b102Policy: MissingPolicy, reply: Reply): SaveV2 {
  let s = playToDay2(seed, b102Policy);
  s = markReportOpened(s);
  s = markReceiptOpened(s);
  return submitReply(s, reply);
}

const archivedAll: Required<SaveV2['archived']> = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source' },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' },
  B607: { archiveCode: '0607', refusal: true, origin: 'source' },
};

/** 黃金值：seed 42 介入（rand 0.2928 < 0.45）、seed 1 不介入（0.4957）。 */
const SEED_INTERVENE = 42;
const SEED_NO_INTERVENE = 1;

/* ---------- 四格矩陣（verify-core 第 28–33 行；Spec §5） ---------- */

describe('isArranged 四格矩陣', () => {
  const matrix: Array<[boolean | null, boolean, boolean]> = [
    [false, false, true],
    [false, true, true],
    [null, false, false],
    [null, true, true],
  ];

  for (const [refusal, intervention, expected] of matrix) {
    it(`isArranged(${refusal}, ${intervention}) → ${expected}`, () => {
      expect(isArranged(refusal, intervention)).toBe(expected);
    });

    it(`isArrangedInSave：B102.refusal=${refusal}、night.intervention=${intervention} → ${expected}`, () => {
      const b102: ArchivedRecord =
        refusal === false
          ? { archiveCode: '0102', refusal: false, origin: 'defaulted' }
          : { archiveCode: '0102', refusal: null, origin: 'review' };
      const save: SaveV2 = {
        ...createSave(7),
        phase: 'day2',
        archived: { ...archivedAll, B102: b102 },
        night: { intervention, smallTalkVariant: 0, reportRevision: intervention ? 2 : 1 },
      };
      expect(isValidSave(save, RECORDS)).toBeTrue();
      expect(isArrangedInSave(save)).toBe(expected);
    });
  }

  it('isArrangedInSave：尚無 B102 與 night 時視為 null／無介入 → false', () => {
    expect(isArrangedInSave(createSave(1))).toBeFalse();
  });

  it('isArrangedInSave：B102 false 但 night 尚未判定 → true', () => {
    const save = archiveAll(createSave(1), 'default_false');
    expect(save.night).toBeUndefined();
    expect(isArrangedInSave(save)).toBeTrue();
  });

  it('實際流程：default_false 恒為已列入安排；request_review 依夜間介入而定（seed 1..50）', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const fixed = playToDay2(seed, 'default_false');
      expect(isArrangedInSave(fixed)).toBeTrue();
      const held = playToDay2(seed, 'request_review');
      expect(isArrangedInSave(held)).toBe(held.night!.intervention);
    }
  });

  it('Spec §5 結果矩陣的四個格子都能由實際流程產生', () => {
    const ff = playToDay2(SEED_NO_INTERVENE, 'default_false');
    expect(ff.night!.intervention).toBeFalse();
    expect(ff.night!.reportRevision).toBe(1);
    expect(isArrangedInSave(ff)).toBeTrue();

    const ft = playToDay2(SEED_INTERVENE, 'default_false');
    expect(ft.night!.intervention).toBeTrue();
    expect(ft.night!.reportRevision).toBe(2);
    expect(isArrangedInSave(ft)).toBeTrue();

    const nf = playToDay2(SEED_NO_INTERVENE, 'request_review');
    expect(nf.night!.intervention).toBeFalse();
    expect(nf.night!.reportRevision).toBe(1);
    expect(isArrangedInSave(nf)).toBeFalse();

    const nt = playToDay2(SEED_INTERVENE, 'request_review');
    expect(nt.night!.intervention).toBeTrue();
    expect(nt.night!.reportRevision).toBe(2);
    expect(isArrangedInSave(nt)).toBeTrue();
  });
});

/* ---------- 夜間判定 ---------- */

describe('resolveNight', () => {
  it('同 seed 可重現', () => {
    expect(resolveNight(42)).toEqual(resolveNight(42));
    expect(resolveNight(999)).toEqual(resolveNight(999));
  });

  it('seed 42 → 介入、variant 1、revision 2（黃金值）', () => {
    expect(resolveNight(SEED_INTERVENE)).toEqual({ intervention: true, smallTalkVariant: 1, reportRevision: 2 });
  });

  it('seed 1 → 不介入、revision 1（黃金值）', () => {
    const n = resolveNight(SEED_NO_INTERVENE);
    expect(n.intervention).toBeFalse();
    expect(n.reportRevision).toBe(1);
  });

  it('seed 1..1000：reportRevision === (intervention ? 2 : 1)、variant ∈ {0,1}、與 rand 門檻一致、兩種結果皆出現', () => {
    let yes = 0;
    let no = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const n = resolveNight(seed);
      expect(n.reportRevision).toBe(n.intervention ? 2 : 1);
      expect([0, 1]).toContain(n.smallTalkVariant);
      expect(n.intervention).toBe(rand(seed, EVENT_IDS.nightIntervention) < INTERVENTION_THRESHOLD);
      expect(n.smallTalkVariant).toBe(Math.floor(rand(seed, EVENT_IDS.nightSmallTalk) * 2));
      if (n.intervention) yes++;
      else no++;
    }
    expect(yes).toBeGreaterThan(0);
    expect(no).toBeGreaterThan(0);
  });

  it('intervention 與 smallTalk 用不同 eventId', () => {
    expect(EVENT_IDS.nightIntervention).not.toBe(EVENT_IDS.nightSmallTalk);
    expect(INTERVENTION_THRESHOLD).toBe(0.45);
  });
});

/* ---------- 編號逐字保存 ---------- */

describe('歸檔編號保留前導零', () => {
  it('commitArchive 後 B102.archiveCode 為 "0102"，JSON 往返後仍是 "0102"', () => {
    const save = commitArchive(createSave(42), 'B102', okFor('B102', { value: '0102', policy: 'default_false' }));
    expect(save.archived['B102']!.archiveCode).toBe('0102');
    expect(typeof save.archived['B102']!.archiveCode).toBe('string');

    const restored = JSON.parse(JSON.stringify(save)) as SaveV2;
    expect(restored.archived['B102']!.archiveCode).toBe('0102');
    expect(typeof restored.archived['B102']!.archiveCode).toBe('string');
    expect(isValidSave(restored, RECORDS)).toBeTrue();
  });

  it('三筆齊時各自寫入來源原字串編號', () => {
    const s = archiveAll(createSave(1), 'default_false');
    expect(s.archived['H17']!.archiveCode).toBe('H-17');
    expect(s.archived['B102']!.archiveCode).toBe('0102');
    expect(s.archived['B607']!.archiveCode).toBe('0607');
    expect(s.archived).toEqual(archivedAll);
  });
});

/* ---------- 高筆數資料集合（KB-P1-02）：純函式不得假設「剛好三筆」 ---------- */

/**
 * 只在測試內使用的臨時假資料集合，用來證明規則由集合長度驅動。
 * 不寫入 content/records.ts，也不代表任何人物或案件。
 */
function fakeRecords(n: number): readonly SourceRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `T${i + 1}`,
    name: i % 3 === 0 ? null : `測試對象 ${i + 1}`,
    code: String(i + 1).padStart(4, '0'),
    refusal: null,
    refusalApplies: false,
  }));
}

/** 依任意集合逐筆走完整驗證＋提交流程；一律附 policy，適用缺值的那幾筆才會用到。 */
function archiveEvery(save: SaveV2, records: readonly SourceRecord[]): SaveV2 {
  let s = save;
  for (const r of records) {
    s = setDraft(s, r.key, { value: r.code, policy: 'default_false' });
    const v = validateRecord(r, s.drafts[r.key]!);
    if (!v.ok) throw new Error(`validation failed for ${r.key}: ${v.error}`);
    s = commitArchive(s, r.key, v);
  }
  return s;
}

describe('筆數由資料集合決定（4–12 筆假集合）', () => {
  for (const n of [4, 7, 12]) {
    it(`${n} 筆：archivedCount 逐筆遞增，allArchived 只在最後一筆後為 true`, () => {
      const records = fakeRecords(n);
      let s = createSave(1);
      expect(archivedCount(s)).toBe(0);
      expect(allArchived(s, records)).toBeFalse();

      records.forEach((r, i) => {
        s = archiveEvery(s, [r]);
        expect(archivedCount(s)).toBe(i + 1);
        expect(allArchived(s, records)).toBe(i === n - 1);
      });

      expect(archivedCount(s)).toBe(n);
      expect(allArchived(s, records)).toBeTrue();
      expect(isValidSave(s, records)).toBeTrue();
    });

    it(`${n} 筆：完成全部後 completeDay1 進 overnight，且存檔通過 schema`, () => {
      const records = fakeRecords(n);
      const full = archiveEvery(createSave(3), records);
      const next = completeDay1(full, records);
      expect(next).not.toBe(full);
      expect(next.phase).toBe('overnight');
      expect(isValidSave(next, records)).toBeTrue();
    });
  }

  it('allArchived 不是「數量夠了」：湊到 12 筆但少一個鍵仍為 false', () => {
    const records = fakeRecords(12);
    const partial = archiveEvery(createSave(1), records.slice(0, 11));
    // 數量湊到 12，但第 12 個鍵沒歸檔。
    const padded: SaveV2 = {
      ...partial,
      archived: { ...partial.archived, EXTRA: { archiveCode: '9999', refusal: null, origin: 'source' } },
    };
    expect(archivedCount(padded)).toBe(12);
    expect(allArchived(padded, records)).toBeFalse();
    expect(isValidSave(padded, records)).toBeFalse();
  });

  it('RecordKey 放寬為 string 後，isValidSave 仍拒絕不在集合內的 key', () => {
    const records = fakeRecords(12);
    const unknown: SaveV2 = {
      ...createSave(1),
      archived: { UNKNOWN: { archiveCode: '0001', refusal: null, origin: 'source' } },
    };
    expect(isValidSave(unknown, records)).toBeFalse();
    expect(isValidSave(unknown, RECORDS)).toBeFalse();
    // 同一筆資料放回它自己的集合就合法，證明拒絕的原因是「不在集合內」而非結構。
    const known: SaveV2 = {
      ...createSave(1),
      archived: { T1: { archiveCode: '0001', refusal: null, origin: 'source' } },
    };
    expect(isValidSave(known, records)).toBeTrue();
    expect(isValidSave(known, RECORDS)).toBeFalse();
  });

  it('目前的 RECORDS 只是其中一種長度：規則對它與假集合一致', () => {
    const real = archiveEvery(createSave(5), RECORDS);
    expect(archivedCount(real)).toBe(RECORDS.length);
    expect(allArchived(real, RECORDS)).toBeTrue();
    expect(isValidSave(real, RECORDS)).toBeTrue();
  });
});

describe('archivedCount／allArchived', () => {
  it('空存檔 0、未齊 false；三筆齊 3、true', () => {
    const s0 = createSave(1);
    expect(archivedCount(s0)).toBe(0);
    expect(allArchived(s0, RECORDS)).toBeFalse();
    const s1 = commitArchive(s0, 'B607', okFor('B607', { value: '0607' }));
    expect(archivedCount(s1)).toBe(1);
    expect(allArchived(s1, RECORDS)).toBeFalse();
    const s3 = archiveAll(createSave(1), 'default_false');
    expect(archivedCount(s3)).toBe(3);
    expect(allArchived(s3, RECORDS)).toBeTrue();
  });
});

/* ---------- 狀態轉移 ---------- */

describe('createSave', () => {
  it('phase day1、空 archived／drafts／events、evidence 皆 false', () => {
    expect(createSave(42)).toEqual({
      version: SAVE_VERSION,
      seed: 42,
      phase: 'day1',
      archived: {},
      drafts: {},
      events: [],
      evidence: { reportOpened: false, receiptOpened: false },
    });
    expect(createSave(42).night).toBeUndefined();
    expect(createSave(42).reply).toBeUndefined();
  });

  it('新存檔通過 schema 檢查', () => {
    expect(isValidSave(createSave(0), RECORDS)).toBeTrue();
  });
});

describe('withEvent', () => {
  it('附加事件、id 為 kind:index、不改原物件', () => {
    const s = createSave(1);
    const a = withEvent(s, 'x', { n: 1 });
    const b = withEvent(a, 'y', null);
    expect(s.events).toEqual([]);
    expect(a.events).toEqual([{ id: 'x:0', kind: 'x', payload: { n: 1 } }]);
    expect(b.events).toEqual([
      { id: 'x:0', kind: 'x', payload: { n: 1 } },
      { id: 'y:1', kind: 'y', payload: null },
    ]);
  });
});

describe('setDraft', () => {
  it('不改原物件；新物件有草稿', () => {
    const s = createSave(1);
    const next = setDraft(s, 'B102', { value: '0102', policy: 'request_review' });
    expect(next).not.toBe(s);
    expect(s.drafts).toEqual({});
    expect(next.drafts['B102']).toEqual({ value: '0102', policy: 'request_review' });
    expect(next.archived).toBe(s.archived);
  });

  it('覆寫同 key 草稿、保留其他 key', () => {
    const s = setDraft(setDraft(createSave(1), 'H17', { value: '林' }), 'B102', { value: '01' });
    const next = setDraft(s, 'B102', { value: '0102' });
    expect(next.drafts).toEqual({ H17: { value: '林' }, B102: { value: '0102' } });
  });
});

describe('commitArchive', () => {
  const base = createSave(42);
  const ok = okFor('B102', { value: '0102', policy: 'default_false' });
  const committed = commitArchive(base, 'B102', ok);

  it('成功寫入並推一個 archive 事件', () => {
    expect(committed).not.toBe(base);
    expect(base.archived).toEqual({});
    expect(committed.archived['B102']).toEqual({ archiveCode: '0102', refusal: false, origin: 'defaulted' });
    expect(committed.events).toEqual([{ id: 'archive:0', kind: 'archive', payload: { key: 'B102', origin: 'defaulted' } }]);
    expect(committed.phase).toBe('day1');
  });

  it('重複 commit 同 key 回傳同一物件（不重複、不覆寫）', () => {
    const again = commitArchive(committed, 'B102', okFor('B102', { value: '0102', policy: 'request_review' }));
    expect(again).toBe(committed);
    expect(again.archived['B102']!.refusal).toBeFalse();
    expect(again.events.length).toBe(1);
  });

  it('phase 非 day1 時忽略', () => {
    const overnight: SaveV2 = { ...createSave(1), phase: 'overnight' };
    expect(commitArchive(overnight, 'H17', okFor('H17', { value: 'H-17' }))).toBe(overnight);
    const day2 = playToDay2(1, 'default_false');
    expect(commitArchive(day2, 'H17', okFor('H17', { value: 'H-17' }))).toBe(day2);
  });

  it('review 結果寫入 refusal null／origin review', () => {
    const held = commitArchive(base, 'B102', okFor('B102', { value: '0102', policy: 'request_review' }));
    expect(held.archived['B102']).toEqual({ archiveCode: '0102', refusal: null, origin: 'review' });
    expect(held.events[0].payload).toEqual({ key: 'B102', origin: 'review' });
  });
});

describe('completeDay1', () => {
  it('未齊三筆回傳原物件', () => {
    const s0 = createSave(1);
    expect(completeDay1(s0, RECORDS)).toBe(s0);
    const s2 = commitArchive(
      commitArchive(s0, 'H17', okFor('H17', { value: 'H-17' })),
      'B607',
      okFor('B607', { value: '0607' }),
    );
    expect(completeDay1(s2, RECORDS)).toBe(s2);
  });

  it('齊了 → phase overnight 並推 day1.complete 事件', () => {
    const s = archiveAll(createSave(1), 'request_review');
    const next = completeDay1(s, RECORDS);
    expect(next).not.toBe(s);
    expect(s.phase).toBe('day1');
    expect(next.phase).toBe('overnight');
    expect(next.events.length).toBe(s.events.length + 1);
    expect(next.events[next.events.length - 1]).toEqual({ id: 'day1.complete:3', kind: 'day1.complete', payload: {} });
    expect(next.night).toBeUndefined();
    expect(isValidSave(next, RECORDS)).toBeTrue();
  });

  it('phase 非 day1 時忽略', () => {
    const overnight = playToOvernight(1, 'default_false');
    expect(completeDay1(overnight, RECORDS)).toBe(overnight);
  });
});

describe('advanceToDay2', () => {
  it('從 overnight → day2 並寫入 night 與 night.resolved 事件', () => {
    const overnight = playToOvernight(SEED_INTERVENE, 'default_false');
    const day2 = advanceToDay2(overnight);
    expect(day2).not.toBe(overnight);
    expect(overnight.phase).toBe('overnight');
    expect(overnight.night).toBeUndefined();
    expect(day2.phase).toBe('day2');
    expect(day2.night).toEqual(resolveNight(SEED_INTERVENE));
    expect(day2.events.length).toBe(overnight.events.length + 1);
    const last = day2.events[day2.events.length - 1];
    expect(last.kind).toBe('night.resolved');
    expect(last.payload).toEqual(resolveNight(SEED_INTERVENE));
    expect(isValidSave(day2, RECORDS)).toBeTrue();
  });

  it('night 已存在則不重算：內容相同且沒有新增 night.resolved 事件', () => {
    // 故意塞一個與 resolveNight(42) 不同的 night，證明沒有重擲。
    const preset: NightResult = { intervention: false, smallTalkVariant: 0, reportRevision: 1 };
    expect(preset).not.toEqual(resolveNight(SEED_INTERVENE));
    const overnight: SaveV2 = { ...playToOvernight(SEED_INTERVENE, 'default_false'), night: preset };
    const day2 = advanceToDay2(overnight);
    expect(day2.phase).toBe('day2');
    expect(day2.night).toBe(preset);
    expect(day2.night).toEqual({ intervention: false, smallTalkVariant: 0, reportRevision: 1 });
    expect(day2.events).toEqual(overnight.events);
    expect(day2.events.some((e) => e.kind === 'night.resolved')).toBeFalse();
  });

  it('phase 非 overnight 時忽略', () => {
    const day1 = createSave(1);
    expect(advanceToDay2(day1)).toBe(day1);
    const day2 = playToDay2(1, 'default_false');
    expect(advanceToDay2(day2)).toBe(day2);
    const end = playFull(1, 'default_false', 'ack');
    expect(advanceToDay2(end)).toBe(end);
  });
});

describe('markReportOpened／markReceiptOpened', () => {
  it('設 true 且不改原物件', () => {
    const s = createSave(1);
    const r = markReportOpened(s);
    expect(s.evidence.reportOpened).toBeFalse();
    expect(r.evidence).toEqual({ reportOpened: true, receiptOpened: false });
    const rr = markReceiptOpened(r);
    expect(rr.evidence).toEqual({ reportOpened: true, receiptOpened: true });
    expect(r.evidence.receiptOpened).toBeFalse();
  });

  it('已 true 時回傳原物件', () => {
    const r = markReportOpened(createSave(1));
    expect(markReportOpened(r)).toBe(r);
    const rr = markReceiptOpened(r);
    expect(markReceiptOpened(rr)).toBe(rr);
  });
});

describe('canReply／submitReply', () => {
  const day2 = playToDay2(SEED_INTERVENE, 'request_review');

  it('未開摘要 → 三種皆 false', () => {
    for (const reply of REPLIES) expect(canReply(day2, reply)).toBeFalse();
  });

  it('開摘要未開副本 → ack／ask true、review false', () => {
    const s = markReportOpened(day2);
    expect(canReply(s, 'ack')).toBeTrue();
    expect(canReply(s, 'ask')).toBeTrue();
    expect(canReply(s, 'review')).toBeFalse();
  });

  it('只開副本未開摘要 → 三種皆 false', () => {
    const s = markReceiptOpened(day2);
    for (const reply of REPLIES) expect(canReply(s, reply)).toBeFalse();
  });

  it('皆開 → 三者 true', () => {
    const s = markReceiptOpened(markReportOpened(day2));
    for (const reply of REPLIES) expect(canReply(s, reply)).toBeTrue();
  });

  it('submit 後 phase end、reply 設定、推 day2.reply 事件；再 submit 回傳原物件', () => {
    const ready = markReceiptOpened(markReportOpened(day2));
    const end = submitReply(ready, 'review');
    expect(end).not.toBe(ready);
    expect(ready.phase).toBe('day2');
    expect(ready.reply).toBeUndefined();
    expect(end.phase).toBe('end');
    expect(end.reply).toBe('review');
    expect(end.events.length).toBe(ready.events.length + 1);
    expect(end.events[end.events.length - 1].kind).toBe('day2.reply');
    expect(end.events[end.events.length - 1].payload).toEqual({ choice: 'review' });
    expect(isValidSave(end, RECORDS)).toBeTrue();

    expect(submitReply(end, 'ack')).toBe(end);
    expect(submitReply(end, 'review')).toBe(end);
    for (const reply of REPLIES) expect(canReply(end, reply)).toBeFalse();
  });

  it('不符條件的 submit 回傳原物件', () => {
    expect(submitReply(day2, 'ack')).toBe(day2);
    const reportOnly = markReportOpened(day2);
    expect(submitReply(reportOnly, 'review')).toBe(reportOnly);
    expect(submitReply(reportOnly, 'ask').phase).toBe('end');
  });

  it('phase 非 day2 → false', () => {
    const day1 = markReceiptOpened(markReportOpened(createSave(1)));
    const overnight: SaveV2 = { ...markReceiptOpened(markReportOpened(playToOvernight(1, 'default_false'))) };
    for (const reply of REPLIES) {
      expect(canReply(day1, reply)).toBeFalse();
      expect(canReply(overnight, reply)).toBeFalse();
      expect(submitReply(day1, reply)).toBe(day1);
      expect(submitReply(overnight, reply)).toBe(overnight);
    }
  });

  it('三種回覆各自留下不同事件與 reply', () => {
    for (const reply of REPLIES) {
      const end = playFull(1, 'default_false', reply);
      expect(end.reply).toBe(reply);
      expect(end.events[end.events.length - 1].payload).toEqual({ choice: reply });
    }
  });
});

/* ---------- 可重現性（Spec §7：相同 seed 與選擇可重現） ---------- */

describe('完整流程可重現', () => {
  it('相同 seed 與相同選擇跑兩次，最終存檔 JSON.stringify 相等', () => {
    for (const seed of [SEED_INTERVENE, SEED_NO_INTERVENE, 12345]) {
      for (const policy of MISSING_POLICIES) {
        for (const reply of REPLIES) {
          const a = playFull(seed, policy, reply);
          const b = playFull(seed, policy, reply);
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
          expect(a.phase).toBe('end');
          expect(isValidSave(JSON.parse(JSON.stringify(a)), RECORDS)).toBeTrue();
        }
      }
    }
  });

  it('完整流程的事件序列固定：3 archive → day1.complete → night.resolved → day2.reply', () => {
    const end = playFull(SEED_INTERVENE, 'request_review', 'review');
    expect(end.events.map((e) => e.kind)).toEqual([
      'archive',
      'archive',
      'archive',
      'day1.complete',
      'night.resolved',
      'day2.reply',
    ]);
    expect(end.events.map((e) => e.id)).toEqual([
      'archive:0',
      'archive:1',
      'archive:2',
      'day1.complete:3',
      'night.resolved:4',
      'day2.reply:5',
    ]);
  });

  it('不同 seed 可得到不同夜間結果', () => {
    const a = playToDay2(SEED_INTERVENE, 'request_review');
    const b = playToDay2(SEED_NO_INTERVENE, 'request_review');
    expect(a.night!.intervention).not.toBe(b.night!.intervention);
  });
});
