import { RECORDS } from '../content/records';
import { BATCH_DAY01_ARCHIVE, DAY_01, DAY_02, archiveBatchForDay, dayIdForPhase } from './day-map';
import { rand } from './rand';
import {
  ARRANGEMENT_SUBJECT_KEY,
  EVENT_IDS,
  INTERVENTION_THRESHOLD,
  advanceToDay2,
  allArchived,
  archivedCount,
  batchOf,
  canReply,
  commitArchive,
  completeDay1,
  createSave,
  currentBatchId,
  isArranged,
  isArrangedInSave,
  isMessageRead,
  markMessagesRead,
  markReceiptOpened,
  markReportOpened,
  resolveNight,
  setDraft,
  snapshotOf,
  submitReply,
  withEvent,
} from './rules';
import { isValidSave } from './save-schema';
import {
  ArchivedRecord,
  BatchId,
  BatchState,
  Draft,
  MISSING_POLICIES,
  MissingPolicy,
  NightResult,
  REPLIES,
  RecordKey,
  Reply,
  SAVE_VERSION,
  SaveV3,
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

/** 合法的 v3 存檔 fixture；只覆寫需要的欄位，其餘沿用 createSave。 */
function makeSave(overrides: Partial<SaveV3> = {}): SaveV3 {
  return { ...createSave(42), ...overrides };
}

/** 直接組一個批次；archived 需附來源快照才通過 schema。 */
function makeBatch(archived: BatchState['archived'] = {}, drafts: BatchState['drafts'] = {}): BatchState {
  return { archived, drafts };
}

/** 測試用的歸檔紀錄：快照與提交編號一致，不對應任何真實人物。 */
function fakeArchived(code: string): ArchivedRecord {
  return {
    archiveCode: code,
    refusal: null,
    origin: 'source',
    source: { name: null, code, refusal: null, refusalApplies: false },
  };
}

/** 把 entries 併進指定批次（測試要手造「已有內容」的存檔時用）。 */
function putArchived(
  save: SaveV3,
  entries: Record<RecordKey, ArchivedRecord>,
  batchId: BatchId = currentBatchId(save),
): SaveV3 {
  const b = batchOf(save, batchId);
  return {
    ...save,
    batches: { ...save.batches, [batchId]: { ...b, archived: { ...b.archived, ...entries } } },
  };
}

/** 依存檔自己的目前批次做 schema 檢查。 */
function validSave(save: SaveV3, records: readonly SourceRecord[] = RECORDS): boolean {
  return isValidSave(save, records, currentBatchId(save));
}

function archivedIn(save: SaveV3, key: RecordKey, batchId: BatchId = currentBatchId(save)): ArchivedRecord {
  const a = batchOf(save, batchId).archived[key];
  if (!a) throw new Error(`${key} not archived in ${batchId}`);
  return a;
}

function archiveAll(save: SaveV3, b102Policy: MissingPolicy): SaveV3 {
  let s = save;
  s = setDraft(s, 'H17', { value: 'H-17' });
  s = commitArchive(s, record('H17'), okFor('H17', batchOf(s).drafts['H17']!));
  s = setDraft(s, 'B102', { value: '0102', policy: b102Policy });
  s = commitArchive(s, record('B102'), okFor('B102', batchOf(s).drafts['B102']!));
  s = setDraft(s, 'B607', { value: '0607' });
  s = commitArchive(s, record('B607'), okFor('B607', batchOf(s).drafts['B607']!));
  return s;
}

function playToOvernight(seed: number, b102Policy: MissingPolicy): SaveV3 {
  return completeDay1(archiveAll(createSave(seed), b102Policy), RECORDS);
}

function playToDay2(seed: number, b102Policy: MissingPolicy): SaveV3 {
  return advanceToDay2(playToOvernight(seed, b102Policy));
}

function playFull(seed: number, b102Policy: MissingPolicy, reply: Reply): SaveV3 {
  let s = playToDay2(seed, b102Policy);
  s = markReportOpened(s);
  s = markReceiptOpened(s);
  return submitReply(s, reply);
}

const archivedAll: Record<RecordKey, ArchivedRecord> = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source', source: snapshotOf(record('H17')) },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted', source: snapshotOf(record('B102')) },
  B607: { archiveCode: '0607', refusal: true, origin: 'source', source: snapshotOf(record('B607')) },
};

