import { DayDirectory, firstTaskOf } from './day-plan';
import { LEGACY_DAY_01, LEGACY_DAY_02, dayIdForPhase, stageForPhase } from './day-map';
import { snapshotOf } from './rules';
import { isRawTaskDone } from './save-schema';
import {
  isValidLegacySaveV2,
  isValidLegacySaveV3,
  isValidLegacySaveV4,
  isValidLegacySaveV5,
  isValidLegacySaveV6,
  isValidLegacySaveV7,
  isValidLegacySaveV8,
  isValidLegacySaveV9,
  isValidLegacySaveV10,
  isValidSave,
} from './save-schema';
import { receiptMail } from './mail';
import {
  BatchState,
  MailRecord,
  SAVE_VERSION,
  Save,
  SaveV2,
  SaveV3,
  SaveV4,
  SaveV5,
  SaveV6,
  SaveV7,
  SaveV8,
  SaveV9,
  SaveV10,
  SaveV11,
  ReturnCase,
  ReturnReceipt,
  ReturnVersion,
  SourceRecord,
  TaskProgress,
} from './types';

/** v2 的全域 archived 歸入哪個批次：Day 1 的歸檔批次（由目錄查得）。 */
function legacyArchiveBatch(dir: DayDirectory): string {
  const plan = dir.plan(LEGACY_DAY_01);
  const first = plan?.tasks[0];
  if (first?.kind !== 'archive') throw new Error('Legacy migration needs an archive task on day.01');
  return first.batchId;
}

/**
 * v2 → v3：全域 archived／drafts 遷入 Day 1 的歸檔批次，並以當時的資料集合補上來源快照。
 */
export function migrateV2ToV3(legacy: SaveV2, records: readonly SourceRecord[], batchId: string): SaveV3 {
  const batch: BatchState = { archived: {}, drafts: {} };
  for (const [key, entry] of Object.entries(legacy.archived)) {
    if (!entry) continue;
    const record = records.find((r) => r.key === key);
    batch.archived[key] = {
      archiveCode: entry.archiveCode,
      refusal: entry.refusal,
      origin: entry.origin,
      source: record
        ? snapshotOf(record)
        : { name: null, code: entry.archiveCode, refusal: entry.refusal, refusalApplies: false },
    };
  }
  for (const [key, draft] of Object.entries(legacy.drafts)) {
    if (draft) batch.drafts[key] = { ...draft };
  }
  const v3: SaveV3 = {
    version: 3,
    seed: legacy.seed,
    phase: legacy.phase,
    dayId: dayIdForPhase(legacy.phase),
    batches: { [batchId]: batch },
    evidence: { ...legacy.evidence },
    events: [...legacy.events],
    readMessages: [],
  };
  if (legacy.night) v3.night = legacy.night;
  if (legacy.reply) v3.reply = legacy.reply;
  return v3;
}

/**
 * v3 → v4：phase 拆成 stage，taskId 由該日的 plan 查得。
 * v3 的 dayId 若不在目錄中，退回由 phase 對照（v3 只可能是 day.01／day.02）。
 */
export function migrateV3ToV4(legacy: SaveV3, dir: DayDirectory): SaveV4 {
  const dayId = dir.plan(legacy.dayId) ? legacy.dayId : dayIdForPhase(legacy.phase);
  const plan = dir.plan(dayId);
  if (!plan) throw new Error(`Cannot migrate: unknown day ${dayId}`);
  const v4: SaveV4 = {
    version: 4,
    seed: legacy.seed,
    dayId,
    stage: stageForPhase(legacy.phase),
    taskId: firstTaskOf(plan).id,
    batches: legacy.batches,
    evidence: { ...legacy.evidence },
    events: [...legacy.events],
    readMessages: [...legacy.readMessages],
  };
  if (legacy.night) v4.night = legacy.night;
  if (legacy.reply) v4.reply = legacy.reply;
  return v4;
}