/** 假想的後續日批次；只存在於測試中，不代表已有 Day 3 內容。 */
const DAY03_BATCH: BatchId = 'batch.day03.archive';

/** 黃金值：seed 42 介入（rand 0.2928 < 0.45）、seed 1 不介入（0.4957）。 */
const SEED_INTERVENE = 42;
const SEED_NO_INTERVENE = 1;

/* ---------- 每日／批次識別（KB-R4-05） ---------- */

describe('dayId 與批次識別', () => {
  it('createSave 起於 day.01，目前批次為 Day 1 歸檔批次', () => {
    const s = createSave(1);
    expect(s.dayId).toBe(DAY_01);
    expect(currentBatchId(s)).toBe(BATCH_DAY01_ARCHIVE);
    expect(s.batches).toEqual({});
    expect(s.readMessages).toEqual([]);
  });

  it('advanceToDay2 後 dayId 變成 day.02，但仍檢視同一批 Day 1 歸檔', () => {
    const overnight = playToOvernight(1, 'default_false');
    expect(overnight.dayId).toBe(DAY_01);
    const day2 = advanceToDay2(overnight);
    expect(day2.dayId).toBe(DAY_02);
    expect(currentBatchId(day2)).toBe(BATCH_DAY01_ARCHIVE);
    expect(archivedCount(day2)).toBe(RECORDS.length);
  });

  it('dayIdForPhase／archiveBatchForDay 的相容層對應', () => {
    expect(dayIdForPhase('day1')).toBe(DAY_01);
    expect(dayIdForPhase('overnight')).toBe(DAY_01);
    expect(dayIdForPhase('day2')).toBe(DAY_02);
    expect(dayIdForPhase('end')).toBe(DAY_02);
    expect(archiveBatchForDay(DAY_01)).toBe(BATCH_DAY01_ARCHIVE);
    expect(archiveBatchForDay(DAY_02)).toBe(BATCH_DAY01_ARCHIVE);
  });

  it('batchOf 對不存在的批次回傳空批次，不寫入存檔', () => {
    const s = createSave(1);
    expect(batchOf(s, DAY03_BATCH)).toEqual({ archived: {}, drafts: {} });
    expect(s.batches).toEqual({});
  });

  it('ARRANGEMENT_SUBJECT_KEY 指向資料集合內的一筆', () => {
    expect(ARRANGEMENT_SUBJECT_KEY).toBe('B102');
    expect(RECORDS.some((r) => r.key === ARRANGEMENT_SUBJECT_KEY)).toBeTrue();
  });
});

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
          ? { archiveCode: '0102', refusal: false, origin: 'defaulted', source: snapshotOf(record('B102')) }
          : { archiveCode: '0102', refusal: null, origin: 'review', source: snapshotOf(record('B102')) };
      const save = makeSave({
        seed: 7,
        phase: 'day2',
        dayId: DAY_02,
        batches: { [BATCH_DAY01_ARCHIVE]: makeBatch({ ...archivedAll, B102: b102 }) },
        night: { intervention, smallTalkVariant: 0, reportRevision: intervention ? 2 : 1 },
      });
      expect(validSave(save)).toBeTrue();
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

  it('isArrangedInSave 固定看 Day 1 歸檔批次，不受其他批次影響', () => {
    const save = putArchived(archiveAll(createSave(1), 'request_review'), { B102: fakeArchived('0102') }, DAY03_BATCH);
    expect(archivedIn(save, 'B102', DAY03_BATCH).refusal).toBeNull();
    expect(archivedIn(save, 'B102', BATCH_DAY01_ARCHIVE).refusal).toBeNull();
    expect(isArrangedInSave(save)).toBeFalse();
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
    const save = commitArchive(
      createSave(42),
      record('B102'),
      okFor('B102', { value: '0102', policy: 'default_false' }),
    );
    expect(archivedIn(save, 'B102').archiveCode).toBe('0102');
    expect(typeof archivedIn(save, 'B102').archiveCode).toBe('string');

    const restored = JSON.parse(JSON.stringify(save)) as SaveV3;
    expect(archivedIn(restored, 'B102').archiveCode).toBe('0102');
    expect(typeof archivedIn(restored, 'B102').archiveCode).toBe('string');
    expect(archivedIn(restored, 'B102').source.code).toBe('0102');
    expect(validSave(restored)).toBeTrue();
  });

  it('三筆齊時各自寫入來源原字串編號', () => {
    const s = archiveAll(createSave(1), 'default_false');
    expect(archivedIn(s, 'H17').archiveCode).toBe('H-17');
    expect(archivedIn(s, 'B102').archiveCode).toBe('0102');
    expect(archivedIn(s, 'B607').archiveCode).toBe('0607');
    expect(batchOf(s).archived).toEqual(archivedAll);
  });
});

/* ---------- 來源快照（KB-R4-05 第 3 點） ---------- */

describe('來源快照', () => {
  it('commitArchive 寫入提交當下的來源快照，與提交結果各自獨立', () => {
    const b102 = record('B102');
    const s = commitArchive(createSave(1), b102, okFor('B102', { value: '0102', policy: 'default_false' }));
    const a = archivedIn(s, 'B102');

    expect(a.source).toEqual(snapshotOf(b102));
    expect(a.source).toEqual({ name: null, code: '0102', refusal: null, refusalApplies: true });
    // 快照是複本，不是來源物件本身（來源日後被替換不會回頭改寫歷史）
    expect<object>(a.source).not.toBe(b102);
    // 來源當時沒有拒絕紀錄（null），玩家依政策補成 false：兩者分開保存
    expect(a.source.refusal).toBeNull();
    expect(a.refusal).toBeFalse();
    expect(a.origin).toBe('defaulted');
  });

  it('每一筆歸檔都帶有與來源逐欄相同的快照', () => {
    const s = archiveAll(createSave(1), 'request_review');
    for (const r of RECORDS) {
      const a = archivedIn(s, r.key);
      expect(a.source).toEqual({
        name: r.name,
        code: r.code,
        refusal: r.refusal,
        refusalApplies: r.refusalApplies,
      });
    }
  });

  it('來源資料日後被改寫時，非目前批次的歷史結果不會被判定損壞', () => {
    const done = archiveAll(createSave(1), 'default_false');
    // 模擬內容檔日後改版：同一個 key 換了編號與姓名
    const changed: readonly SourceRecord[] = RECORDS.map((r) =>
      r.key === 'B102' ? { ...r, code: '9999', name: '改版後的登記' } : r,
    );

    // 目前批次指向別的批次 → Day 1 批次只檢查結構，不與現行資料表比對
    expect(isValidSave(done, changed, DAY03_BATCH)).toBeTrue();
    // 快照保留提交當下的內容，沒有被現行資料表覆寫
    expect(archivedIn(done, 'B102', BATCH_DAY01_ARCHIVE).source).toEqual({
      name: null,
      code: '0102',
      refusal: null,
      refusalApplies: true,
    });
    expect(archivedIn(done, 'B102', BATCH_DAY01_ARCHIVE).archiveCode).toBe('0102');

    // 對照組一：同一份改過的資料若被當成「目前批次」的來源，仍會被判定不符
    expect(isValidSave(done, changed, BATCH_DAY01_ARCHIVE)).toBeFalse();
    // 對照組二：沒改過的資料在目前批次本來就合法（證明上面 false 的原因是內容不符）
    expect(isValidSave(done, RECORDS, BATCH_DAY01_ARCHIVE)).toBeTrue();
  });
});

/* ---------- 批次範圍（KB-R4-05 第 2 點） ---------- */