/**
 * v4 → v5（R6-02）：
 * - 全域 evidence／reply 移進 `taskProgress[該日核對工作]`（只有核對日有意義；歸檔日的預設值直接捨棄）。
 * - 階段依**現行**日程校正：v4 當時 Day 2 是最後一天，停在 `end`；現在 Day 2 之後還有 Day 3，
 *   因此「有下一日卻 end」轉為 `wrap`，可直接接下一天。反向（無下一日卻 wrap）轉為 `end`。
 * - 批次、事件、night、已讀原樣保留；taskId 以目錄查得。
 */
export function migrateV4ToV5(legacy: SaveV4, dir: DayDirectory): SaveV5 {
  const plan = dir.plan(legacy.dayId);
  if (!plan) throw new Error(`Cannot migrate: unknown day ${legacy.dayId}`);
  const taskProgress: Partial<Record<string, TaskProgress>> = {};
  // evidence／reply 屬於「目前或最近一個」核對工作（v4 實際只有 Day 2）。
  const upTo = dir.days.slice(0, dir.days.indexOf(legacy.dayId) + 1);
  const reconcile = [...upTo]
    .reverse()
    .map((d) => dir.plan(d)?.tasks[0])
    .find((t) => t?.kind === 'reconcile');
  if (reconcile) {
    const p: TaskProgress = {
      kind: 'reconcile',
      reportOpened: legacy.evidence.reportOpened,
      receiptOpened: legacy.evidence.receiptOpened,
    };
    if (legacy.reply) p.reply = legacy.reply;
    taskProgress[reconcile.id] = p;
  }
  let stage = legacy.stage;
  if (stage === 'end' && plan.nextDayId !== null) stage = 'wrap';
  else if (stage === 'wrap' && plan.nextDayId === null) stage = 'end';
  const v5: SaveV5 = {
    version: 5,
    seed: legacy.seed,
    dayId: legacy.dayId,
    stage,
    taskId: firstTaskOf(plan).id,
    batches: legacy.batches,
    taskProgress,
    events: [...legacy.events],
    readMessages: [...legacy.readMessages],
  };
  if (legacy.night) v5.night = legacy.night;
  return v5;
}

/** v5 → v6（R7）：只新增空的 chatReplies，其他內容逐字保留。 */
export function migrateV5ToV6(legacy: SaveV5): SaveV6 {
  return { ...legacy, version: 6, chatReplies: {} };
}

/**
 * v6 → v7（R8）：補上「舊檔免補」清單。
 *
 * v2–v6 時代每天只有一件工作（現行內容的當日第一件）。本輪起同一天可以有多件，
 * 因此舊檔已經跨過的日子裡，第 2 件以後、尚未做完的工作列為免補：
 * - 目前日之前的每一天；
 * - 目前日若已離開 work（wrap／end），當日也一樣。
 * 目前日仍在 work 時不免補：做完舊工作後會接著做本輪新增的工作。
 * 每天的第一件（舊檔真正做過的那件）永遠不免補，仍須是真的完成，因此不會把損壞的舊檔硬救成合法。
 * 免補不寫事件，也不假裝已提交。
 */
export function migrateV6ToV7(legacy: SaveV6, dir: DayDirectory): SaveV7 {
  const index = dir.days.indexOf(legacy.dayId);
  const passed = dir.days.slice(0, legacy.stage === 'work' ? index : index + 1);
  const waivedTasks: string[] = [];
  const raw = legacy as unknown as Record<string, unknown>;
  for (const dayId of passed) {
    const plan = dir.plan(dayId);
    for (const task of plan?.tasks.slice(1) ?? []) {
      // 錯誤文件處理只在有到期案件時才適用，不需要列為免補
      if (task.kind === 'return-review') continue;
      if (!isRawTaskDone(raw, dir, task)) waivedTasks.push(task.id);
    }
  }
  return { ...legacy, version: 7, waivedTasks };
}

/**
 * v7 → v8（R9）：只新增空的 caseReviews。已歸檔的案件紀錄（本輪前提交、沒有案件決定）
 * 原樣保留，不補造選擇、不要求重做；尚未提交者可以照新案件流程處理。
 */
export function migrateV7ToV8(legacy: SaveV7): SaveV8 {
  return { ...legacy, version: 8, caseReviews: {} };
}

/**
 * v8 → v9（R10）：只新增空的 returns。舊檔沒有逐筆審查處置，不補造放行、不追罰；
 * 過去已被系統保存為來源值的編號也無法還原玩家原始輸入，不猜測補回。
 */
export function migrateV8ToV9(legacy: SaveV8): SaveV9 {
  return { ...legacy, version: 9, returns: [] };
}

/**
 * v9 → v10（R11）：退件變成持續的文件問題。
 * - pending → 待修正（排入舊複審日；若已過，排到下一工作日）；resubmitted → 已重送／待核對（採最後保存版本，
 *   預定核對日為受理日的下一工作日，若已過則為目前日的下一工作日；最後一天為 null）；window → 待窗口回覆。
 *   不因為舊名稱是 resubmitted 就視為已解決。
 * - 第一張退件回條由已保存的通知資料推得（標為已讀，不重新亮紅點）；不偽造之後的回條或放行紀錄。
 * - 舊複審日已到時，排程記錄那天引用的案件，讓當天工作清單維持原狀。
 */
export function migrateV9ToV10(legacy: SaveV9, dir: DayDirectory): SaveV10 {
  const today = dir.days.indexOf(legacy.dayId);
  const nextOf = (dayId: string): string | null => dir.plan(dayId)?.nextDayId ?? null;
  const notPassed = (dayId: string | null): boolean => dayId !== null && dir.days.indexOf(dayId) >= today;
  const issueSchedule: Record<string, string[]> = {};
  const readIssueReceipts: string[] = [];
  const returns: ReturnCase[] = legacy.returns.map((old) => {
    const versions: ReturnVersion[] = old.versions.map((v, index) => ({
      index,
      action: v.action,
      code: v.code,
      dayId: v.dayId,
      checkDayId: null,
    }));
    const last = versions[versions.length - 1];
    let status: ReturnCase['status'] = 'pending';
    let dueDayId: string | null = null;
    if (old.status === 'pending') {
      dueDayId = notPassed(old.returnDayId) ? old.returnDayId : nextOf(legacy.dayId);
    } else if (old.status === 'resubmitted' && last) {
      status = 'awaiting-check';
      const planned = nextOf(last.dayId);
      last.checkDayId = notPassed(planned) && planned !== legacy.dayId ? planned : nextOf(legacy.dayId);
    } else {
      status = 'awaiting-window';
    }
    const receipt: ReturnReceipt = {
      id: `${old.id}#0`,
      kind: 'returned',
      dayId: old.notifyDayId,
      versionIndex: null,
      code: old.reviewedCode,
      reason: 'code-mismatch',
    };
    readIssueReceipts.push(receipt.id);
    // 舊複審日已到：只記錄已處理的案件，或複審日就是今天的待修正案件（今天的工作清單維持原狀）。
    // 已過期卻仍待修正（正常 v9 遊玩不會發生）改排到下一工作日，不塞進過去的日子。
    const handledOrToday = old.status !== 'pending' || old.returnDayId === legacy.dayId;
    if (handledOrToday && dir.days.includes(old.returnDayId) && dir.days.indexOf(old.returnDayId) <= today) {
      (issueSchedule[old.returnDayId] ??= []).push(old.id);
    }
    return {
      id: old.id,
      auditId: old.auditId,
      batchId: old.batchId,
      recordKey: old.recordKey,
      archiveTaskId: old.archiveTaskId,
      reviewTaskId: old.reviewTaskId,
      sourceCode: old.sourceCode,
      submittedCode: old.submittedCode,
      reviewedCode: old.reviewedCode,
      disposition: 'release',
      reason: 'code-mismatch',
      notifyDayId: old.notifyDayId,
      status,
      dueDayId,
      versions,
      receipts: [receipt],
    };
  });
  return { ...legacy, version: 10, returns, issueSchedule, readIssueReceipts };
}