describe('批次範圍', () => {
  /** Day 1 已完成、另一個批次才做了一筆的存檔。 */
  function twoBatches(): SaveV3 {
    return makeSave({
      seed: 3,
      batches: {
        [BATCH_DAY01_ARCHIVE]: makeBatch({ ...archivedAll }, { H17: { value: 'H-17' } }),
        [DAY03_BATCH]: makeBatch({ T1: fakeArchived('0001') }, { T2: { value: '000' } }),
      },
    });
  }

  const laterRecords: readonly SourceRecord[] = [
    { key: 'T1', name: null, code: '0001', refusal: null, refusalApplies: false },
    { key: 'T2', name: '測試對象 2', code: '0002', refusal: null, refusalApplies: false },
  ];

  it('archivedCount 只計算指定批次，預設為目前批次', () => {
    const s = twoBatches();
    expect(currentBatchId(s)).toBe(BATCH_DAY01_ARCHIVE);
    expect(archivedCount(s, BATCH_DAY01_ARCHIVE)).toBe(3);
    expect(archivedCount(s, DAY03_BATCH)).toBe(1);
    expect(archivedCount(s)).toBe(3);
    expect(archivedCount(s, 'batch.nonexistent')).toBe(0);
  });

  it('某批次完成不會讓另一批次被視為完成', () => {
    const s = twoBatches();
    expect(allArchived(s, RECORDS, BATCH_DAY01_ARCHIVE)).toBeTrue();
    expect(allArchived(s, laterRecords, DAY03_BATCH)).toBeFalse();
    // 交叉比對：兩邊的資料集合互換都不算完成
    expect(allArchived(s, RECORDS, DAY03_BATCH)).toBeFalse();
    expect(allArchived(s, laterRecords, BATCH_DAY01_ARCHIVE)).toBeFalse();
  });

  it('commitArchive 寫進指定批次，其他批次不受影響', () => {
    const s = twoBatches();
    const next = commitArchive(s, record('H17'), okFor('H17', { value: 'H-17' }), DAY03_BATCH);
    expect(archivedCount(next, DAY03_BATCH)).toBe(2);
    expect(archivedIn(next, 'H17', DAY03_BATCH).archiveCode).toBe('H-17');
    // Day 1 批次的那筆 H17 仍是原本的物件，沒有被覆寫
    expect(batchOf(next, BATCH_DAY01_ARCHIVE).archived).toEqual(archivedAll);
    expect(archivedCount(next, BATCH_DAY01_ARCHIVE)).toBe(3);
    expect(next.events[next.events.length - 1].payload).toEqual({
      key: 'H17',
      origin: 'source',
      batchId: DAY03_BATCH,
    });
  });

  it('setDraft 寫進指定批次，其他批次的草稿不變', () => {
    const s = twoBatches();
    const next = setDraft(s, 'H17', { value: '改過的草稿' }, DAY03_BATCH);
    expect(batchOf(next, DAY03_BATCH).drafts['H17']).toEqual({ value: '改過的草稿' });
    expect(batchOf(next, BATCH_DAY01_ARCHIVE).drafts).toEqual({ H17: { value: 'H-17' } });
    expect(batchOf(s, DAY03_BATCH).drafts['H17']).toBeUndefined();
  });

  it('兩個批次並存的存檔仍通過 schema（歷史批次只檢查結構）', () => {
    const s = twoBatches();
    expect(isValidSave(s, RECORDS, BATCH_DAY01_ARCHIVE)).toBeTrue();
    expect(isValidSave(s, laterRecords, DAY03_BATCH)).toBeTrue();
  });
});

/* ---------- 新增紀錄不讓舊批次失效（KB-R4-05 第 2 點） ---------- */