/**
 * v10 → v11（R12）：
 * - 角色名為 null（畫面顯示「員工」），入職視為已完成——不強迫補簽、不重跑 Day 1。
 * - 每份既有回條依穩定 ID 寄成一封郵件（依回條日期、再依建立順序）；回條已讀轉為郵件已讀。
 *   案件、版本、排程與未解決狀態原樣保留。
 * - 舊的回覆快照沒有送達時間：視為已送達的已讀歷史（回應 ID 加入已讀），不會突然亮紅點；
 *   之後新的回覆照常依送達狀態計算未讀。
 * - 沒有詢問紀錄與修訂草稿。
 */
export function migrateV10ToV11(legacy: SaveV10, dir: DayDirectory): SaveV11 {
  const { readIssueReceipts, ...rest } = legacy;
  const order = (dayId: string) => dir.days.indexOf(dayId);
  const mails: { mail: MailRecord; seq: number }[] = [];
  for (const item of legacy.returns) for (const receipt of item.receipts) mails.push({ mail: receiptMail(item, receipt), seq: mails.length });
  mails.sort((a, b) => order(a.mail.dayId) - order(b.mail.dayId) || a.seq - b.seq);
  const readReceipts = new Set(readIssueReceipts);
  const receiptIdOf = (mail: MailRecord) => {
    const a = mail.attachments[0];
    return a?.kind === 'return-receipt' ? a.receiptId : '';
  };
  const readMail = mails.filter((m) => readReceipts.has(receiptIdOf(m.mail))).map((m) => m.mail.id);
  const readMessages = [...legacy.readMessages];
  const seen = new Set(readMessages);
  for (const reply of Object.values(legacy.chatReplies)) {
    if (reply?.kind !== 'answered') continue;
    for (const r of reply.responses) {
      if (r.deliverAt !== undefined || seen.has(r.id)) continue;
      seen.add(r.id);
      readMessages.push(r.id);
    }
  }
  return {
    ...rest,
    version: 11,
    issueDrafts: {},
    mailbox: mails.map((m) => m.mail),
    readMail,
    helpRequests: {},
    profile: { name: null },
    onboarding: { step: 0, complete: true },
    readMessages,
  };
}

/**
 * v11 → v12（M1）：結構不變，只升版本號；M1 新增的工作（附件關聯、批次轉換、交付報告）若落在
 * 舊檔已越過的日子（目前日之前；目前日已在 wrap／end 時含當日），列為免補——不要求補做、不假裝已提交。
 * 目前日仍在 work／morning 時不免補：做完舊工作後可以接著做新工作。舊回覆、郵件、已讀、時間原樣保留。
 */
export function migrateV11ToV12(legacy: SaveV11, dir: DayDirectory): Save {
  const index = dir.days.indexOf(legacy.dayId);
  const passed = dir.days.slice(0, legacy.stage === 'wrap' || legacy.stage === 'end' ? index + 1 : Math.max(index, 0));
  const raw = legacy as unknown as Record<string, unknown>;
  const waivedTasks = [...legacy.waivedTasks];
  for (const dayId of passed) {
    for (const task of dir.plan(dayId)?.tasks.slice(1) ?? []) {
      if (task.kind === 'return-review' || waivedTasks.includes(task.id)) continue;
      if (!isRawTaskDone(raw, dir, task)) waivedTasks.push(task.id);
    }
  }
  return { ...legacy, version: SAVE_VERSION, waivedTasks };
}

export interface MigrationResult {
  save: Save;
  /** 來源版本；12 代表本來就是現行格式。 */
  from: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
}