describe('日後新增紀錄不會讓舊批次失效', () => {
  it('以較大的 records 檢查、目前批次指向後續日時，既有 Day 1 批次仍合法', () => {
    const day1Done = archiveAll(createSave(9), 'request_review');
    expect(archivedCount(day1Done, BATCH_DAY01_ARCHIVE)).toBe(RECORDS.length);

    // 模擬日後補上 Day 3 的九筆紀錄，資料集合整體變大
    const grown: readonly SourceRecord[] = [...RECORDS, ...fakeRecords(9)];
    expect(grown.length).toBeGreaterThan(RECORDS.length);

    expect(isValidSave(day1Done, grown, DAY03_BATCH)).toBeTrue();
    // 舊批次的內容一筆都沒有被要求對到新資料集合
    expect(batchOf(day1Done, BATCH_DAY01_ARCHIVE).archived['T1']).toBeUndefined();
    expect(archivedCount(day1Done, DAY03_BATCH)).toBe(0);
  });

  it('歷史批次即使含有不在現行資料集合內的 key 也不算損壞（只要結構完整）', () => {
    const retired = makeSave({
      batches: {
        // 假設 Day 1 的某筆在日後被下架，key 不再出現在 records 中
        'batch.day00.archive': makeBatch({ RETIRED: fakeArchived('0000') }),
      },
    });
    expect(isValidSave(retired, RECORDS, BATCH_DAY01_ARCHIVE)).toBeTrue();
    // 但結構仍要正確：少了快照就不合法
    const broken = makeSave({
      batches: {
        'batch.day00.archive': makeBatch({
          RETIRED: { archiveCode: '0000', refusal: null, origin: 'source' } as unknown as ArchivedRecord,
        }),
      },
    });
    expect(isValidSave(broken, RECORDS, BATCH_DAY01_ARCHIVE)).toBeFalse();
  });

  it('isValidSave 完全信任傳入的資料集合：給錯集合就會判定未完成', () => {
    // isValidSave 是純函式，完成度一定是拿「傳進來的集合」對目前批次比對。
    // 因此正確性取決於呼叫端傳什麼：state/batch-records.ts 的 recordsForBatch()
    // 會回傳該批次自己的集合，所以日後 Day 3 新增紀錄不會讓已完成的舊檔失效。
    // 這個案例記錄的是「傳錯集合會怎樣」，不是現行呼叫端的行為。
    const end = playFull(SEED_INTERVENE, 'default_false', 'ack');
    const grown: readonly SourceRecord[] = [...RECORDS, ...fakeRecords(3)];
    expect(isValidSave(end, RECORDS, BATCH_DAY01_ARCHIVE)).toBeTrue();
    expect(isValidSave(end, grown, BATCH_DAY01_ARCHIVE)).toBeFalse();
  });
});

/* ---------- 高筆數資料集合（KB-P1-02）：純函式不得假設「剛好三筆」 ---------- */

/**
 * 只在測試內使用的臨時假資料集合，用來證明規則由集合長度驅動。
 * 不寫入 content 的資料檔，也不代表任何人物或案件。
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
function archiveEvery(save: SaveV3, records: readonly SourceRecord[]): SaveV3 {
  let s = save;
  for (const r of records) {
    s = setDraft(s, r.key, { value: r.code, policy: 'default_false' });
    const v = validateRecord(r, batchOf(s).drafts[r.key]!);
    if (!v.ok) throw new Error(`validation failed for ${r.key}: ${v.error}`);
    s = commitArchive(s, r, v);
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
      expect(validSave(s, records)).toBeTrue();
    });

    it(`${n} 筆：完成全部後 completeDay1 進 overnight，且存檔通過 schema`, () => {
      const records = fakeRecords(n);
      const full = archiveEvery(createSave(3), records);
      const next = completeDay1(full, records);
      expect(next).not.toBe(full);
      expect(next.phase).toBe('overnight');
      expect(validSave(next, records)).toBeTrue();
    });
  }

  it('allArchived 不是「數量夠了」：湊到 12 筆但少一個鍵仍為 false', () => {
    const records = fakeRecords(12);
    const partial = archiveEvery(createSave(1), records.slice(0, 11));
    // 數量湊到 12，但第 12 個鍵沒歸檔。
    const padded = putArchived(partial, { EXTRA: fakeArchived('9999') });
    expect(archivedCount(padded)).toBe(12);
    expect(allArchived(padded, records)).toBeFalse();
    expect(validSave(padded, records)).toBeFalse();
  });

  it('RecordKey 放寬為 string 後，isValidSave 仍拒絕目前批次內不在集合的 key', () => {
    const records = fakeRecords(12);
    const unknown = putArchived(createSave(1), { UNKNOWN: fakeArchived('0001') });
    expect(validSave(unknown, records)).toBeFalse();
    expect(validSave(unknown, RECORDS)).toBeFalse();
    // 同一筆資料放回它自己的集合就合法，證明拒絕的原因是「不在集合內」而非結構。
    const known = putArchived(createSave(1), { T1: fakeArchived('0001') });
    expect(validSave(known, records)).toBeTrue();
    expect(validSave(known, RECORDS)).toBeFalse();
  });

  it('目前的 RECORDS 只是其中一種長度：規則對它與假集合一致', () => {
    const real = archiveEvery(createSave(5), RECORDS);
    expect(archivedCount(real)).toBe(RECORDS.length);
    expect(allArchived(real, RECORDS)).toBeTrue();
    expect(validSave(real)).toBeTrue();
  });
});

describe('archivedCount／allArchived', () => {
  it('空存檔 0、未齊 false；三筆齊 3、true', () => {
    const s0 = createSave(1);
    expect(archivedCount(s0)).toBe(0);
    expect(allArchived(s0, RECORDS)).toBeFalse();
    const s1 = commitArchive(s0, record('B607'), okFor('B607', { value: '0607' }));
    expect(archivedCount(s1)).toBe(1);
    expect(allArchived(s1, RECORDS)).toBeFalse();
    const s3 = archiveAll(createSave(1), 'default_false');
    expect(archivedCount(s3)).toBe(3);
    expect(allArchived(s3, RECORDS)).toBeTrue();
  });
});

/* ---------- 狀態轉移 ---------- */

describe('createSave', () => {
  it('phase day1、day.01、空 batches／events／readMessages、evidence 皆 false', () => {
    expect(createSave(42)).toEqual({
      version: SAVE_VERSION,
      seed: 42,
      phase: 'day1',
      dayId: DAY_01,
      batches: {},
      events: [],
      evidence: { reportOpened: false, receiptOpened: false },
      readMessages: [],
    });
    expect(SAVE_VERSION).toBe(3);
    expect(createSave(42).night).toBeUndefined();
    expect(createSave(42).reply).toBeUndefined();
  });

  it('新存檔通過 schema 檢查', () => {
    expect(validSave(createSave(0))).toBeTrue();
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
  it('不改原物件；新物件的目前批次有草稿', () => {
    const s = createSave(1);
    const next = setDraft(s, 'B102', { value: '0102', policy: 'request_review' });
    expect(next).not.toBe(s);
    expect(s.batches).toEqual({});
    expect(batchOf(next).drafts['B102']).toEqual({ value: '0102', policy: 'request_review' });
    expect(batchOf(next).archived).toEqual({});
    expect(validSave(next)).toBeTrue();
  });

  it('覆寫同 key 草稿、保留其他 key', () => {
    const s = setDraft(setDraft(createSave(1), 'H17', { value: '林' }), 'B102', { value: '01' });
    const next = setDraft(s, 'B102', { value: '0102' });
    expect(batchOf(next).drafts).toEqual({ H17: { value: '林' }, B102: { value: '0102' } });
  });

  it('不影響已歸檔內容', () => {
    const s = commitArchive(createSave(1), record('B607'), okFor('B607', { value: '0607' }));
    const next = setDraft(s, 'H17', { value: 'H-1' });
    expect(batchOf(next).archived).toEqual(batchOf(s).archived);
  });
});

describe('commitArchive', () => {
  const base = createSave(42);
  const ok = okFor('B102', { value: '0102', policy: 'default_false' });
  const committed = commitArchive(base, record('B102'), ok);

  it('成功寫入並推一個 archive 事件（含批次）', () => {
    expect(committed).not.toBe(base);
    expect(base.batches).toEqual({});
    expect(archivedIn(committed, 'B102')).toEqual({
      archiveCode: '0102',
      refusal: false,
      origin: 'defaulted',
      source: snapshotOf(record('B102')),
    });
    expect(committed.events).toEqual([
      {
        id: 'archive:0',
        kind: 'archive',
        payload: { key: 'B102', origin: 'defaulted', batchId: BATCH_DAY01_ARCHIVE },
      },
    ]);
    expect(committed.phase).toBe('day1');
  });

  it('重複 commit 同 key 回傳同一物件（不重複、不覆寫）', () => {
    const again = commitArchive(committed, record('B102'), okFor('B102', { value: '0102', policy: 'request_review' }));
    expect(again).toBe(committed);
    expect(archivedIn(again, 'B102').refusal).toBeFalse();
    expect(again.events.length).toBe(1);
  });

  it('同一 key 在不同批次各自獨立，不會被「已提交」擋下', () => {
    const other = commitArchive(committed, record('B102'), ok, DAY03_BATCH);
    expect(other).not.toBe(committed);
    expect(archivedCount(other, BATCH_DAY01_ARCHIVE)).toBe(1);
    expect(archivedCount(other, DAY03_BATCH)).toBe(1);
  });

  it('phase 非 day1 時忽略', () => {
    const overnight = makeSave({ seed: 1, phase: 'overnight' });
    expect(commitArchive(overnight, record('H17'), okFor('H17', { value: 'H-17' }))).toBe(overnight);
    const day2 = playToDay2(1, 'default_false');
    expect(commitArchive(day2, record('H17'), okFor('H17', { value: 'H-17' }))).toBe(day2);
  });

  it('review 結果寫入 refusal null／origin review，快照仍記錄來源的 null', () => {
    const held = commitArchive(base, record('B102'), okFor('B102', { value: '0102', policy: 'request_review' }));
    expect(archivedIn(held, 'B102')).toEqual({
      archiveCode: '0102',
      refusal: null,
      origin: 'review',
      source: snapshotOf(record('B102')),
    });
    expect(held.events[0].payload).toEqual({
      key: 'B102',
      origin: 'review',
      batchId: BATCH_DAY01_ARCHIVE,
    });
  });
});

describe('completeDay1', () => {
  it('未齊三筆回傳原物件', () => {
    const s0 = createSave(1);
    expect(completeDay1(s0, RECORDS)).toBe(s0);
    const s2 = commitArchive(
      commitArchive(s0, record('H17'), okFor('H17', { value: 'H-17' })),
      record('B607'),
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
    expect(validSave(next)).toBeTrue();
  });

  it('只看目前批次：另一個批次已完成不算數', () => {
    const s = putArchived(createSave(1), { H17: fakeArchived('H-17') }, DAY03_BATCH);
    expect(completeDay1(s, [record('H17')])).toBe(s);
  });

  it('phase 非 day1 時忽略', () => {
    const overnight = playToOvernight(1, 'default_false');
    expect(completeDay1(overnight, RECORDS)).toBe(overnight);
  });
});

describe('advanceToDay2', () => {
  it('從 overnight → day2、dayId 轉為 day.02，並寫入 night 與 night.resolved 事件', () => {
    const overnight = playToOvernight(SEED_INTERVENE, 'default_false');
    const day2 = advanceToDay2(overnight);
    expect(day2).not.toBe(overnight);
    expect(overnight.phase).toBe('overnight');
    expect(overnight.night).toBeUndefined();
    expect(overnight.dayId).toBe(DAY_01);
    expect(day2.phase).toBe('day2');
    expect(day2.dayId).toBe(DAY_02);
    expect(day2.night).toEqual(resolveNight(SEED_INTERVENE));
    expect(day2.events.length).toBe(overnight.events.length + 1);
    const last = day2.events[day2.events.length - 1];
    expect(last.kind).toBe('night.resolved');
    expect(last.payload).toEqual(resolveNight(SEED_INTERVENE));
    expect(validSave(day2)).toBeTrue();
  });

  it('night 已存在則不重算：內容相同且沒有新增 night.resolved 事件', () => {
    // 故意塞一個與 resolveNight(42) 不同的 night，證明沒有重擲。
    const preset: NightResult = { intervention: false, smallTalkVariant: 0, reportRevision: 1 };
    expect(preset).not.toEqual(resolveNight(SEED_INTERVENE));
    const overnight: SaveV3 = { ...playToOvernight(SEED_INTERVENE, 'default_false'), night: preset };
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
    expect(validSave(end)).toBeTrue();

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
    const overnight = markReceiptOpened(markReportOpened(playToOvernight(1, 'default_false')));
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

/* ---------- 訊息已讀（KB-R4-04／05） ---------- */

describe('isMessageRead／markMessagesRead', () => {
  it('新存檔沒有已讀訊息', () => {
    const s = createSave(1);
    expect(s.readMessages).toEqual([]);
    expect(isMessageRead(s, 'msg.any')).toBeFalse();
  });

  it('標記已讀寫入新物件，不改原物件', () => {
    const s0 = createSave(1);
    const s1 = markMessagesRead(s0, ['msg.a', 'msg.b']);
    expect(s1).not.toBe(s0);
    expect(s0.readMessages).toEqual([]);
    expect(s1.readMessages).toEqual(['msg.a', 'msg.b']);
    expect(isMessageRead(s1, 'msg.a')).toBeTrue();
    expect(isMessageRead(s1, 'msg.b')).toBeTrue();
    expect(isMessageRead(s1, 'msg.c')).toBeFalse();
  });

  // 目前失敗：markMessagesRead 只比對「已存檔的已讀」，同一次呼叫內的重複 ID 會被重複寫入。
  // 屬核心行為問題（見回報），測試不配合放寬。
  it('同一次呼叫內的重複 ID 只會加入一次', () => {
    const s = markMessagesRead(createSave(1), ['msg.a', 'msg.b', 'msg.a']);
    expect(s.readMessages).toEqual(['msg.a', 'msg.b']);
    expect(s.readMessages.filter((id) => id === 'msg.a').length).toBe(1);
  });

  it('沒有新增任何一筆時回傳同一物件（不製造多餘寫檔）', () => {
    const s1 = markMessagesRead(createSave(1), ['msg.a', 'msg.b']);
    expect(markMessagesRead(s1, [])).toBe(s1);
    expect(markMessagesRead(s1, ['msg.a'])).toBe(s1);
    expect(markMessagesRead(s1, ['msg.b', 'msg.a'])).toBe(s1);
    // 只要有一筆是新的就會回傳新物件，並保留既有順序
    const s2 = markMessagesRead(s1, ['msg.b', 'msg.c']);
    expect(s2).not.toBe(s1);
    expect(s2.readMessages).toEqual(['msg.a', 'msg.b', 'msg.c']);
  });

  it('查看訊息不動 phase、night、批次或事件', () => {
    const day2 = playToDay2(SEED_INTERVENE, 'request_review');
    const read = markMessagesRead(day2, ['msg.a', 'msg.b']);
    expect(read.phase).toBe(day2.phase);
    expect(read.night).toBe(day2.night!);
    expect(read.events).toBe(day2.events);
    expect(read.batches).toBe(day2.batches);
    expect(read.evidence).toBe(day2.evidence);
    expect(read.events.length).toBe(day2.events.length);
    expect(validSave(read)).toBeTrue();
  });

  it('已讀清單通過 JSON 往返與 schema 檢查', () => {
    const read = markMessagesRead(playFull(SEED_INTERVENE, 'default_false', 'ack'), ['msg.a', 'msg.b']);
    const restored = JSON.parse(JSON.stringify(read)) as SaveV3;
    expect(restored.readMessages).toEqual(['msg.a', 'msg.b']);
    expect(validSave(restored)).toBeTrue();
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
          expect(a.version).toBe(3);
          expect(isValidSave(JSON.parse(JSON.stringify(a)), RECORDS, currentBatchId(a))).toBeTrue();
        }
      }
    }
  });

  it('查看訊息後重跑仍相等：已讀不影響夜間判定與事件序列', () => {
    const a = markMessagesRead(playFull(SEED_INTERVENE, 'request_review', 'review'), ['msg.a']);
    const b = markMessagesRead(playFull(SEED_INTERVENE, 'request_review', 'review'), ['msg.a']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const plain = playFull(SEED_INTERVENE, 'request_review', 'review');
    expect(a.night).toEqual(plain.night!);
    expect(a.events).toEqual(plain.events);
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