/** v11 的最低結構（版本號與遷移需要讀的欄位）；完整規則在轉成 v12 後檢查。 */
function isV11Shape(s: unknown): s is SaveV11 {
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return false;
  const o = s as Record<string, unknown>;
  return o['version'] === 11 && typeof o['dayId'] === 'string' && typeof o['stage'] === 'string' && Array.isArray(o['waivedTasks']);
}

/**
 * 把任何合法的存檔（v2～v12）沿鏈帶到現行格式；不合法回傳 null。
 * 舊檔不會被判定損壞或清空，只會被轉換；轉換結果仍須通過現行驗證。
 */
export function migrateToCurrent(parsed: unknown, dir: DayDirectory): MigrationResult | null {
  if (isValidSave(parsed, dir)) return { save: parsed, from: 12 };
  const fromV11 = (v11: unknown, from: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11): MigrationResult | null => {
    if (!isV11Shape(v11)) return null;
    const v12 = migrateV11ToV12(v11, dir);
    return isValidSave(v12, dir) ? { save: v12, from } : null;
  };
  if (isV11Shape(parsed)) return fromV11(parsed, 11);
  const fromV10 = (v10: SaveV10, from: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10): MigrationResult | null => {
    if (!isValidLegacySaveV10(v10, dir)) return null;
    return fromV11(migrateV10ToV11(v10, dir), from);
  };
  if (isValidLegacySaveV10(parsed, dir)) return fromV10(parsed, 10);
  const fromV9 = (v9: SaveV9, from: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): MigrationResult | null => {
    if (!isValidLegacySaveV9(v9, dir)) return null;
    return fromV10(migrateV9ToV10(v9, dir), from);
  };
  if (isValidLegacySaveV9(parsed, dir)) return fromV9(parsed, 9);
  const fromV8 = (v8: SaveV8, from: 2 | 3 | 4 | 5 | 6 | 7 | 8): MigrationResult | null =>
    isValidLegacySaveV8(v8, dir) ? fromV9(migrateV8ToV9(v8), from) : null;
  if (isValidLegacySaveV8(parsed, dir)) return fromV8(parsed, 8);
  const fromV7 = (v7: SaveV7, from: 2 | 3 | 4 | 5 | 6 | 7): MigrationResult | null =>
    isValidLegacySaveV7(v7, dir) ? fromV8(migrateV7ToV8(v7), from) : null;
  if (isValidLegacySaveV7(parsed, dir)) return fromV7(parsed, 7);
  const fromV6 = (v6: SaveV6, from: 2 | 3 | 4 | 5 | 6): MigrationResult | null =>
    isValidLegacySaveV6(v6, dir) ? fromV7(migrateV6ToV7(v6, dir), from) : null;
  const fromV5 = (v5: SaveV5, from: 2 | 3 | 4 | 5): MigrationResult | null =>
    isValidLegacySaveV5(v5, dir) ? fromV6(migrateV5ToV6(v5), from) : null;
  if (isValidLegacySaveV6(parsed, dir)) return fromV6(parsed, 6);
  if (isValidLegacySaveV5(parsed, dir)) return fromV5(parsed, 5);
  const settle = (v4: SaveV4, from: 2 | 3 | 4): MigrationResult | null => {
    if (!dir.plan(v4.dayId)) return null;
    return fromV5(migrateV4ToV5(v4, dir), from);
  };
  if (isValidLegacySaveV4(parsed)) return settle(parsed, 4);
  if (isValidLegacySaveV3(parsed)) return settle(migrateV3ToV4(parsed, dir), 3);
  if (isValidLegacySaveV2(parsed)) {
    const batchId = legacyArchiveBatch(dir);
    const v3 = migrateV2ToV3(parsed, dir.records(batchId), batchId);
    return settle(migrateV3ToV4(v3, dir), 2);
  }
  return null;
}

export { LEGACY_DAY_01, LEGACY_DAY_02 };
