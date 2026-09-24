import { TestBed } from '@angular/core/testing';
import {
  ALL_PROMPTS,
  LEGACY_PLAYER_NAME,
  ONBOARDING,
  archiveTask,
  helpMessages,
  helpRequestOf,
  helpRequestOfMessage,
  onboardingContractIndex,
  promptOf,
  taskHeading,
  unlockedMessages,
} from '../content/bundle';
import { ARCHIVE_UI, DOCUMENT_ISSUES_UI, STORAGE } from '../content/text';
import { isValidSeed, rand } from '../core/rand';
import { currentBatchId, resolveNight, snapshotOf } from '../core/rules';
import { isValidSave } from '../core/save-schema';
import {
  ArchivedRecord,
  BatchState,
  GameEvent,
  MissingPolicy,
  RecordKey,
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
  LegacyReturnCaseV9,
  MailRecord,
  ReturnCase,
  ReturnReceipt,
  ReviewDisposition,
  ValidationOk,
} from '../core/types';
import { VALIDATION_MESSAGES } from '../core/validate';
import { DAY_DIRECTORY } from './day-directory';
import { GameClock } from './game-clock';
import { DayTaskItem, GameStateService } from './game-state.service';
import { SAVE_KEY, SaveRepository } from './save-repository';
import { routeForSave, routeForStage } from './stage-route';

/** 測試時鐘的起點（epoch ms）；送達時間都由它加 3–4 秒推得。 */
const T0 = 1_700_000_000_000;
/** R12 詢問說明（拒絕紀錄）：提問 ID、頻道、錨點 prompt。 */
const HELP_REQUEST = 'request.refusal-record';
const HELP_PROMPT = 'prompt.help.refusal';

/** 正式內容的識別；service 用正式 DAY_DIRECTORY。 */
const DAY_01 = 'day.01';
const DAY_02 = 'day.02';
const DAY_03 = 'day.03';
const DAY_04 = 'day.04';
const DAY_05 = 'day.05';
const DAY_06 = 'day.06';
const TASK_DAY1 = 'task.day1.archive';
const TASK_DAY1_FOLLOWUP = 'task.day1.archive-followup';
const TASK_DAY2 = 'task.day2.reconcile';
const TASK_DAY2_ARCHIVE = 'task.day2.archive';
const TASK_DAY3 = 'task.day3.archive';
const TASK_DAY4 = 'task.day4.archive';
const TASK_DAY5 = 'task.day5.archive';
const TASK_DAY6 = 'task.day6.field-map';
const BATCH_DAY01 = 'batch.day01.archive';
const BATCH_DAY01_FOLLOWUP = 'batch.day01.archive-followup';
const BATCH_DAY02 = 'batch.day02.archive';
const BATCH_DAY03 = 'batch.day03.archive';
const BATCH_DAY04 = 'batch.day04.archive';
const BATCH_DAY05 = 'batch.day05.archive';
const DAY1_RECORDS = DAY_DIRECTORY.records(BATCH_DAY01);
/** 舊檔已跨過 Day 1、Day 2 時的免補清單。 */
const WAIVED_THROUGH_DAY2 = [TASK_DAY1_FOLLOWUP, TASK_DAY2_ARCHIVE];

/** Day 6 正確對應：target → source。 */
const CORRECT_MAPPING: Record<string, string> = {
  'personnel-code': 'legacy-id',
  'exclude-flag': 'objection-reply',
  'contact-status': 'contact-result',
  'effective-date': 'record-date',
};
const BLANK_ROWS = ['row.0102', 'row.0521', 'row.0905', 'row.1219'];

/** service 在建構時讀 localStorage，所以每次都要重建 injector 才能拿到乾淨的實例。 */
function freshService(): GameStateService {
  TestBed.resetTestingModule();
  return TestBed.inject(GameStateService);
}

function okOf(game: GameStateService, key: RecordKey): ValidationOk {
  const r = game.validate(key);
  if (!r.ok) throw new Error(`validation for ${key} failed: ${r.error}`);
  return r;
}

function snapOf(key: RecordKey) {
  const r = DAY1_RECORDS.find((x) => x.key === key);
  if (!r) throw new Error(`Unknown record ${key}`);
  return snapshotOf(r);
}

/** 案件決定所依據文件上的編號（畫面上「帶入{heading}」按鈕的值）；R10 起只是玩家可編輯的預填。 */
function decisionCode(decisionId: string): string {
  const d = archiveTask(TASK_DAY3).caseReview!.decisions.find((x) => x.id === decisionId);
  if (!d) throw new Error(`Unknown decision ${decisionId}`);
  return d.archiveCode;
}

/**
 * 目前批次以來源編號歸檔前 n 筆（預設全部）；缺拒絕紀錄者用指定政策。
 * 多來源比對案件（Day 3 H204）改走開案＋提交決定（預設依來源登記表），編號帶入所選依據文件的值。
 */
function archiveCurrent(game: GameStateService, policy: MissingPolicy, n = Infinity, decision = 'registry'): void {
  for (const r of game.records().slice(0, n)) {
    const needsPolicy = r.refusalApplies && r.refusal === null;
    game.updateDraft(r.key, needsPolicy ? { value: r.code, policy } : { value: r.code });
    const casePlan = game.caseFor(r.key);
    if (casePlan && !game.archived(r.key)) {
      game.openCase(casePlan.id);
      expect(game.commitCase(r.key, decision, decisionCode(decision))).withContext(`${r.key} ${decision}`).toBeTrue();
      continue;
    }
    game.archive(r.key, okOf(game, r.key));
  }
}

/** 核對工作的逐筆審查（R10）：目前核對工作引用的每一筆都給同一個處置（預設放行）。 */
function reviewAll(game: GameStateService, disposition: ReviewDisposition = 'release'): void {
  const t = game.task();
  if (t?.kind !== 'reconcile') throw new Error(`${game.taskId()} is not a reconcile task`);
  for (const key of t.recordKeys) game.setRecordReview(key, disposition);
}

/** 核對：開摘要、逐筆審查（預設放行）後回覆。 */
function replyAfterReview(game: GameStateService, reply: 'ack' | 'ask' | 'review', disposition: ReviewDisposition = 'release'): boolean {
  game.openReport();
  if (reply === 'review') game.openReceipt();
  reviewAll(game, disposition);
  return game.submitReply(reply);
}

/** Day 1 第一件（H17／B102／B607）全部歸檔；B102 用指定政策。 */
function archiveAll(game: GameStateService, b102Policy: MissingPolicy): void {
  game.updateDraft('H17', { value: 'H-17' });
  game.archive('H17', okOf(game, 'H17'));
  game.updateDraft('B102', { value: '0102', policy: b102Policy });
  game.archive('B102', okOf(game, 'B102'));
  game.updateDraft('B607', { value: '0607' });
  game.archive('B607', okOf(game, 'B607'));
}

/** 完成並交付目前這一件工作（任何種類）。 */
function finishTask(game: GameStateService, policy: MissingPolicy = 'default_false'): void {
  switch (game.task()!.kind) {
    case 'archive':
      archiveCurrent(game, policy);
      expect(game.completeWork()).toBeTrue();
      return;
    case 'reconcile':
      expect(replyAfterReview(game, 'ack')).toBeTrue();
      return;
    case 'field-map':
      mapCorrectly(game);
      game.setFieldBlankPolicy('default_false');
      game.previewFieldMap();
      expect(game.submitFieldMap()).toBeTrue();
      expect(game.completeWork()).toBeTrue();
      return;
    case 'return-review':
      // 錯誤文件處理：當天排入且仍待修正的案件送窗口待查（不改編號），之後交付
      for (const r of game.activeReturns()) if (r.status === 'pending') expect(game.sendReturnToWindowStrict(r.id, game.editableReceiptId(r.id)!)).toBe('ok');
      expect(game.completeWork()).toBeTrue();
      return;
  }
}

/** 完成今天全部工作並停在 wrap／end（morning 先開始今日工作）。 */
function finishToday(game: GameStateService, policy: MissingPolicy = 'default_false'): void {
  game.startDay();
  const dayId = game.dayId();
  while (game.stage() === 'work' && game.dayId() === dayId) finishTask(game, policy);
  expect(['wrap', 'end']).toContain(game.stage()!);
}

/** 跨日並開始工作：wrap → morning → work。 */
function nextDay(game: GameStateService): void {
  game.advanceDay();
  expect(game.stage()).toBe('morning');
  game.startDay();
  expect(game.stage()).toBe('work');
}

/** Day 1 兩件工作完成 → Day 2 work（核對）。 */
function playToDay2(game: GameStateService, b102Policy: MissingPolicy): void {
  game.newGame();
  archiveAll(game, b102Policy);
  expect(game.completeWork()).toBeTrue();
  expect(game.taskId()).toBe(TASK_DAY1_FOLLOWUP);
  archiveCurrent(game, 'default_false');
  expect(game.completeWork()).toBeTrue();
  expect(game.stage()).toBe('wrap');
  nextDay(game);
  expect(game.dayId()).toBe(DAY_02);
  expect(game.taskId()).toBe(TASK_DAY2);
}

/** Day 2 回覆＋新件歸檔 → wrap → Day 3 work。 */
function playToDay3(game: GameStateService, b102Policy: MissingPolicy = 'default_false'): void {
  playToDay2(game, b102Policy);
  finishToday(game);
  expect(game.stage()).toBe('wrap');
  nextDay(game);
  expect(game.dayId()).toBe(DAY_03);
}

/** 由目前日一路完成、跨日，直到指定日的 work。 */
function playArchiveDaysUntil(game: GameStateService, dayId: string, policy: MissingPolicy = 'default_false'): void {
  while (game.dayId() !== dayId) {
    finishToday(game, policy);
    nextDay(game);
  }
  expect(game.stage()).toBe('work');
}

function playToDay6(game: GameStateService): void {
  playToDay3(game);
  playArchiveDaysUntil(game, DAY_06);
}

function mapCorrectly(game: GameStateService): void {
  for (const [target, source] of Object.entries(CORRECT_MAPPING)) game.setFieldAssignment(target, source);
}

/**
 * 現行存檔退回 v10 形狀（R11）：拿掉 R12 欄位，已讀郵件推回 readIssueReceipts（郵件 ID＝'mail.'＋回條 ID）。
 * 用來建立「R11 當時」的舊檔以測遷移。
 */
function toV10(save: Save): SaveV10 {
  const { issueDrafts: _d, mailbox: _m, readMail, helpRequests: _h, profile: _p, onboarding: _o, version: _v, ...rest } = save;
  return { ...rest, version: 10, readIssueReceipts: readMail.map((id) => id.replace(/^mail\./, '')) };
}

/** v10 → v11 遷移新增的欄位（沒有回條時）：未簽名、入職視為已完成、空郵件／已讀／提問／修訂草稿。 */
const V11_MIGRATED_EMPTY = {
  mailbox: [],
  readMail: [],
  helpRequests: {},
  issueDrafts: {},
  profile: { name: null },
  onboarding: { step: 0, complete: true },
};

function stored(): Save | null {
  const raw = localStorage.getItem(SAVE_KEY);
  return raw === null ? null : (JSON.parse(raw) as Save);
}

/** localStorage 內目前批次的內容（歸檔與草稿都以批次為範圍）。 */
function storedBatch(): BatchState {
  const s = stored();
  if (s === null) throw new Error('localStorage 沒有存檔');
  const b = currentBatchId(s, DAY_DIRECTORY);
  if (b === null) throw new Error('目前工作沒有歸檔批次');
  return s.batches[b] ?? { archived: {}, drafts: {} };
}

function storedIsValid(): boolean {
  const s = stored();
  return s !== null && isValidSave(s, DAY_DIRECTORY);
}

/** Day 3 以指定政策歸檔（決定 Day 4 的 review.any／none 分支）後進 Day 4 work。 */
function playToDay4(game: GameStateService, day3Policy: MissingPolicy): void {
  playToDay3(game);
  finishToday(game, day3Policy);
  nextDay(game);
  expect(game.dayId()).toBe(DAY_04);
}

/** dayTasks() 的精簡形狀：taskId／status／total／processed。 */
function taskRows(game: GameStateService) {
  return game.dayTasks().map((t) => ({ taskId: t.taskId, status: t.status, total: t.total, processed: t.processed }));
}

function row(taskId: string, status: DayTaskItem['status'], total: number, processed: number) {
  return { taskId, status, total, processed };
}

function kindsOf(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.kind);
}

function countKind(game: GameStateService, kind: string): number {
  return game.save()!.events.filter((e) => e.kind === kind).length;
}

/** 找一個夜間介入結果符合的 seed（四格矩陣需要兩種 night）。 */
function seedWithIntervention(intervention: boolean): number {
  for (let seed = 1; seed < 10_000; seed++) if (resolveNight(seed).intervention === intervention) return seed;
  throw new Error('no seed');
}

/** newGame 後把存檔 seed 換成指定值（Day 1 還沒擲夜間，seed 只影響之後的判定）。 */
function newGameWithSeed(seed: number): GameStateService {
  const g = freshService();
  g.newGame();
  localStorage.setItem(SAVE_KEY, JSON.stringify({ ...g.save()!, seed }));
  return freshService();
}


/* ---------- R10：第一輪提交的編號、第二輪逐筆審查、延後退件 ---------- */

type Day1Key = 'H17' | 'B102' | 'B607';
const DAY1_SOURCE: Record<Day1Key, string> = { H17: 'H-17', B102: '0102', B607: '0607' };
const AUDIT_ID = 'day1-code-audit';
const TASK_DAY4_RETURN = 'task.day4.return-review';
const RETURN_MSG = 'msg.day3.return-code-audit';
const RETURN_B102 = 'return.day1-code-audit.B102';
const RETURN_B607 = 'return.day1-code-audit.B607';

/** Day 1 第一件以指定編號提交（未指定者用來源編號；B102 用 default_false），交付兩件後進 Day 2 work（核對）。 */
function playToDay2With(game: GameStateService, codes: Partial<Record<Day1Key, string>>): void {
  game.newGame();
  for (const key of ['H17', 'B102', 'B607'] as const) {
    game.updateDraft(key, key === 'B102' ? { value: codes[key] ?? DAY1_SOURCE[key], policy: 'default_false' } : { value: codes[key] ?? DAY1_SOURCE[key] });
    game.archive(key, okOf(game, key));
  }
  expect(game.completeWork()).toBeTrue();
  archiveCurrent(game, 'default_false');
  expect(game.completeWork()).toBeTrue();
  nextDay(game);
  expect(game.taskId()).toBe(TASK_DAY2);
}

/** Day 2：逐筆審查（可逐筆指定處置）、回覆 ack、做完新件 → wrap。 */
function finishDay2(game: GameStateService, dispositions: Partial<Record<'B102' | 'B607', ReviewDisposition>> = {}): void {
  game.openReport();
  game.setRecordReview('B102', dispositions.B102 ?? 'release');
  game.setRecordReview('B607', dispositions.B607 ?? 'release');
  expect(game.submitReply('ack')).toBeTrue();
  archiveCurrent(game, 'default_false');
  expect(game.completeWork()).toBeTrue();
  expect(game.stage()).toBe('wrap');
  expect(game.dayId()).toBe(DAY_02);
}

/* ---------- R9 多來源比對案件（Day 3 H204） ---------- */

const CASE_H204 = 'case.day3.h204';
const LIN_DM = 'channel.dm.lin-yuan';
const CASE_DECISIONS = ['registry', 'supplement', 'review'] as const;
/** Day 4 林予安私訊：依 Day 3 H204 的案件決定三選一。 */
const H204_DM: Record<string, string> = {
  registry: 'msg.day4.h204.registry',
  supplement: 'msg.day4.h204.supplement',
  review: 'msg.day4.h204.review',
};
const H204_DM_IDS = Object.values(H204_DM);
const CASE_VARIANTS = ['received', 'pending'];

/** 與核心相同的選法：seed＋case ID → 變體。 */
function expectedVariant(seed: number): string {
  return CASE_VARIANTS[Math.floor(rand(seed, CASE_H204) * CASE_VARIANTS.length)];
}

function seedForVariant(variantId: string): number {
  for (let seed = 1; seed < 10_000; seed++) if (expectedVariant(seed) === variantId) return seed;
  throw new Error(`no seed for ${variantId}`);
}

/** 走到 Day 3 work 後把 seed 換成指定值（夜間已判定並保存，seed 只影響之後的亂數）。 */
function day3WithSeed(seed: number): GameStateService {
  const g = freshService();
  playToDay3(g);
  localStorage.setItem(SAVE_KEY, JSON.stringify({ ...g.save()!, seed }));
  return freshService();
}

/** 目前可見的林予安私訊中，屬於 H204 三則分支的那些。 */
function h204Dms(game: GameStateService): string[] {
  return unlockedIds(game, LIN_DM).filter((id) => H204_DM_IDS.includes(id));
}

/** Day 3 以指定政策與 H204 決定完成後進 Day 4 work。 */
function playToDay4WithCase(game: GameStateService, decision: string, policy: MissingPolicy = 'default_false'): void {
  playToDay3(game);
  archiveCurrent(game, policy, Infinity, decision);
  expect(game.completeWork()).toBeTrue();
  nextDay(game);
  expect(game.dayId()).toBe(DAY_04);
}

/* ---------- R7 固定回覆 ---------- */

const PROMPT_LUNCH = 'prompt.day3.lunch-plan';
const PROMPT_REVIEW_RETURNED = 'prompt.day4.review-returned';
const PROMPT_QUICK_CLOSE = 'prompt.day4.quick-close';
const WU_DM = 'channel.dm.wu-wan-ting';
const LUNCH_CHAT = 'channel.group.lunch-chat';
const LUNCH_DM: Record<string, string> = {
  join: 'msg.day4.dm-lunch-join',
  'ask-floor': 'msg.day4.dm-lunch-floor',
  'brought-own': 'msg.day4.dm-lunch-own',
};
const REVIEW_ANY_MSGS = ['msg.day4.review-returned', 'msg.day4.review-name', 'msg.day4.review-mood'];
const REVIEW_NONE_MSGS = ['msg.day4.quick-praise', 'msg.day4.green-number'];
/** R8 §4：Day 3 午餐四則在 batch.day03.archive 已提交 2 筆後才解鎖。 */
const LUNCH_MSGS = ['msg.day3.lunch-order', 'msg.day3.lunch-yesterday', 'msg.day3.lunch-hungry', 'msg.day3.lunch-ask-player'];

/** Day 3 午餐解鎖：先歸檔 Day 3 批次前兩筆（H204、H219，不需政策）。 */
function reachDay3Lunch(game: GameStateService): void {
  playToDay3(game);
  archiveCurrent(game, 'default_false', 2);
  expect(game.archivedCount()).toBe(2);
}

interface PromptCase {
  promptId: string;
  dayId: string;
  reach: (game: GameStateService) => void;
}

/** Day 1–6 每個 prompt 與「走到它可回答」的方式；Day 4 依 review 分支各一。 */
const PROMPT_CASES: readonly PromptCase[] = [
  { promptId: 'prompt.day1.welcome', dayId: DAY_01, reach: (g) => g.newGame() },
  { promptId: 'prompt.day2.check-in', dayId: DAY_02, reach: (g) => playToDay2(g, 'default_false') },
  { promptId: PROMPT_LUNCH, dayId: DAY_03, reach: (g) => reachDay3Lunch(g) },
  { promptId: PROMPT_REVIEW_RETURNED, dayId: DAY_04, reach: (g) => playToDay4(g, 'request_review') },
  { promptId: PROMPT_QUICK_CLOSE, dayId: DAY_04, reach: (g) => playToDay4(g, 'default_false') },
  {
    promptId: 'prompt.day5.missing-box',
    dayId: DAY_05,
    reach: (g) => {
      playToDay3(g);
      playArchiveDaysUntil(g, DAY_05);
    },
  },
  { promptId: 'prompt.day6.closed-box', dayId: DAY_06, reach: (g) => playToDay6(g) },
];

/** 存檔中與回覆無關、回答前後必須完全相同的欄位。 */
function workFields(s: Save) {
  return {
    seed: s.seed,
    dayId: s.dayId,
    stage: s.stage,
    taskId: s.taskId,
    batches: s.batches,
    taskProgress: s.taskProgress,
    waivedTasks: s.waivedTasks,
    readMessages: s.readMessages,
    night: s.night,
  };
}

function unlockedIds(game: GameStateService, channelId: string): string[] {
  return unlockedMessages(channelId, game.conditionContext()!).map((m) => m.id);
}

/** v6 存檔退回 v5 形狀：拿掉 chatReplies、version 5；其餘欄位原樣。 */
function toV5(save: SaveV6): SaveV5 {
  const { chatReplies: _drop, version: _v, ...rest } = save;
  return { ...rest, version: 5 };
}

const archivedAll: Record<RecordKey, ArchivedRecord> = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source', source: snapOf('H17') },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted', source: snapOf('B102') },
  B607: { archiveCode: '0607', refusal: true, origin: 'source', source: snapOf('B607') },
};

/** 某批次全部以來源編號提交的結果；缺拒絕紀錄者依 policy。 */
function archivedBatch(batchId: string, policy: MissingPolicy): Record<RecordKey, ArchivedRecord> {
  const out: Record<RecordKey, ArchivedRecord> = {};
  for (const r of DAY_DIRECTORY.records(batchId)) {
    const missing = r.refusalApplies && r.refusal === null;
    out[r.key] = {
      archiveCode: r.code,
      refusal: missing ? (policy === 'default_false' ? false : null) : r.refusal,
      origin: missing ? (policy === 'default_false' ? 'defaulted' : 'review') : 'source',
      source: snapshotOf(r),
    };
  }
  return out;
}

/* ---------- v6 樣本（R7 當時每天只有一件工作） ---------- */

const NIGHT_V6 = { intervention: false, smallTalkVariant: 1, reportRevision: 1 };
const WELCOME_REPLY = { kind: 'answered' as const, choiceId: 'thanks', playerText: '謝謝', responses: [] };

const legacyV6Day1Work: SaveV6 = {
  version: 6,
  seed: 31,
  dayId: DAY_01,
  stage: 'work',
  taskId: TASK_DAY1,
  batches: { [BATCH_DAY01]: { archived: { B102: { ...archivedAll['B102'] } }, drafts: { H17: { value: 'H-1' } } } },
  taskProgress: {},
  chatReplies: { 'prompt.day1.welcome': WELCOME_REPLY },
  events: [
    { id: 'archive:0', kind: 'archive', payload: { key: 'B102', origin: 'defaulted', batchId: BATCH_DAY01 } },
    { id: 'chat.reply:1', kind: 'chat.reply', payload: { promptId: 'prompt.day1.welcome', choiceId: 'thanks' } },
  ],
  readMessages: ['msg.a'],
};

const legacyV6Day1Wrap: SaveV6 = {
  ...legacyV6Day1Work,
  stage: 'wrap',
  batches: { [BATCH_DAY01]: { archived: { ...archivedAll }, drafts: {} } },
  events: [
    { id: 'archive:0', kind: 'archive', payload: { key: 'H17', origin: 'source', batchId: BATCH_DAY01 } },
    { id: 'archive:1', kind: 'archive', payload: { key: 'B102', origin: 'defaulted', batchId: BATCH_DAY01 } },
    { id: 'archive:2', kind: 'archive', payload: { key: 'B607', origin: 'source', batchId: BATCH_DAY01 } },
    { id: 'day.complete:3', kind: 'day.complete', payload: { dayId: DAY_01, taskId: TASK_DAY1 } },
  ],
};

const legacyV6Day2Work: SaveV6 = {
  ...legacyV6Day1Wrap,
  dayId: DAY_02,
  stage: 'work',
  taskId: TASK_DAY2,
  night: NIGHT_V6,
  taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false } },
  events: [...legacyV6Day1Wrap.events, { id: 'night.resolved:4', kind: 'night.resolved', payload: { ...NIGHT_V6 } }],
};

const legacyV6Day2Wrap: SaveV6 = {
  ...legacyV6Day2Work,
  stage: 'wrap',
  taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'review' } },
  events: [
    ...legacyV6Day2Work.events,
    { id: 'reply.submit:5', kind: 'reply.submit', payload: { taskId: TASK_DAY2, choice: 'review' } },
    { id: 'day.complete:6', kind: 'day.complete', payload: { dayId: DAY_02, taskId: TASK_DAY2 } },
  ],
};

const legacyV6Day4Work: SaveV6 = {
  ...legacyV6Day2Wrap,
  dayId: DAY_04,
  stage: 'work',
  taskId: TASK_DAY4,
  batches: {
    ...legacyV6Day2Wrap.batches,
    [BATCH_DAY03]: { archived: archivedBatch(BATCH_DAY03, 'request_review'), drafts: {} },
    [BATCH_DAY04]: {
      archived: { B716: { ...archivedBatch(BATCH_DAY04, 'request_review')['B716'] } },
      drafts: { B731: { value: '07' } },
    },
  },
  chatReplies: {
    ...legacyV6Day2Wrap.chatReplies,
    [PROMPT_LUNCH]: { kind: 'answered', choiceId: 'join', playerText: '都可以，我跟你們一起。', responses: [] },
  },
  readMessages: ['msg.a', 'msg.day4.dept-report'],
};

/** 一份合法的 v2 舊檔（已走到 day2，摘要已開）。 */
const legacyV2Day2: SaveV2 = {
  version: 2,
  seed: 42,
  phase: 'day2',
  archived: {
    H17: { archiveCode: 'H-17', refusal: null, origin: 'source' },
    B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' },
    B607: { archiveCode: '0607', refusal: true, origin: 'source' },
  },
  drafts: {},
  night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 },
  evidence: { reportOpened: true, receiptOpened: false },
  events: [{ id: 'day1.complete:3', kind: 'day1.complete', payload: {} }],
};

/** 一份還在 Day 1 的 v2 舊檔。 */
const legacyV2Day1: SaveV2 = {
  version: 2,
  seed: 7,
  phase: 'day1',
  archived: { B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' } },
  drafts: { H17: { value: 'H-1' } },
  evidence: { reportOpened: false, receiptOpened: false },
  events: [],
};

/** 一份合法的 v3 舊檔（overnight，帶已讀訊息）。 */
const legacyV3Overnight: SaveV3 = {
  version: 3,
  seed: 11,
  phase: 'overnight',
  dayId: DAY_01,
  batches: { [BATCH_DAY01]: { archived: { ...archivedAll }, drafts: { B607: { value: '0607' } } } },
  evidence: { reportOpened: false, receiptOpened: false },
  events: [{ id: 'day1.complete:3', kind: 'day1.complete', payload: {} }],
  readMessages: ['msg.a', 'msg.b'],
};

/** v4 當時 Day 2 是最後一天：已回覆並停在 end。 */
const legacyV4Day2End: SaveV4 = {
  version: 4,
  seed: 21,
  dayId: DAY_02,
  stage: 'end',
  taskId: TASK_DAY2,
  batches: { [BATCH_DAY01]: { archived: { ...archivedAll }, drafts: {} } },
  night: { intervention: false, smallTalkVariant: 1, reportRevision: 1 },
  evidence: { reportOpened: true, receiptOpened: false },
  reply: 'ask',
  events: [
    { id: 'day.complete:3', kind: 'day.complete', payload: { dayId: DAY_01, taskId: TASK_DAY1 } },
    { id: 'night.resolved:4', kind: 'night.resolved', payload: {} },
    { id: 'reply.submit:5', kind: 'reply.submit', payload: { choice: 'ask' } },
  ],
  readMessages: ['msg.a'],
};

describe('GameStateService', () => {
  let game: GameStateService;

  beforeEach(() => {
    localStorage.clear();
    game = freshService();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('初始狀態', () => {
    it('hasSave false、dayId／stage／taskId null、progressText 空字串、statusText 為 STORAGE.saved', () => {
      expect(game.hasSave()).toBeFalse();
      expect(game.save()).toBeNull();
      expect(game.dayId()).toBeNull();
      expect(game.stage()).toBeNull();
      expect(game.taskId()).toBeNull();
      expect(game.progressText()).toBe('');
      expect(game.storageIssue()).toBe('');
      expect(game.status()).toBe('');
      expect(game.statusText()).toBe(STORAGE.saved);
      expect(game.needsOverwriteConfirm()).toBeFalse();
    });

    it('衍生 signals 在無存檔時皆為空值；沒有目前批次就沒有資料集合', () => {
      expect(game.plan()).toBeNull();
      expect(game.task()).toBeNull();
      expect(game.taskContent()).toBeNull();
      expect(game.dayContent()).toBeNull();
      expect(game.nextDayId()).toBeNull();
      expect(game.batchId()).toBeNull();
      expect(game.dayNumber()).toBe(0);
      expect(game.lastDayNumber).toBe(6);
      expect(game.records()).toEqual([]);
      expect(game.totalRecords()).toBe(0);
      expect(game.archivedCount()).toBe(0);
      expect(game.allArchived()).toBeFalse();
      expect(game.taskDone()).toBeFalse();
      expect(game.dayTasks()).toEqual([]);
      expect(game.isLastTask()).toBeFalse();
      expect(game.dayEvents()).toEqual([]);
      expect(game.night()).toBeNull();
      expect(game.reconcile()).toBeNull();
      expect(game.reply()).toBeNull();
      expect(game.evidence()).toEqual({ reportOpened: false, receiptOpened: false });
      expect(game.subjectKey()).toBeNull();
      expect(game.arranged()).toBeFalse();
      expect(game.fieldMapPlan()).toBeNull();
      expect(game.fieldMap()).toBeNull();
      expect(game.fieldMapCheck()).toBeNull();
      expect(game.archived('B102')).toBeUndefined();
      expect(game.draft('B102')).toEqual({ value: '' });
      expect(game.isMessageRead('msg.a')).toBeFalse();
      expect(game.hasReview(BATCH_DAY03)).toBeFalse();
    });

    it('無存檔時的操作不拋例外也不建立存檔', () => {
      game.updateDraft('B102', { value: '0102' });
      expect(game.completeWork()).toBeFalse();
      game.advanceDay();
      game.startDay();
      game.openReport();
      game.openReceipt();
      game.markMessagesRead(['msg.a']);
      game.setFieldAssignment('personnel-code', 'legacy-id');
      game.setFieldBlankPolicy('default_false');
      expect(game.previewFieldMap()).toBeNull();
      expect(game.submitFieldMap()).toBeFalse();
      expect(game.canReply('ack')).toBeFalse();
      expect(game.submitReply('ack')).toBeFalse();
      expect(game.hasSave()).toBeFalse();
      expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    });
  });

  describe('newGame', () => {
    it('day.01／work／task.day1.archive、批次 batch.day01.archive、三筆資料、seed 合法、已寫入 v11（returns／issueSchedule／mailbox／readMail／helpRequests／issueDrafts 空、未簽名、入職未完成）', () => {
      game.newGame();
      expect(game.hasSave()).toBeTrue();
      expect(game.dayId()).toBe(DAY_01);
      expect(game.stage()).toBe('work');
      expect(game.taskId()).toBe(TASK_DAY1);
      expect(game.batchId()).toBe(BATCH_DAY01);
      expect(game.records().map((r) => r.key)).toEqual(['H17', 'B102', 'B607']);
      expect(game.totalRecords()).toBe(3);
      expect(game.records()).toBe(DAY_DIRECTORY.records(BATCH_DAY01));
      expect(isValidSeed(game.save()!.seed)).toBeTrue();
      expect(game.storageIssue()).toBe('');
      expect(game.statusText()).toBe(STORAGE.saved);
      const persisted = stored();
      expect(persisted).not.toBeNull();
      expect(persisted).toEqual(game.save()!);
      expect(persisted!.version).toBe(11);
      expect(persisted!.returns).toEqual([]);
      expect(persisted!.issueSchedule).toEqual({});
      expect(persisted!.mailbox).toEqual([]);
      expect(persisted!.readMail).toEqual([]);
      expect(persisted!.helpRequests).toEqual({});
      expect(persisted!.issueDrafts).toEqual({});
      expect(persisted!.profile).toEqual({ name: null });
      expect(persisted!.onboarding).toEqual({ step: 0, complete: false });
      expect((persisted as unknown as Record<string, unknown>)['readIssueReceipts']).toBeUndefined();
      expect(persisted!.caseReviews).toEqual({});
      expect(persisted!.waivedTasks).toEqual([]);
      expect(persisted!.chatReplies).toEqual({});
      expect(persisted!.taskProgress).toEqual({});
      expect(persisted!.readMessages).toEqual([]);
      const raw = persisted as unknown as Record<string, unknown>;
      expect(raw['phase']).toBeUndefined();
      expect(raw['evidence']).toBeUndefined();
      expect(raw['reply']).toBeUndefined();
      expect(storedIsValid()).toBeTrue();
      expect(game.needsOverwriteConfirm()).toBeTrue();
    });

    it('plan／task／taskContent／dayContent／nextDayId／dayNumber 由目錄與內容查得', () => {
      game.newGame();
      expect(game.plan()!.dayId).toBe(DAY_01);
      expect(game.dayNumber()).toBe(1);
      expect(game.task()!.kind).toBe('archive');
      expect(game.task()!.id).toBe(TASK_DAY1);
      expect(game.taskContent()!.id).toBe(TASK_DAY1);
      expect(game.taskContent()!.kind).toBe('archive');
      expect(game.nextDayId()).toBe(DAY_02);
      expect(game.dayContent()!.id).toBe(DAY_01);
      expect(game.dayContent()!.day).toBe(1);
      expect(game.progressText()).toBe('第一日');
      expect(game.fieldMapPlan()).toBeNull();
      expect(game.fieldMap()).toBeNull();
      expect(game.reconcile()).toBeNull();
    });

    it('record() 回傳目前批次的來源資料；不在目前批次的 key 拋錯', () => {
      game.newGame();
      expect(game.record('B102')).toEqual({ key: 'B102', name: null, code: '0102', refusal: null, refusalApplies: true });
      expect(game.record('H17')).toEqual({ key: 'H17', name: '林予安', code: 'H-17', refusal: null, refusalApplies: false });
      expect(() => game.record('NOPE')).toThrowError(/NOPE/);
      expect(() => game.record('B314')).toThrowError(/B314/);
      expect(game.archived('NOPE')).toBeUndefined();
      expect(game.draft('NOPE')).toEqual({ value: '' });
    });

    it('再次 newGame 會取代既有進度並清除 status', () => {
      game.newGame();
      game.updateDraft('B102', { value: '0102', policy: 'default_false' });
      game.archive('B102', okOf(game, 'B102'));
      expect(game.status()).toBe(ARCHIVE_UI.statusArchived);
      game.newGame();
      expect(game.archivedCount()).toBe(0);
      expect(game.draft('B102')).toEqual({ value: '' });
      expect(game.status()).toBe('');
      expect(game.save()!.batches).toEqual({});
    });

    it('localStorage 寫入失敗 → storageIssue 為 writeIssue，本次仍可遊玩', () => {
      spyOn(Storage.prototype, 'setItem').and.throwError('quota');
      game.newGame();
      expect(game.hasSave()).toBeTrue();
      expect(game.stage()).toBe('work');
      expect(game.storageIssue()).toBe(STORAGE.writeIssue);
      expect(game.statusText()).toBe(STORAGE.writeIssue);
      game.updateDraft('B102', { value: '0102' });
      expect(game.draft('B102').value).toBe('0102');
    });
  });

  describe('updateDraft／validate', () => {
    beforeEach(() => game.newGame());

    it('updateDraft 寫入目前批次的草稿並持久化', () => {
      game.updateDraft('B102', { value: '0102' });
      expect(game.draft('B102').value).toBe('0102');
      expect(storedBatch().drafts['B102']).toEqual({ value: '0102' });
      expect(Object.keys(stored()!.batches)).toEqual([BATCH_DAY01]);
    });

    it('updateDraft 以 patch 合併，保留既有 value', () => {
      game.updateDraft('B102', { value: '0102' });
      game.updateDraft('B102', { policy: 'default_false' });
      expect(game.draft('B102')).toEqual({ value: '0102', policy: 'default_false' });
      expect(storedBatch().drafts['B102']).toEqual({ value: '0102', policy: 'default_false' });
    });

    it('validate 缺 policy 時回 error；設 policy 後 ok', () => {
      game.updateDraft('B102', { value: '0102' });
      const err = game.validate('B102');
      expect(err.ok).toBeFalse();
      if (!err.ok) expect(err.error).toBe(VALIDATION_MESSAGES.policyRequired);

      game.updateDraft('B102', { policy: 'default_false' });
      const ok = game.validate('B102');
      expect(ok.ok).toBeTrue();
      if (ok.ok) {
        expect(ok.code).toBe('0102');
        expect(typeof ok.code).toBe('string');
        expect(ok.refusal).toBeFalse();
        expect(ok.origin).toBe('defaulted');
      }
    });

    it('validate 讀空草稿時回 error，不寫入存檔', () => {
      expect(game.validate('H17').ok).toBeFalse();
      expect(storedBatch().drafts).toEqual({});
    });

    it('stage 非 work 時 updateDraft 忽略', () => {
      finishToday(game);
      expect(game.stage()).toBe('wrap');
      const before = game.save();
      game.updateDraft('B102', { value: 'x' });
      expect(game.save()).toBe(before);
    });
  });

  describe('archive', () => {
    beforeEach(() => game.newGame());

    it('archived 有值（含來源快照）、archivedCount 1、status 為 ARCHIVE_UI.statusArchived、已持久化', () => {
      game.updateDraft('B102', { value: '0102', policy: 'request_review' });
      game.archive('B102', okOf(game, 'B102'));
      const expected: ArchivedRecord = { archiveCode: '0102', refusal: null, origin: 'review', source: snapOf('B102') };
      expect(game.archived('B102')).toEqual(expected);
      expect(game.archivedCount()).toBe(1);
      expect(game.allArchived()).toBeFalse();
      expect(game.taskDone()).toBeFalse();
      expect(game.status()).toBe(ARCHIVE_UI.statusArchived);
      expect(game.statusText()).toBe(ARCHIVE_UI.statusArchived);
      expect(storedBatch().archived['B102']).toEqual(expected);
      expect(stored()!.events.length).toBe(1);
      expect(stored()!.events[0].payload).toEqual({ key: 'B102', origin: 'review', batchId: BATCH_DAY01 });
    });

    it('重複 archive 不變', () => {
      game.updateDraft('B102', { value: '0102', policy: 'default_false' });
      const ok = okOf(game, 'B102');
      game.archive('B102', ok);
      const before = game.save();
      game.archive('B102', { ...ok, refusal: null, origin: 'review' });
      expect(game.save()).toBe(before);
      expect(game.archived('B102')!.refusal).toBeFalse();
      expect(game.archivedCount()).toBe(1);
      expect(game.save()!.events.length).toBe(1);
    });

    it('三筆齊 → allArchived／taskDone true、archivedCount 3', () => {
      archiveAll(game, 'default_false');
      expect(game.archivedCount()).toBe(3);
      expect(game.allArchived()).toBeTrue();
      expect(game.taskDone()).toBeTrue();
      expect(game.archived('H17')).toEqual(archivedAll['H17']);
      expect(game.archived('B607')).toEqual(archivedAll['B607']);
    });
  });

  /* ---------- 六日完整流程（R8：同日多工作、morning） ---------- */

  describe('完整流程 Day 1 → Day 6', () => {
    it('逐步 dayId／stage／taskId／records／dayTasks／isLastTask／事件／progressText 正確，Day 6 才結束', () => {
      game.newGame();
      const h1 = taskHeading(TASK_DAY1);

      // ---- Day 1 第 1 件：歸檔 3 筆 ----
      expect(game.progressText()).toBe('第一日');
      expect(game.taskId()).toBe(TASK_DAY1);
      expect(game.isLastTask()).toBeFalse();
      expect(game.dayTasks()).toEqual([
        { taskId: TASK_DAY1, kind: 'archive', index: 1, heading: h1, status: 'active', total: 3, processed: 0 },
        {
          taskId: TASK_DAY1_FOLLOWUP,
          kind: 'archive',
          index: 2,
          heading: taskHeading(TASK_DAY1_FOLLOWUP),
          status: 'pending',
          total: 3,
          processed: 0,
        },
      ]);
      expect(game.dayEvents()).toEqual([]);
      archiveCurrent(game, 'request_review');
      expect(taskRows(game)).toEqual([row(TASK_DAY1, 'active', 3, 3), row(TASK_DAY1_FOLLOWUP, 'pending', 3, 0)]);
      expect(game.completeWork()).toBeTrue();

      // 交付第 1 件：仍在 work，換到補入批次
      expect(game.stage()).toBe('work');
      expect(routeForStage(game.stage()!)).toBe('/work');
      expect(game.taskId()).toBe(TASK_DAY1_FOLLOWUP);
      expect(game.batchId()).toBe(BATCH_DAY01_FOLLOWUP);
      expect(game.records().map((r) => r.key)).toEqual(['H18', 'H19', 'H20']);
      expect(game.records()).toBe(DAY_DIRECTORY.records(BATCH_DAY01_FOLLOWUP));
      expect(game.totalRecords()).toBe(3);
      expect(game.archivedCount()).toBe(0);
      expect(game.allArchived()).toBeFalse();
      expect(game.taskDone()).toBeFalse();
      expect(game.taskContent()!.id).toBe(TASK_DAY1_FOLLOWUP);
      expect(game.isLastTask()).toBeTrue();
      expect(game.progressText()).toBe('第一日');
      expect(game.night()).toBeNull();
      expect(taskRows(game)).toEqual([row(TASK_DAY1, 'done', 3, 3), row(TASK_DAY1_FOLLOWUP, 'active', 3, 0)]);
      expect(countKind(game, 'task.complete')).toBe(1);
      expect(countKind(game, 'day.complete')).toBe(0);
      expect(countKind(game, 'night.resolved')).toBe(0);
      const tc1 = game.save()!.events[game.save()!.events.length - 1];
      expect(tc1.kind).toBe('task.complete');
      expect(tc1.payload).toEqual({ dayId: DAY_01, taskId: TASK_DAY1 });
      expect(storedIsValid()).toBeTrue();
      // 第 1 件的批次不再是目前批次；B102 不在補入批次
      expect(() => game.record('B102')).toThrowError(/B102/);
      expect(game.archived('B102')).toBeUndefined();

      // ---- Day 1 第 2 件 ----
      archiveCurrent(game, 'default_false');
      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('wrap');
      expect(routeForStage(game.stage()!)).toBe('/overnight');
      expect(game.progressText()).toBe('第一日交接完成');
      expect(game.isLastTask()).toBeFalse();
      expect(taskRows(game)).toEqual([row(TASK_DAY1, 'done', 3, 3), row(TASK_DAY1_FOLLOWUP, 'done', 3, 3)]);
      expect(countKind(game, 'task.complete')).toBe(2);
      expect(countKind(game, 'day.complete')).toBe(1);
      expect(game.save()!.events[game.save()!.events.length - 1]).toEqual(
        jasmine.objectContaining({ kind: 'day.complete', payload: { dayId: DAY_01 } }),
      );
      expect(kindsOf(game.dayEvents())).toEqual([
        'archive',
        'archive',
        'archive',
        'task.complete',
        'archive',
        'archive',
        'archive',
        'task.complete',
        'day.complete',
      ]);
      expect(game.night()).toBeNull();
      expect(storedIsValid()).toBeTrue();

      // ---- wrap → Day 2 morning（夜間判定一次） ----
      game.advanceDay();
      expect(game.dayId()).toBe(DAY_02);
      expect(game.stage()).toBe('morning');
      expect(routeForStage(game.stage()!)).toBe('/morning');
      expect(game.taskId()).toBe(TASK_DAY2);
      expect(game.progressText()).toBe('第二日收件');
      expect(game.night()).not.toBeNull();
      const night = game.night()!;
      expect(countKind(game, 'night.resolved')).toBe(1);
      expect(game.isLastTask()).toBeFalse();
      expect(taskRows(game)).toEqual([row(TASK_DAY2, 'pending', 2, 0), row(TASK_DAY2_ARCHIVE, 'pending', 4, 0)]);
      expect(game.dayEvents()).toEqual([]);
      // morning 不可提交任何工作
      expect(game.completeWork()).toBeFalse();
      game.openReport();
      expect(game.canReply('ack')).toBeFalse();
      expect(game.submitReply('ack')).toBeFalse();
      expect(storedIsValid()).toBeTrue();

      game.startDay();
      expect(game.stage()).toBe('work');
      expect(game.progressText()).toBe('第二日');
      const started = game.save();
      game.startDay();
      expect(game.save()).toBe(started);

      // ---- Day 2 第 1 件：核對 Day 1 第一批 ----
      expect(game.task()!.kind).toBe('reconcile');
      expect(game.batchId()).toBe(BATCH_DAY01);
      expect(game.totalRecords()).toBe(3);
      expect(game.subjectKey()).toBe('B102');
      expect(game.isLastTask()).toBeFalse();
      expect(taskRows(game)).toEqual([row(TASK_DAY2, 'active', 2, 0), row(TASK_DAY2_ARCHIVE, 'pending', 4, 0)]);
      expect(game.completeWork()).toBeFalse();
      game.openReport();
      game.openReceipt();
      const arranged = game.arranged();
      expect(arranged).toBe(night.intervention);
      // R10：兩筆都逐筆審查後才可回覆；確認收件本身不等於放行
      expect(game.canReply('review')).toBeFalse();
      reviewAll(game, 'release');
      expect(game.submitReply('review')).toBeTrue();

      // 回覆＝交付核對；仍在 work，換到今日新件
      expect(game.stage()).toBe('work');
      expect(game.taskId()).toBe(TASK_DAY2_ARCHIVE);
      expect(game.batchId()).toBe(BATCH_DAY02);
      expect(game.records().map((r) => r.key)).toEqual(['H31', 'H32', 'H33', 'H34']);
      expect(game.totalRecords()).toBe(4);
      expect(game.reconcile()).toBeNull();
      expect(game.save()!.taskProgress[TASK_DAY2]).toEqual(
        jasmine.objectContaining({ kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'review', reportRevision: night.reportRevision }),
      );
      expect(game.isLastTask()).toBeTrue();
      expect(game.arranged()).toBe(arranged);
      expect(taskRows(game)).toEqual([row(TASK_DAY2, 'done', 2, 2), row(TASK_DAY2_ARCHIVE, 'active', 4, 0)]);
      expect(countKind(game, 'task.complete')).toBe(3);
      expect(countKind(game, 'day.complete')).toBe(1);
      expect(kindsOf(game.dayEvents())).toEqual(['record.review', 'record.review', 'reply.submit', 'task.complete']);
      expect(game.dayEvents()[3].payload).toEqual({ dayId: DAY_02, taskId: TASK_DAY2 });
      expect(storedIsValid()).toBeTrue();

      // 重複回覆無效、不加事件
      const afterReply = game.save();
      expect(game.submitReply('ack')).toBeFalse();
      expect(game.completeWork()).toBeFalse();
      expect(game.save()).toBe(afterReply);

      // ---- Day 2 第 2 件 ----
      archiveCurrent(game, 'default_false');
      expect(game.arranged()).toBe(arranged);
      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('wrap');
      expect(game.dayId()).toBe(DAY_02);
      expect(game.nextDayId()).toBe(DAY_03);
      expect(game.progressText()).toBe('第二日交接完成');
      expect(game.arranged()).toBe(arranged);
      expect(taskRows(game)).toEqual([row(TASK_DAY2, 'done', 2, 2), row(TASK_DAY2_ARCHIVE, 'done', 4, 4)]);
      expect(kindsOf(game.dayEvents())).toEqual([
        'record.review',
        'record.review',
        'reply.submit',
        'task.complete',
        'archive',
        'archive',
        'archive',
        'archive',
        'task.complete',
        'day.complete',
      ]);
      expect(countKind(game, 'day.complete')).toBe(2);
      expect(storedIsValid()).toBeTrue();
      game.advanceDay();

      // ---- Day 3–5：各一件歸檔 5／6／8 筆 ----
      const archiveDays = [
        { dayId: DAY_03, taskId: TASK_DAY3, batchId: BATCH_DAY03, count: 5, name: '三' },
        { dayId: DAY_04, taskId: TASK_DAY4, batchId: BATCH_DAY04, count: 6, name: '四' },
        { dayId: DAY_05, taskId: TASK_DAY5, batchId: BATCH_DAY05, count: 8, name: '五' },
      ];
      for (const d of archiveDays) {
        expect(game.dayId()).toBe(d.dayId);
        expect(game.stage()).toBe('morning');
        expect(game.taskId()).toBe(d.taskId);
        expect(game.progressText()).toBe(`第${d.name}日收件`);
        expect(taskRows(game)).toEqual([row(d.taskId, 'pending', d.count, 0)]);
        expect(game.dayEvents()).toEqual([]);
        game.startDay();
        expect(game.stage()).toBe('work');
        expect(game.task()!.kind).toBe('archive');
        expect(game.batchId()).toBe(d.batchId);
        expect(game.records().length).toBe(d.count);
        expect(game.totalRecords()).toBe(d.count);
        expect(game.archivedCount()).toBe(0);
        expect(game.progressText()).toBe(`第${d.name}日`);
        expect(game.progressText()).not.toContain('第二日');
        expect(game.isLastTask()).toBeTrue();
        expect(taskRows(game)).toEqual([row(d.taskId, 'active', d.count, 0)]);
        expect(game.reconcile()).toBeNull();
        expect(game.reply()).toBeNull();
        expect(game.canReply('ack')).toBeFalse();
        expect(game.arranged()).toBeFalse();
        expect(game.night()).toEqual(night);
        expect(game.completeWork()).toBeFalse();
        archiveCurrent(game, 'default_false');
        expect(game.archivedCount()).toBe(d.count);
        expect(taskRows(game)).toEqual([row(d.taskId, 'active', d.count, d.count)]);
        expect(game.completeWork()).toBeTrue();
        expect(game.stage()).toBe('wrap');
        expect(taskRows(game)).toEqual([row(d.taskId, 'done', d.count, d.count)]);
        expect(kindsOf(game.dayEvents())).toEqual([...Array<string>(d.count).fill('archive'), 'task.complete', 'day.complete']);
        expect(game.progressText()).toBe(`第${d.name}日交接完成`);
        expect(storedIsValid()).toBeTrue();
        game.advanceDay();
      }

      // ---- Day 6：欄位映射 ----
      expect(game.dayId()).toBe(DAY_06);
      expect(game.stage()).toBe('morning');
      expect(game.progressText()).toBe('第六日收件');
      expect(taskRows(game)).toEqual([row(TASK_DAY6, 'pending', 8, 0)]);
      game.startDay();
      expect(game.stage()).toBe('work');
      expect(game.taskId()).toBe(TASK_DAY6);
      expect(game.task()!.kind).toBe('field-map');
      expect(game.taskContent()!.kind).toBe('field-map');
      expect(game.nextDayId()).toBeNull();
      expect(game.progressText()).toBe('第六日');
      expect(game.batchId()).toBeNull();
      expect(game.records()).toEqual([]);
      expect(game.totalRecords()).toBe(0);
      expect(game.archivedCount()).toBe(0);
      expect(game.isLastTask()).toBeTrue();
      expect(game.fieldMapPlan()!.id).toBe(TASK_DAY6);
      expect(game.fieldMap()).toEqual({ kind: 'field-map', assignments: {}, previewed: false });
      expect(game.completeWork()).toBeFalse();

      mapCorrectly(game);
      game.setFieldBlankPolicy('default_false');
      const preview = game.previewFieldMap();
      expect(preview?.ok).toBeTrue();
      expect(game.fieldMap()!.previewed).toBeTrue();
      expect(game.completeWork()).toBeFalse();
      expect(game.submitFieldMap()).toBeTrue();
      expect(game.status()).toBe(STORAGE.saved);
      expect(game.taskDone()).toBeTrue();
      expect(game.stage()).toBe('work');
      expect(taskRows(game)).toEqual([row(TASK_DAY6, 'active', 8, 8)]);

      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('end');
      expect(routeForStage(game.stage()!)).toBe('/end');
      expect(game.dayId()).toBe(DAY_06);
      expect(game.progressText()).toBe('六日試玩完成');
      expect(game.isLastTask()).toBeFalse();
      expect(taskRows(game)).toEqual([row(TASK_DAY6, 'done', 8, 8)]);
      expect(kindsOf(game.dayEvents())).toEqual(['field-map.submit', 'task.complete', 'day.complete']);
      expect(storedIsValid()).toBeTrue();

      // 結束後不再前進
      const end = game.save();
      game.advanceDay();
      game.startDay();
      expect(game.save()).toBe(end);
      expect(game.completeWork()).toBeFalse();

      const kinds = kindsOf(stored()!.events);
      expect(kinds.filter((k) => k === 'archive').length).toBe(3 + 3 + 4 + 5 + 6 + 8);
      expect(kinds.filter((k) => k === 'task.complete').length).toBe(8);
      expect(kinds.filter((k) => k === 'day.complete').length).toBe(6);
      expect(kinds.filter((k) => k === 'night.resolved').length).toBe(1);
      expect(kinds.filter((k) => k === 'reply.submit').length).toBe(1);
      expect(kinds.filter((k) => k === 'field-map.submit').length).toBe(1);
      expect(kinds[kinds.length - 1]).toBe('day.complete');
      // 每件工作恰好交付一次、每天恰好完成一次
      const delivered = stored()!.events.filter((e) => e.kind === 'task.complete').map((e) => (e.payload as { taskId: string }).taskId);
      expect(delivered).toEqual([
        TASK_DAY1,
        TASK_DAY1_FOLLOWUP,
        TASK_DAY2,
        TASK_DAY2_ARCHIVE,
        TASK_DAY3,
        TASK_DAY4,
        TASK_DAY5,
        TASK_DAY6,
      ]);
      const completedDays = stored()!.events.filter((e) => e.kind === 'day.complete').map((e) => (e.payload as { dayId: string }).dayId);
      expect(completedDays).toEqual([DAY_01, DAY_02, DAY_03, DAY_04, DAY_05, DAY_06]);

      // 歷史批次與核對進度全部保留；新遊戲沒有免補
      const s = stored()!;
      expect(s.waivedTasks).toEqual([]);
      expect(Object.keys(s.batches).sort()).toEqual(
        [BATCH_DAY01, BATCH_DAY01_FOLLOWUP, BATCH_DAY02, BATCH_DAY03, BATCH_DAY04, BATCH_DAY05].sort(),
      );
      expect(s.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('0102');
      expect(s.batches[BATCH_DAY01]!.archived['B102']!.origin).toBe('review');
      expect(s.taskProgress[TASK_DAY2]).toEqual(
        jasmine.objectContaining({ kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'review' }),
      );
      expect(s.taskProgress[TASK_DAY6]?.kind).toBe('field-map');
      // 全部以來源編號提交並放行 → 沒有文件問題案件、錯誤文件處理位置都不出現也不交付
      expect(s.issueSchedule).toEqual({});
      expect(s.mailbox).toEqual([]);
      expect(s.readMail).toEqual([]);
      expect(s.returns).toEqual([]);
      expect(kinds.filter((k) => k === 'record.review').length).toBe(2);
      expect(kinds).not.toContain('return.notified');
    });

    it('dayEvents 只含今天的事件、依發生順序；聊天與夜間事件不歸屬任何一天', () => {
      game.newGame();
      expect(game.answerPrompt('prompt.day1.welcome', 'thanks')).toBeTrue();
      archiveAll(game, 'default_false');
      const ids = game.dayEvents().map((e) => e.id);
      expect(kindsOf(game.dayEvents())).toEqual(['archive', 'archive', 'archive']);
      expect(ids).toEqual(game.save()!.events.filter((e) => e.kind === 'archive').map((e) => e.id));
      finishToday(game);
      const day1 = game.dayEvents();
      game.advanceDay();
      expect(game.dayEvents()).toEqual([]);
      game.startDay();
      expect(game.dayEvents()).toEqual([]);
      expect(replyAfterReview(game, 'ask')).toBeTrue();
      const day2 = game.dayEvents();
      expect(kindsOf(day2)).toEqual(['record.review', 'record.review', 'reply.submit', 'task.complete']);
      for (const e of day2) expect(day1).not.toContain(e);
      // 依存檔順序：索引遞增
      const all = game.save()!.events;
      const positions = day2.map((e) => all.indexOf(e));
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      // 刷新後相同
      expect(freshService().dayEvents()).toEqual(JSON.parse(JSON.stringify(day2)));
    });

    it('重複 completeWork／submitReply 回傳 false，不新增事件也不寫檔', () => {
      game.newGame();
      archiveAll(game, 'default_false');
      expect(game.completeWork()).toBeTrue();
      const raw = localStorage.getItem(SAVE_KEY);
      const s1 = game.save();
      // 補入批次尚未做 → 不能再交付
      expect(game.completeWork()).toBeFalse();
      expect(game.save()).toBe(s1);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      archiveCurrent(game, 'default_false');
      expect(game.completeWork()).toBeTrue();
      const s2 = game.save()!;
      expect(game.completeWork()).toBeFalse();
      expect(game.completeWork()).toBeFalse();
      expect(game.save()).toBe(s2);
      expect(countKind(game, 'task.complete')).toBe(2);
      expect(countKind(game, 'day.complete')).toBe(1);

      nextDay(game);
      expect(replyAfterReview(game, 'ack')).toBeTrue();
      const s3 = game.save()!;
      const raw3 = localStorage.getItem(SAVE_KEY);
      expect(game.submitReply('ack')).toBeFalse();
      expect(game.submitReply('ask')).toBeFalse();
      expect(game.completeWork()).toBeFalse();
      expect(game.save()).toBe(s3);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw3);
      expect(countKind(game, 'reply.submit')).toBe(1);
      expect(countKind(game, 'task.complete')).toBe(3);
    });

    it('同日中途重新載入（新 service）保留 taskId、dayTasks 狀態與目前批次進度', () => {
      game.newGame();
      archiveAll(game, 'request_review');
      game.completeWork();
      archiveCurrent(game, 'default_false', 1);
      game.updateDraft('H19', { value: 'H-1' });
      const rows = taskRows(game);
      expect(rows).toEqual([row(TASK_DAY1, 'done', 3, 3), row(TASK_DAY1_FOLLOWUP, 'active', 3, 1)]);

      let restored = freshService();
      expect(restored).not.toBe(game);
      expect(restored.storageIssue()).toBe('');
      expect(restored.stage()).toBe('work');
      expect(restored.taskId()).toBe(TASK_DAY1_FOLLOWUP);
      expect(restored.batchId()).toBe(BATCH_DAY01_FOLLOWUP);
      expect(restored.archivedCount()).toBe(1);
      expect(restored.draft('H19')).toEqual({ value: 'H-1' });
      expect(taskRows(restored)).toEqual(rows);
      expect(restored.isLastTask()).toBeTrue();
      expect(restored.dayEvents()).toEqual(JSON.parse(JSON.stringify(game.dayEvents())));
      finishToday(restored);
      nextDay(restored);
      expect(replyAfterReview(restored, 'ack')).toBeTrue();
      archiveCurrent(restored, 'default_false', 2);

      restored = freshService();
      expect(restored.dayId()).toBe(DAY_02);
      expect(restored.stage()).toBe('work');
      expect(restored.taskId()).toBe(TASK_DAY2_ARCHIVE);
      expect(restored.batchId()).toBe(BATCH_DAY02);
      expect(taskRows(restored)).toEqual([row(TASK_DAY2, 'done', 2, 2), row(TASK_DAY2_ARCHIVE, 'active', 4, 2)]);
      expect(restored.isLastTask()).toBeTrue();
      expect(storedIsValid()).toBeTrue();

      // morning 也在刷新後保留（不會自動變成 work，也不重擲夜間）
      finishToday(restored);
      restored.advanceDay();
      const night = restored.night();
      restored = freshService();
      expect(restored.stage()).toBe('morning');
      expect(restored.dayId()).toBe(DAY_03);
      expect(restored.night()).toEqual(night);
      expect(restored.progressText()).toBe('第三日收件');
      expect(taskRows(restored)).toEqual([row(TASK_DAY3, 'pending', 5, 0)]);
    });

    it('progressText 在 Day 3 之後的任何階段都不出現「第二日」', () => {
      playToDay3(game);
      const seen: string[] = [];
      while (game.stage() !== 'end') {
        seen.push(game.progressText());
        finishToday(game, 'request_review');
        seen.push(game.progressText());
        game.advanceDay();
        seen.push(game.progressText());
        game.startDay();
      }
      seen.push(game.progressText());
      expect(seen[0]).toBe('第三日');
      expect(seen).toContain('第四日收件');
      expect(seen[seen.length - 1]).toBe('六日試玩完成');
      for (const t of seen) expect(t).not.toContain('第二日');
    });

    it('Day 2 wrap 刷新後仍在 Day 2 wrap，接著進 Day 3 morning（夜間不重擲）', () => {
      playToDay2(game, 'default_false');
      expect(replyAfterReview(game, 'ask')).toBeTrue();
      expect(game.stage()).toBe('work');
      archiveCurrent(game, 'default_false');
      expect(game.completeWork()).toBeTrue();
      expect(stored()!.stage).toBe('wrap');

      const restored = freshService();
      expect(restored.dayId()).toBe(DAY_02);
      expect(restored.stage()).toBe('wrap');
      expect(restored.taskId()).toBe(TASK_DAY2_ARCHIVE);
      expect(taskRows(restored)).toEqual([row(TASK_DAY2, 'done', 2, 2), row(TASK_DAY2_ARCHIVE, 'done', 4, 4)]);
      const night = restored.night();
      restored.advanceDay();
      expect(restored.dayId()).toBe(DAY_03);
      expect(restored.stage()).toBe('morning');
      expect(restored.taskId()).toBe(TASK_DAY3);
      expect(restored.night()).toEqual(night);
      expect(restored.save()!.events.filter((e) => e.kind === 'night.resolved').length).toBe(1);
    });

    it('Day 2 流程：先開摘要、兩筆逐筆審查後才能回覆，review 需先開副本；回覆後不可再回覆', () => {
      playToDay2(game, 'request_review');
      expect(game.reconcile()).toEqual({ kind: 'reconcile', reportOpened: false, receiptOpened: false });
      expect(game.canReply('ack')).toBeFalse();
      expect(game.canReply('review')).toBeFalse();
      game.openReport();
      expect(game.evidence().reportOpened).toBeTrue();
      expect(stored()!.taskProgress[TASK_DAY2]).toEqual({ kind: 'reconcile', reportOpened: true, receiptOpened: false });
      // R10：只開摘要（確認收到）不等於審查放行
      expect(game.canReply('ack')).toBeFalse();
      expect(game.canReply('ask')).toBeFalse();
      expect(game.submitReply('ack')).toBeFalse();
      reviewAll(game, 'release');
      expect(game.canReply('ack')).toBeTrue();
      expect(game.canReply('ask')).toBeTrue();
      expect(game.canReply('review')).toBeFalse();
      expect(game.submitReply('review')).toBeFalse();
      expect(game.stage()).toBe('work');
      expect(game.taskId()).toBe(TASK_DAY2);

      game.openReceipt();
      expect(game.evidence().receiptOpened).toBeTrue();
      expect(game.canReply('review')).toBeTrue();
      expect(game.submitReply('review')).toBeTrue();
      expect(game.taskId()).toBe(TASK_DAY2_ARCHIVE);
      expect(game.save()!.taskProgress[TASK_DAY2]!).toEqual(jasmine.objectContaining({ reply: 'review' }));
      expect(game.submitReply('ack')).toBeFalse();
      expect(game.canReply('ack')).toBeFalse();
    });

    it('openReport／openReceipt 重複呼叫不新增變更；非核對工作呼叫為 no-op', () => {
      playToDay2(game, 'default_false');
      game.openReport();
      const after = game.save();
      game.openReport();
      expect(game.save()).toBe(after);
      game.openReceipt();
      const after2 = game.save();
      game.openReceipt();
      expect(game.save()).toBe(after2);

      // 同日第二件（歸檔）也不能再動核對進度
      reviewAll(game);
      expect(game.submitReply('ack')).toBeTrue();
      const onArchive = game.save();
      game.openReport();
      game.openReceipt();
      expect(game.save()).toBe(onArchive);

      game.newGame();
      const day1 = game.save();
      game.openReport();
      game.openReceipt();
      expect(game.save()).toBe(day1);
    });

    it('completeWork 未齊回 false 且 stage 不變；advanceDay 在 work 為 no-op', () => {
      game.newGame();
      game.updateDraft('H17', { value: 'H-17' });
      game.archive('H17', okOf(game, 'H17'));
      expect(game.completeWork()).toBeFalse();
      expect(game.stage()).toBe('work');
      const before = game.save();
      game.advanceDay();
      game.startDay();
      expect(game.save()).toBe(before);
      expect(game.night()).toBeNull();
    });
  });

  /* ---------- Day 3 午餐 unlockAfter（R8 §4） ---------- */

  describe('Day 3 午餐：batch.day03.archive 提交 2 筆後解鎖', () => {
    it('morning 與 0／1 筆時四則都鎖住、prompt 不可回答；2 筆時四則依序解鎖、prompt 可回答；刷新後一致', () => {
      playToDay2(game, 'default_false');
      finishToday(game);
      game.advanceDay();
      expect(game.stage()).toBe('morning');
      expect(game.dayId()).toBe(DAY_03);
      expect(game.conditionContext()!.archivedCount(BATCH_DAY03)).toBe(0);
      expect(unlockedIds(game, LUNCH_CHAT)).toEqual([]);
      expect(game.isPromptOpen(PROMPT_LUNCH)).toBeFalse();

      game.startDay();
      expect(unlockedIds(game, LUNCH_CHAT)).toEqual([]);
      expect(game.isPromptOpen(PROMPT_LUNCH)).toBeFalse();
      expect(game.answerPrompt(PROMPT_LUNCH, 'join')).toBeFalse();
      expect(game.skipPrompt(PROMPT_LUNCH)).toBeFalse();

      archiveCurrent(game, 'default_false', 1);
      expect(game.conditionContext()!.archivedCount(BATCH_DAY03)).toBe(1);
      expect(unlockedIds(game, LUNCH_CHAT)).toEqual([]);
      expect(game.isPromptOpen(PROMPT_LUNCH)).toBeFalse();
      expect(game.answerPrompt(PROMPT_LUNCH, 'join')).toBeFalse();
      let restored = freshService();
      expect(unlockedIds(restored, LUNCH_CHAT)).toEqual([]);
      expect(restored.isPromptOpen(PROMPT_LUNCH)).toBeFalse();
      expect(stored()!.chatReplies).toEqual({});

      // 草稿不算提交
      restored.updateDraft('H219', { value: 'H-219' });
      expect(unlockedIds(restored, LUNCH_CHAT)).toEqual([]);

      archiveCurrent(restored, 'default_false', 2);
      expect(restored.conditionContext()!.archivedCount(BATCH_DAY03)).toBe(2);
      expect(unlockedIds(restored, LUNCH_CHAT)).toEqual(LUNCH_MSGS);
      expect(restored.isPromptOpen(PROMPT_LUNCH)).toBeTrue();
      restored = freshService();
      expect(unlockedIds(restored, LUNCH_CHAT)).toEqual(LUNCH_MSGS);
      expect(restored.isPromptOpen(PROMPT_LUNCH)).toBeTrue();

      // 其他批次（Day 1、Day 2）的已提交筆數不影響
      expect(restored.conditionContext()!.archivedCount(BATCH_DAY01)).toBe(3);
      expect(restored.conditionContext()!.archivedCount(BATCH_DAY02)).toBe(4);
      expect(restored.conditionContext()!.archivedCount('batch.nonexistent')).toBe(0);

      // 之後各日仍留在頻道歷史
      finishToday(restored);
      expect(unlockedIds(restored, LUNCH_CHAT)).toEqual(LUNCH_MSGS);
      nextDay(restored);
      for (const id of LUNCH_MSGS) expect(unlockedIds(restored, LUNCH_CHAT)).toContain(id);
    });

    it('Day 1、Day 2 的歸檔再多也不會提早解鎖 Day 3 午餐（visibleFrom 仍是 day.03）', () => {
      playToDay2(game, 'default_false');
      finishToday(game);
      for (const id of LUNCH_MSGS) expect(unlockedIds(game, LUNCH_CHAT)).not.toContain(id);
      expect(game.isPromptOpen(PROMPT_LUNCH)).toBeFalse();
    });
  });

  describe('Day 3 多來源比對案件（R9：case.day3.h204）', () => {
    const REVIEW = archiveTask(TASK_DAY3).caseReview!;

    it('caseFor：只有 Day 3 的 H204 有案件；其他紀錄、其他日一律 undefined', () => {
      game.newGame();
      for (const r of game.records()) expect(game.caseFor(r.key)).withContext(r.key).toBeUndefined();
      localStorage.clear();
      game = freshService();
      playToDay2(game, 'default_false');
      expect(game.caseFor('B102')).toBeUndefined();
      expect(game.caseFor('H204')).toBeUndefined();
      finishToday(game);
      nextDay(game);
      expect(game.dayId()).toBe(DAY_03);
      const plan = game.caseFor('H204')!;
      expect(plan).toBeDefined();
      expect(plan.id).toBe(CASE_H204);
      expect(plan.recordKey).toBe('H204');
      expect(plan.variantIds).toEqual(CASE_VARIANTS);
      expect(plan.decisions.map((d) => d.id)).toEqual([...CASE_DECISIONS]);
      for (const k of ['H219', 'B314', 'B448', 'B521', 'B102', 'nope']) expect(game.caseFor(k)).withContext(k).toBeUndefined();
      expect(game.caseState(CASE_H204)).toBeUndefined();
      expect(game.caseDecision(CASE_H204)).toBeNull();
      expect(game.conditionContext()!.caseDecision(CASE_H204)).toBeNull();
      // Day 4 起不再是目前工作的案件
      finishToday(game);
      nextDay(game);
      expect(game.caseFor('H204')).toBeUndefined();
    });

    it('H204 不能走一般 archive()（即使草稿就是來源值），存檔不變、不寫狀態', () => {
      playToDay3(game);
      game.updateDraft('H204', { value: 'H-204' });
      const ok = okOf(game, 'H204');
      expect(ok.code).toBe('H-204');
      const before = game.save();
      game.status.set('');
      game.archive('H204', ok);
      expect(game.save()).toBe(before);
      expect(game.archived('H204')).toBeUndefined();
      expect(game.archivedCount()).toBe(0);
      expect(game.status()).toBe('');
      // 其他紀錄照常可用 archive()
      game.archive('H219', (game.updateDraft('H219', { value: 'H-219' }), okOf(game, 'H219')));
      expect(game.archived('H219')!.archiveCode).toBe('H-219');
    });

    it('openCase 依 seed＋case ID 選變體：兩個 seed 各得 received／pending，與核心亂數一致', () => {
      const seen = new Set<string>();
      for (const variantId of CASE_VARIANTS) {
        localStorage.clear();
        const seed = seedForVariant(variantId);
        const g = day3WithSeed(seed);
        expect(g.save()!.seed).toBe(seed);
        expect(g.caseState(CASE_H204)).toBeUndefined();
        g.openCase(CASE_H204);
        const state = g.caseState(CASE_H204)!;
        expect(state).toEqual({ variantId, marks: [] });
        expect(state.variantId).toBe(expectedVariant(seed));
        expect(stored()!.caseReviews).toEqual({ [CASE_H204]: { variantId, marks: [] } });
        expect(storedIsValid()).toBeTrue();
        seen.add(state.variantId);
      }
      expect([...seen].sort()).toEqual([...CASE_VARIANTS].sort());
    });

    it('變體保存後不重抽：再開案、重新載入（新 service）、看訊息、改草稿都不改變', () => {
      const g = day3WithSeed(seedForVariant('pending'));
      g.openCase(CASE_H204);
      const opened = g.save();
      g.openCase(CASE_H204);
      expect(g.save()).toBe(opened);

      const restored = freshService();
      expect(restored.caseState(CASE_H204)).toEqual({ variantId: 'pending', marks: [] });
      restored.openCase(CASE_H204);
      expect(restored.caseState(CASE_H204)!.variantId).toBe('pending');
      restored.markMessagesRead(['msg.day3.dm-drafts']);
      restored.updateDraft('H204', { value: 'H-205' });
      expect(restored.caseState(CASE_H204)!.variantId).toBe('pending');
      expect(freshService().caseState(CASE_H204)).toEqual({ variantId: 'pending', marks: [] });
    });

    it('openCase 在 morning、未知案件或非目前工作時為 no-op', () => {
      playToDay2(game, 'default_false');
      const day2 = game.save();
      game.openCase(CASE_H204);
      expect(game.save()).toBe(day2);
      finishToday(game);
      game.advanceDay();
      expect(game.stage()).toBe('morning');
      const morning = game.save();
      game.openCase(CASE_H204);
      game.openCase('case.nope');
      expect(game.save()).toBe(morning);
      game.startDay();
      const work = game.save();
      game.openCase('case.nope');
      expect(game.save()).toBe(work);
      expect(game.save()!.caseReviews).toEqual({});
    });

    it('toggleCaseMark：標記／取消並持久化；未開案前 no-op；提交後鎖定', () => {
      playToDay3(game);
      const before = game.save();
      game.toggleCaseMark(CASE_H204, '人員編號');
      expect(game.save()).toBe(before);

      game.openCase(CASE_H204);
      game.toggleCaseMark(CASE_H204, '人員編號');
      game.toggleCaseMark(CASE_H204, '送件時間');
      expect(game.caseState(CASE_H204)!.marks).toEqual(['人員編號', '送件時間']);
      let restored = freshService();
      expect(restored.caseState(CASE_H204)!.marks).toEqual(['人員編號', '送件時間']);
      restored.toggleCaseMark(CASE_H204, '送件時間');
      expect(restored.caseState(CASE_H204)!.marks).toEqual(['人員編號']);
      restored = freshService();
      expect(restored.caseState(CASE_H204)!.marks).toEqual(['人員編號']);
      expect(storedIsValid()).toBeTrue();

      expect(restored.commitCase('H204', 'registry', 'H-204')).toBeTrue();
      const committed = restored.save();
      restored.toggleCaseMark(CASE_H204, '姓名');
      restored.toggleCaseMark(CASE_H204, '人員編號');
      expect(restored.save()).toBe(committed);
      expect(freshService().caseState(CASE_H204)!.marks).toEqual(['人員編號']);
    });

    it('commitCase 需先開案；未知決定、非案件紀錄、空白／非文字編號、重複提交都回 false 且不寫入', () => {
      playToDay3(game);
      const before = game.save();
      expect(game.commitCase('H204', 'registry', 'H-204')).toBeFalse();
      expect(game.save()).toBe(before);
      game.openCase(CASE_H204);
      const opened = game.save();
      expect(game.commitCase('H204', 'nope', 'H-204')).toBeFalse();
      expect(game.commitCase('H219', 'registry', 'H-219')).toBeFalse();
      expect(game.commitCase('B102', 'registry', '0102')).toBeFalse();
      expect(game.commitCase('H204', 'registry', '')).toBeFalse();
      expect(game.commitCase('H204', 'registry', '   ')).toBeFalse();
      expect(game.commitCase('H204', 'registry', 204 as unknown as string)).toBeFalse();
      expect(game.save()).toBe(opened);
      expect(game.commitCaseStrict('H204', 'registry', ' ')).toBe('noop');
      expect(game.save()).toBe(opened);
      expect(game.commitCase('H204', 'supplement', 'H-205')).toBeTrue();
      const committed = game.save();
      expect(game.commitCase('H204', 'registry', 'H-204')).toBeFalse();
      expect(game.commitCaseStrict('H204', 'supplement', 'H-205')).toBe('noop');
      expect(game.save()).toBe(committed);
      expect(game.archived('H204')!.archiveCode).toBe('H-205');
    });

    for (const decisionId of CASE_DECISIONS) {
      it(`commitCase ${decisionId}（帶入依據文件編號）：歸檔編號／去向／依據／註記快照、狀態文字、事件；與其餘四筆一起完成並可 completeWork`, () => {
        const content = REVIEW.decisions.find((d) => d.id === decisionId)!;
        playToDay3(game);
        game.openCase(CASE_H204);
        game.toggleCaseMark(CASE_H204, '人員編號');
        game.status.set('');
        expect(game.commitCase('H204', decisionId, content.archiveCode)).toBeTrue();
        expect(game.status()).toBe(ARCHIVE_UI.statusArchived);
        expect(game.statusText()).toBe(ARCHIVE_UI.statusArchived);

        const entry = game.archived('H204')!;
        expect(entry.archiveCode).toBe({ registry: 'H-204', supplement: 'H-205', review: 'H-204' }[decisionId]);
        expect(entry.archiveCode).toBe(content.archiveCode);
        expect(entry.caseDecision).toEqual({
          caseId: CASE_H204,
          decisionId,
          destination: content.destination,
          basisDocumentId: content.basisDocumentId,
          note: content.note,
        });
        expect(entry.caseDecision!.destination).toBe(decisionId === 'review' ? 'review' : 'archive');
        // 拒絕紀錄的 origin 不混入人員編號依據；來源快照仍是登記表的 H-204
        expect(entry.origin).toBe('source');
        expect(entry.refusal).toBeNull();
        expect(entry.source).toEqual({ name: '黃品蓉', code: 'H-204', refusal: null, refusalApplies: false });
        expect(game.caseDecision(CASE_H204)).toBe(decisionId);
        expect(game.conditionContext()!.caseDecision(CASE_H204)).toBe(decisionId);
        expect(game.caseState(CASE_H204)!.marks).toEqual(['人員編號']);
        const ev = game.dayEvents().filter((e) => e.kind === 'archive');
        expect(ev.length).toBe(1);
        expect(ev[0].payload).toEqual({ key: 'H204', origin: 'source', batchId: BATCH_DAY03, caseId: CASE_H204, decisionId });
        expect(game.archivedCount()).toBe(1);
        expect(taskRows(game)).toEqual([row(TASK_DAY3, 'active', 5, 1)]);
        expect(game.hasReview(BATCH_DAY03)).toBeFalse();
        expect(storedIsValid()).toBeTrue();

        // 重新載入後快照與決定相同
        const restored = freshService();
        expect(restored.archived('H204')).toEqual(entry);
        expect(restored.caseDecision(CASE_H204)).toBe(decisionId);

        // 其餘四筆照一般流程；completeWork 成功
        expect(restored.completeWork()).toBeFalse();
        archiveCurrent(restored, 'default_false');
        expect(restored.archivedCount()).toBe(5);
        expect(restored.taskDone()).toBeTrue();
        expect(restored.archived('B314')!.archiveCode).toBe('0314');
        expect(restored.archived('H204')).toEqual(entry);
        expect(restored.completeWork()).toBeTrue();
        expect(restored.stage()).toBe('wrap');
        expect(taskRows(restored)).toEqual([row(TASK_DAY3, 'done', 5, 5)]);
        expect(storedIsValid()).toBeTrue();
        // Day 1 的 0102 前導零不受影響
        expect(stored()!.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('0102');
      });
    }

    describe('Day 4 林予安私訊（cond.case.day3.h204.*）', () => {
      for (const decisionId of CASE_DECISIONS) {
        it(`${decisionId} → Day 4 只解鎖 ${H204_DM[decisionId]}；Day 3 當天看不到；刷新與隔日仍一致`, () => {
          playToDay3(game);
          archiveCurrent(game, 'default_false', Infinity, decisionId);
          expect(game.caseDecision(CASE_H204)).toBe(decisionId);
          expect(h204Dms(game)).toEqual([]);
          expect(game.completeWork()).toBeTrue();
          expect(h204Dms(game)).toEqual([]);
          game.advanceDay();
          expect(game.dayId()).toBe(DAY_04);
          expect(game.conditionContext()!.caseDecision(CASE_H204)).toBe(decisionId);
          expect(h204Dms(game)).toEqual([H204_DM[decisionId]]);
          expect(unlockedMessages(LIN_DM, game.conditionContext()!).filter((m) => H204_DM_IDS.includes(m.id)).map((m) => m.id)).toEqual([
            H204_DM[decisionId],
          ]);
          const restored = freshService();
          expect(h204Dms(restored)).toEqual([H204_DM[decisionId]]);
          restored.startDay();
          finishToday(restored);
          restored.advanceDay();
          expect(restored.dayId()).toBe(DAY_05);
          expect(h204Dms(restored)).toEqual([H204_DM[decisionId]]);
        });
      }

      it('三種決定下（同一 seed），林予安頻道除 H204 分支外的訊息完全相同', () => {
        const others: string[][] = [];
        for (const decisionId of CASE_DECISIONS) {
          localStorage.clear();
          // 固定 seed：夜間閒聊版本等其他亂數相同，只剩案件決定不同
          const g = newGameWithSeed(777);
          archiveAll(g, 'default_false');
          expect(g.completeWork()).toBeTrue();
          archiveCurrent(g, 'default_false');
          expect(g.completeWork()).toBeTrue();
          nextDay(g);
          finishToday(g);
          nextDay(g);
          expect(g.dayId()).toBe(DAY_03);
          archiveCurrent(g, 'default_false', Infinity, decisionId);
          expect(g.completeWork()).toBeTrue();
          nextDay(g);
          expect(g.dayId()).toBe(DAY_04);
          expect(h204Dms(g)).toEqual([H204_DM[decisionId]]);
          others.push(unlockedIds(g, LIN_DM).filter((id) => !H204_DM_IDS.includes(id)));
        }
        expect(others[1]).toEqual(others[0]);
        expect(others[2]).toEqual(others[0]);
      });

      for (const [decisionId, policy] of [
        ['review', 'default_false'],
        ['registry', 'request_review'],
        ['supplement', 'default_false'],
        ['review', 'request_review'],
      ] as const) {
        it(`Day 4 review.any／none 只看拒絕紀錄政策：${decisionId}＋${policy}`, () => {
          playToDay4WithCase(game, decisionId, policy);
          const lunch = unlockedIds(game, LUNCH_CHAT);
          const [shown, hidden] = policy === 'request_review' ? [REVIEW_ANY_MSGS, REVIEW_NONE_MSGS] : [REVIEW_NONE_MSGS, REVIEW_ANY_MSGS];
          for (const id of shown) expect(lunch).toContain(id);
          for (const id of hidden) expect(lunch).not.toContain(id);
          expect(game.hasReview(BATCH_DAY03)).toBe(policy === 'request_review');
          expect(game.isPromptOpen(PROMPT_REVIEW_RETURNED)).toBe(policy === 'request_review');
          expect(game.isPromptOpen(PROMPT_QUICK_CLOSE)).toBe(policy === 'default_false');
          expect(stored()!.batches[BATCH_DAY03]!.archived['H204']!.origin).toBe('source');
          expect(h204Dms(game)).toEqual([H204_DM[decisionId]]);
        });
      }

      it('舊檔（v6）Day 3 的 H204 已以 H-204 歸檔、沒有案件決定 → 不補造、三則都不顯示，可繼續工作', () => {
        localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV6Day4Work));
        const g = freshService();
        expect(g.storageIssue()).toBe('');
        expect(g.dayId()).toBe(DAY_04);
        const h204 = stored()!.batches[BATCH_DAY03]!.archived['H204']!;
        expect(h204.archiveCode).toBe('H-204');
        expect(h204.caseDecision).toBeUndefined();
        expect(stored()!.caseReviews).toEqual({});
        expect(g.caseDecision(CASE_H204)).toBeNull();
        expect(g.conditionContext()!.caseDecision(CASE_H204)).toBeNull();
        expect(h204Dms(g)).toEqual([]);
        archiveCurrent(g, 'default_false');
        expect(g.completeWork()).toBeTrue();
        g.advanceDay();
        expect(g.dayId()).toBe(DAY_05);
        expect(h204Dms(g)).toEqual([]);
        expect(stored()!.batches[BATCH_DAY03]!.archived['H204']).toEqual(h204);
      });

      it('舊檔（v7）Day 3 wrap、H204 無決定 → 載入寫回 v11、跨到 Day 4 也不顯示三則', () => {
        playToDay3(game);
        archiveCurrent(game, 'default_false');
        expect(game.completeWork()).toBeTrue();
        const played = game.save()!;
        const { caseDecision: _drop, ...legacyH204 } = played.batches[BATCH_DAY03]!.archived['H204']!;
        const { caseReviews: _c, returns: _r, issueSchedule: _is, readIssueReceipts: _rr, version: _v, ...rest } = toV10(played);
        const v7: SaveV7 = {
          ...rest,
          version: 7,
          batches: {
            ...played.batches,
            [BATCH_DAY03]: { ...played.batches[BATCH_DAY03]!, archived: { ...played.batches[BATCH_DAY03]!.archived, H204: legacyH204 } },
          },
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(v7));
        expect(new SaveRepository().load().migratedFrom).toBe(7);
        const g = freshService();
        expect(g.storageIssue()).toBe('');
        expect(stored()!.version).toBe(11);
        expect(stored()!.caseReviews).toEqual({});
        expect(stored()!.returns).toEqual([]);
        expect(stored()!.issueSchedule).toEqual({});
        expect(stored()!.mailbox).toEqual([]);
        expect(stored()!.readMail).toEqual([]);
        expect(new SaveRepository().load().migratedFrom).toBe(11);
        expect(g.stage()).toBe('wrap');
        expect(g.caseDecision(CASE_H204)).toBeNull();
        g.advanceDay();
        expect(g.dayId()).toBe(DAY_04);
        expect(h204Dms(g)).toEqual([]);
        expect(g.archived('H204')).toBeUndefined(); // 目前批次已是 Day 4
        expect(stored()!.batches[BATCH_DAY03]!.archived['H204']).toEqual(legacyH204);
      });
    });

    it('Day 2 四格結果與核對量不受 Day 3 案件影響', () => {
      const g = newGameWithSeed(seedWithIntervention(false));
      archiveAll(g, 'request_review');
      expect(g.completeWork()).toBeTrue();
      archiveCurrent(g, 'default_false');
      expect(g.completeWork()).toBeTrue();
      nextDay(g);
      expect(taskRows(g)).toEqual([row(TASK_DAY2, 'active', 2, 0), row(TASK_DAY2_ARCHIVE, 'pending', 4, 0)]);
      expect(g.arranged()).toBeFalse();
      finishToday(g);
      expect(taskRows(g)).toEqual([row(TASK_DAY2, 'done', 2, 2), row(TASK_DAY2_ARCHIVE, 'done', 4, 4)]);
      nextDay(g);
      archiveCurrent(g, 'default_false', Infinity, 'supplement');
      expect(g.completeWork()).toBeTrue();
      expect(stored()!.batches[BATCH_DAY01]!.archived['B102']).toEqual({
        archiveCode: '0102',
        refusal: null,
        origin: 'review',
        source: snapOf('B102'),
      });
      expect(stored()!.night!.intervention).toBeFalse();
    });
  });

  describe('Day 3–5 歸檔批次', () => {
    it('Day 3 只讀自己的 5 筆；Day 1 的 key 不在目前批次；草稿寫入 Day 3 批次', () => {
      playToDay3(game);
      expect(game.records().map((r) => r.key)).toEqual(['H204', 'H219', 'B314', 'B448', 'B521']);
      expect(() => game.record('B102')).toThrowError(/B102/);
      expect(game.archived('B102')).toBeUndefined();
      expect(game.draft('B102')).toEqual({ value: '' });

      game.updateDraft('B314', { value: '0314' });
      expect(storedBatch().drafts['B314']).toEqual({ value: '0314' });
      expect(stored()!.batches[BATCH_DAY01]!.drafts['B314']).toBeUndefined();
      expect(Object.keys(stored()!.batches[BATCH_DAY01]!.archived).sort()).toEqual(['B102', 'B607', 'H17']);
    });

    it('Day 3 的 0314 前導零在提交與重新載入後保留', () => {
      playToDay3(game);
      game.updateDraft('B314', { value: '0314', policy: 'default_false' });
      game.archive('B314', okOf(game, 'B314'));
      expect(game.archived('B314')!.archiveCode).toBe('0314');
      const restored = freshService();
      expect(restored.dayId()).toBe(DAY_03);
      expect(restored.archived('B314')!.archiveCode).toBe('0314');
      expect(typeof restored.archived('B314')!.archiveCode).toBe('string');
      expect(restored.archived('B314')!.source.code).toBe('0314');
    });

    it('hasReview：Day 3 批次有一筆 request_review → true；全部 default_false → false', () => {
      playToDay3(game);
      expect(game.hasReview(BATCH_DAY03)).toBeFalse();
      archiveCurrent(game, 'request_review');
      expect(game.hasReview(BATCH_DAY03)).toBeTrue();
      game.completeWork();
      game.advanceDay();
      expect(game.stage()).toBe('morning');
      expect(game.dayId()).toBe(DAY_04);
      expect(game.hasReview(BATCH_DAY03)).toBeTrue();
      expect(game.hasReview(BATCH_DAY04)).toBeFalse();
      expect(freshService().hasReview(BATCH_DAY03)).toBeTrue();

      localStorage.clear();
      const other = freshService();
      playToDay3(other);
      archiveCurrent(other, 'default_false');
      other.completeWork();
      other.advanceDay();
      expect(other.dayId()).toBe(DAY_04);
      expect(other.hasReview(BATCH_DAY03)).toBeFalse();
    });

    it('hasReview 只看指定批次：Day 1 送覆核不影響 Day 3 的判斷', () => {
      playToDay3(game, 'request_review');
      expect(game.hasReview(BATCH_DAY01)).toBeTrue();
      expect(game.hasReview(BATCH_DAY03)).toBeFalse();
      expect(game.hasReview('batch.nonexistent')).toBeFalse();
    });
  });

  /* ---------- Day 6 欄位映射 ---------- */

  describe('Day 6 欄位映射', () => {
    beforeEach(() => playToDay6(game));

    it('錯誤（未填、重複、缺政策）回傳錯誤代碼，存檔不變；文字欄位互換不是錯誤（R10）', () => {
      const initial = game.save();
      expect(game.previewFieldMap()).toEqual({ ok: false, error: 'incomplete' });
      expect(game.save()).toBe(initial);

      game.setFieldAssignment('personnel-code', 'legacy-id');
      game.setFieldAssignment('exclude-flag', 'legacy-id');
      game.setFieldAssignment('contact-status', 'contact-result');
      game.setFieldAssignment('effective-date', 'record-date');
      let before = game.save();
      const storedBefore = localStorage.getItem(SAVE_KEY);
      expect(game.previewFieldMap()).toEqual({ ok: false, error: 'duplicate' });
      expect(game.save()).toBe(before);
      expect(localStorage.getItem(SAVE_KEY)).toBe(storedBefore);

      // 左右位置交換（兩個文字欄位）：一對一、型別可轉換 → 不再擋下，只差政策未選
      game.setFieldAssignment('exclude-flag', 'objection-reply');
      game.setFieldAssignment('contact-status', 'record-date');
      game.setFieldAssignment('effective-date', 'contact-result');
      before = game.save();
      expect(game.previewFieldMap()).toEqual({ ok: false, error: 'policyRequired' });
      expect(game.save()).toBe(before);

      mapCorrectly(game);
      before = game.save();
      expect(game.previewFieldMap()).toEqual({ ok: false, error: 'policyRequired' });
      expect(game.save()).toBe(before);
      expect(game.fieldMap()!.previewed).toBeFalse();
      expect(game.submitFieldMap()).toBeFalse();
      expect(game.save()).toBe(before);
      expect(game.completeWork()).toBeFalse();
      expect(game.stage()).toBe('work');
      expect(stored()!.taskProgress[TASK_DAY6]).toEqual({ kind: 'field-map', assignments: CORRECT_MAPPING, previewed: false });
    });

    it('未知目標或來源欄位忽略；空字串清除該目標', () => {
      const initial = game.save();
      game.setFieldAssignment('nope', 'legacy-id');
      game.setFieldAssignment('personnel-code', 'nope');
      expect(game.save()).toBe(initial);
      game.setFieldAssignment('personnel-code', 'legacy-id');
      expect(game.fieldMap()!.assignments).toEqual({ 'personnel-code': 'legacy-id' });
      game.setFieldAssignment('personnel-code', '');
      expect(game.fieldMap()!.assignments).toEqual({});
    });

    it('未預覽不能提交；預覽後改對應或政策會清除 previewed', () => {
      mapCorrectly(game);
      game.setFieldBlankPolicy('default_false');
      expect(game.submitFieldMap()).toBeFalse();
      expect(game.previewFieldMap()?.ok).toBeTrue();
      expect(game.fieldMap()!.previewed).toBeTrue();

      game.setFieldBlankPolicy('request_review');
      expect(game.fieldMap()!.previewed).toBeFalse();
      expect(game.submitFieldMap()).toBeFalse();
      game.previewFieldMap();
      expect(game.fieldMap()!.previewed).toBeTrue();
      game.setFieldAssignment('personnel-code', '');
      expect(game.fieldMap()!.previewed).toBeFalse();
      game.setFieldAssignment('personnel-code', 'legacy-id');
      expect(game.fieldMap()!.previewed).toBeFalse();
      expect(game.submitFieldMap()).toBeFalse();
    });

    it('預覽：8 列、受空值影響 4 列、0102 保留前導零', () => {
      mapCorrectly(game);
      game.setFieldBlankPolicy('default_false');
      const check = game.previewFieldMap();
      expect(check?.ok).toBeTrue();
      if (!check?.ok) return;
      expect(check.result.rowCount).toBe(8);
      expect(check.result.affectedCount).toBe(4);
      expect(check.result.blankPolicy).toBe('default_false');
      expect(check.result.rows.length).toBe(8);
      const codes = check.result.rows.map((r) => r.values['personnel-code']);
      expect(codes).toEqual(['0102', '0314', '0521', '0716', '0905', '1013', '1108', '1219']);
      for (const c of codes) expect(typeof c).toBe('string');
      expect(game.fieldMapCheck()).toEqual(check);
    });

    for (const [policy, blankValue] of [
      ['default_false', false],
      ['request_review', null],
    ] as const) {
      it(`政策 ${policy}：空白列的 exclude-flag 為 ${blankValue}；有→true、無→false`, () => {
        mapCorrectly(game);
        game.setFieldBlankPolicy(policy);
        game.previewFieldMap();
        expect(game.submitFieldMap()).toBeTrue();
        const sub = game.fieldMap()!.submitted!;
        expect(sub.blankPolicy).toBe(policy);
        expect(sub.rowCount).toBe(8);
        expect(sub.affectedCount).toBe(4);
        const flag = (id: string) => sub.rows.find((r) => r.id === id)!.values['exclude-flag'];
        for (const id of BLANK_ROWS) expect(flag(id)).toBe(blankValue);
        expect(flag('row.0716')).toBeTrue();
        for (const id of ['row.0314', 'row.1013', 'row.1108']) expect(flag(id)).toBeFalse();
        const row0102 = sub.rows.find((r) => r.id === 'row.0102')!;
        expect(row0102.values).toEqual({
          'personnel-code': '0102',
          'exclude-flag': blankValue,
          'contact-status': '未接',
          'effective-date': '2026-09-16',
        });

        const persisted = stored()!.taskProgress[TASK_DAY6];
        expect(persisted?.kind).toBe('field-map');
        if (persisted?.kind === 'field-map') expect(persisted.submitted).toEqual(sub);
        const event = stored()!.events[stored()!.events.length - 1];
        expect(event.kind).toBe('field-map.submit');
        expect(event.payload).toEqual({ taskId: TASK_DAY6, blankPolicy: policy, rowCount: 8, affectedCount: 4 });
        expect(storedIsValid()).toBeTrue();
      });
    }

    it('提交後鎖定：改對應、改政策、再預覽、再提交都不改存檔', () => {
      mapCorrectly(game);
      game.setFieldBlankPolicy('request_review');
      game.previewFieldMap();
      game.submitFieldMap();
      const locked = game.save();
      game.setFieldAssignment('personnel-code', '');
      game.setFieldBlankPolicy('default_false');
      game.previewFieldMap();
      expect(game.submitFieldMap()).toBeFalse();
      expect(game.save()).toBe(locked);
      const check = game.fieldMapCheck();
      expect(check?.ok).toBeTrue();
      if (check?.ok) expect(check.result).toEqual(game.fieldMap()!.submitted!);
    });

    it('提交結果在重新載入後保留（新 service 讀同一份 storage），可接著完成當日', () => {
      mapCorrectly(game);
      game.setFieldBlankPolicy('request_review');
      game.previewFieldMap();
      game.submitFieldMap();
      const submitted = game.fieldMap()!.submitted!;

      const restored = freshService();
      expect(restored).not.toBe(game);
      expect(restored.storageIssue()).toBe('');
      expect(restored.dayId()).toBe(DAY_06);
      expect(restored.stage()).toBe('work');
      expect(restored.fieldMap()!.assignments).toEqual(CORRECT_MAPPING);
      expect(restored.fieldMap()!.blankPolicy).toBe('request_review');
      expect(restored.fieldMap()!.previewed).toBeTrue();
      expect(restored.fieldMap()!.submitted).toEqual(submitted);
      expect(restored.fieldMap()!.submitted!.rows.find((r) => r.id === 'row.0102')!.values['personnel-code']).toBe('0102');
      expect(restored.fieldMap()!.submitted!.rows.find((r) => r.id === 'row.0102')!.values['exclude-flag']).toBeNull();
      expect(restored.taskDone()).toBeTrue();

      expect(restored.completeWork()).toBeTrue();
      expect(restored.stage()).toBe('end');
      const again = freshService();
      expect(again.stage()).toBe('end');
      expect(again.progressText()).toBe('六日試玩完成');
      expect(taskRows(again)).toEqual([row(TASK_DAY6, 'done', 8, 8)]);
      expect(again.fieldMap()!.submitted).toEqual(submitted);
    });

    it('未提交的對應與政策在重新載入後保留', () => {
      game.setFieldAssignment('personnel-code', 'legacy-id');
      game.setFieldBlankPolicy('default_false');
      const restored = freshService();
      expect(restored.fieldMap()).toEqual({
        kind: 'field-map',
        assignments: { 'personnel-code': 'legacy-id' },
        blankPolicy: 'default_false',
        previewed: false,
      });
    });
  });

  describe('訊息已讀', () => {
    it('markMessagesRead 寫入存檔，isMessageRead 正確', () => {
      game.newGame();
      expect(game.isMessageRead('msg.a')).toBeFalse();
      game.markMessagesRead(['msg.a', 'msg.b']);
      expect(game.isMessageRead('msg.a')).toBeTrue();
      expect(game.isMessageRead('msg.b')).toBeTrue();
      expect(game.isMessageRead('msg.c')).toBeFalse();
      expect(stored()!.readMessages).toEqual(['msg.a', 'msg.b']);
      expect(storedIsValid()).toBeTrue();
    });

    it('同一批訊息 ID 有重複時只會存一次', () => {
      game.newGame();
      game.markMessagesRead(['msg.a', 'msg.b', 'msg.a']);
      expect(stored()!.readMessages).toEqual(['msg.a', 'msg.b']);
    });

    it('查看訊息不動 night／stage／dayId／事件，不重抽亂數', () => {
      playToDay2(game, 'request_review');
      const before = game.save()!;
      const beforeNight = before.night!;

      game.markMessagesRead(['msg.a', 'msg.b']);
      const after = game.save()!;
      expect(after).not.toBe(before);
      expect(after.stage).toBe('work');
      expect(after.dayId).toBe(DAY_02);
      expect(after.taskId).toBe(TASK_DAY2);
      expect(after.night).toEqual(beforeNight);
      expect(after.events).toEqual(before.events);
      expect(after.batches).toEqual(before.batches);
      expect(after.taskProgress).toEqual(before.taskProgress);
      expect(game.arranged()).toBe(beforeNight.intervention);
    });

    it('重複標記同一則不再寫檔（signal 物件不變）', () => {
      game.newGame();
      game.markMessagesRead(['msg.a']);
      const after = game.save();
      game.markMessagesRead(['msg.a']);
      expect(game.save()).toBe(after);
      game.markMessagesRead([]);
      expect(game.save()).toBe(after);
    });

    it('已讀跨日保留，重新 inject 後仍在', () => {
      game.newGame();
      game.markMessagesRead(['msg.a']);
      playArchiveDaysUntil(game, DAY_02);
      expect(game.isMessageRead('msg.a')).toBeTrue();
      const restored = freshService();
      expect(restored.isMessageRead('msg.a')).toBeTrue();
      expect(restored.isMessageRead('msg.b')).toBeFalse();
    });
  });

  describe('從 localStorage 復原', () => {
    it('走到 Day 2 後重新 inject → dayId／stage 相同、night 相同（刷新不重算）', () => {
      playToDay2(game, 'request_review');
      const before = game.save()!;

      const restored = freshService();
      expect(restored).not.toBe(game);
      expect(restored.hasSave()).toBeTrue();
      expect(restored.storageIssue()).toBe('');
      expect(restored.dayId()).toBe(DAY_02);
      expect(restored.stage()).toBe('work');
      expect(restored.taskId()).toBe(TASK_DAY2);
      expect(restored.night()).toEqual(before.night!);
      expect(restored.save()).toEqual(JSON.parse(JSON.stringify(before)));
      expect(restored.arranged()).toBe(game.arranged());
      restored.advanceDay();
      expect(restored.save()!.events.filter((e) => e.kind === 'night.resolved').length).toBe(1);
    });

    it('歸檔後重新 inject → B102.archiveCode 仍是字串 "0102"（前導零不消失）', () => {
      game.newGame();
      game.updateDraft('B102', { value: '0102', policy: 'default_false' });
      game.archive('B102', okOf(game, 'B102'));
      const restored = freshService();
      expect(restored.archived('B102')!.archiveCode).toBe('0102');
      expect(typeof restored.archived('B102')!.archiveCode).toBe('string');
      expect(restored.archived('B102')!.source.code).toBe('0102');
    });

    it('Day 1 草稿在重新 inject 後保留', () => {
      game.newGame();
      game.updateDraft('B102', { value: '01', policy: 'request_review' });
      const restored = freshService();
      expect(restored.stage()).toBe('work');
      expect(restored.dayId()).toBe(DAY_01);
      expect(restored.draft('B102')).toEqual({ value: '01', policy: 'request_review' });
    });

    it('wrap 存檔在重新 inject 後仍在 wrap，night 尚未判定', () => {
      game.newGame();
      finishToday(game);
      const restored = freshService();
      expect(restored.stage()).toBe('wrap');
      expect(restored.dayId()).toBe(DAY_01);
      expect(restored.taskId()).toBe(TASK_DAY1_FOLLOWUP);
      expect(restored.night()).toBeNull();
      expect(taskRows(restored)).toEqual([row(TASK_DAY1, 'done', 3, 3), row(TASK_DAY1_FOLLOWUP, 'done', 3, 3)]);
    });

    it('Day 4 中途重新 inject → 只保留 Day 4 批次的進度', () => {
      playToDay3(game);
      playArchiveDaysUntil(game, DAY_04);
      game.updateDraft('B716', { value: '0716', policy: 'request_review' });
      game.archive('B716', okOf(game, 'B716'));
      const restored = freshService();
      expect(restored.dayId()).toBe(DAY_04);
      expect(restored.records().length).toBe(6);
      expect(restored.archivedCount()).toBe(1);
      expect(restored.archived('B716')!.origin).toBe('review');
      expect(restored.progressText()).toBe('第四日');
    });
  });

  /* ---------- 舊檔遷移 ---------- */

  describe('v6 舊檔遷移（R8）', () => {
    /** 載入 v6 → 應寫回 v11，只多 waivedTasks、空 caseReviews、空 returns、空 issueSchedule 與 R12 欄位（沒有回條＝空郵件）；其他欄位（含事件）逐字保留。 */
    function loadV6(v6: SaveV6, waived: string[]): GameStateService {
      const raw = JSON.stringify(v6);
      localStorage.setItem(SAVE_KEY, raw);
      expect(new SaveRepository().load().migratedFrom).toBe(6);
      const g = freshService();
      expect(g.hasSave()).toBeTrue();
      expect(g.storageIssue()).toBe('');
      const s = stored()!;
      expect(s.version).toBe(11);
      expect(s.waivedTasks).toEqual(waived);
      expect(s).toEqual({ ...JSON.parse(raw), version: 11, caseReviews: {}, returns: [], issueSchedule: {}, ...V11_MIGRATED_EMPTY, waivedTasks: waived });
      expect(s.events).toEqual(v6.events);
      expect(s.batches).toEqual(v6.batches);
      expect(s.taskProgress).toEqual(v6.taskProgress);
      expect(s.chatReplies).toEqual(v6.chatReplies);
      expect(s.readMessages).toEqual(v6.readMessages);
      expect(s.night).toEqual(v6.night);
      expect(g.save()).toEqual(s);
      expect(new SaveRepository().load().migratedFrom).toBe(11);
      expect(storedIsValid()).toBeTrue();
      return g;
    }

    it('Day 1 work 批次中途 → 不免補；做完第一件後接著做補入批次', () => {
      const g = loadV6(legacyV6Day1Work, []);
      expect(g.dayId()).toBe(DAY_01);
      expect(g.stage()).toBe('work');
      expect(g.taskId()).toBe(TASK_DAY1);
      expect(g.archivedCount()).toBe(1);
      expect(g.draft('H17')).toEqual({ value: 'H-1' });
      expect(g.chatChoice('prompt.day1.welcome')).toBe('thanks');
      expect(taskRows(g)).toEqual([row(TASK_DAY1, 'active', 3, 1), row(TASK_DAY1_FOLLOWUP, 'pending', 3, 0)]);
      archiveCurrent(g, 'default_false');
      expect(g.completeWork()).toBeTrue();
      expect(g.stage()).toBe('work');
      expect(g.taskId()).toBe(TASK_DAY1_FOLLOWUP);
      archiveCurrent(g, 'default_false');
      expect(g.completeWork()).toBeTrue();
      expect(g.stage()).toBe('wrap');
      expect(taskRows(g)).toEqual([row(TASK_DAY1, 'done', 3, 3), row(TASK_DAY1_FOLLOWUP, 'done', 3, 3)]);
      expect(storedIsValid()).toBeTrue();
    });

    it('Day 1 wrap → 補入批次免補（顯示 waived，不算已提交）→ advanceDay → Day 2 morning → 核對 → 今日新件', () => {
      const g = loadV6(legacyV6Day1Wrap, [TASK_DAY1_FOLLOWUP]);
      expect(g.stage()).toBe('wrap');
      expect(g.progressText()).toBe('第一日交接完成');
      expect(taskRows(g)).toEqual([row(TASK_DAY1, 'done', 3, 3), row(TASK_DAY1_FOLLOWUP, 'waived', 3, 0)]);
      expect(g.save()!.batches[BATCH_DAY01_FOLLOWUP]).toBeUndefined();
      expect(g.dayEvents().some((e) => (e.payload as { taskId?: string }).taskId === TASK_DAY1_FOLLOWUP)).toBeFalse();
      g.advanceDay();
      expect(g.dayId()).toBe(DAY_02);
      expect(g.stage()).toBe('morning');
      expect(g.taskId()).toBe(TASK_DAY2);
      expect(g.progressText()).toBe('第二日收件');
      expect(countKind(g, 'night.resolved')).toBe(1);
      g.startDay();
      expect(replyAfterReview(g, 'ack')).toBeTrue();
      expect(g.stage()).toBe('work');
      expect(g.taskId()).toBe(TASK_DAY2_ARCHIVE);
      expect(taskRows(g)).toEqual([row(TASK_DAY2, 'done', 2, 2), row(TASK_DAY2_ARCHIVE, 'active', 4, 0)]);
      expect(storedIsValid()).toBeTrue();
    });

    it('Day 2 work 核對 → 證據沿用；回覆後停在 work 接今日新件（目前日不免補）', () => {
      const g = loadV6(legacyV6Day2Work, [TASK_DAY1_FOLLOWUP]);
      expect(g.dayId()).toBe(DAY_02);
      expect(g.stage()).toBe('work');
      expect(g.taskId()).toBe(TASK_DAY2);
      expect(g.evidence()).toEqual({ reportOpened: true, receiptOpened: false });
      expect(g.night()).toEqual(NIGHT_V6);
      expect(g.arranged()).toBeTrue(); // B102 default_false
      expect(taskRows(g)).toEqual([row(TASK_DAY2, 'active', 2, 0), row(TASK_DAY2_ARCHIVE, 'pending', 4, 0)]);
      expect(g.isLastTask()).toBeFalse();
      // 舊檔在 Day 2 核對進行中：沒有審查處置 → 仍須逐筆審查才能回覆（不補造放行）
      expect(g.reconcile()!.reviews).toBeUndefined();
      expect(g.canReply('ack')).toBeFalse();
      reviewAll(g);
      expect(g.submitReply('ack')).toBeTrue();
      expect(g.taskId()).toBe(TASK_DAY2_ARCHIVE);
      expect(g.isLastTask()).toBeTrue();
      archiveCurrent(g, 'default_false');
      expect(g.completeWork()).toBeTrue();
      expect(g.stage()).toBe('wrap');
      expect(g.save()!.waivedTasks).toEqual([TASK_DAY1_FOLLOWUP]);
      g.advanceDay();
      expect([g.dayId(), g.stage(), g.taskId()]).toEqual([DAY_03, 'morning', TASK_DAY3]);
      expect(storedIsValid()).toBeTrue();
    });

    it('Day 2 wrap → Day 1、Day 2 新工作免補；advanceDay → Day 3 morning → startDay，不會卡住', () => {
      const g = loadV6(legacyV6Day2Wrap, WAIVED_THROUGH_DAY2);
      expect(g.stage()).toBe('wrap');
      expect(g.taskId()).toBe(TASK_DAY2);
      expect(g.reply()).toBe('review');
      expect(g.progressText()).toBe('第二日交接完成');
      expect(taskRows(g)).toEqual([row(TASK_DAY2, 'done', 2, 2), row(TASK_DAY2_ARCHIVE, 'waived', 4, 0)]);
      expect(g.completeWork()).toBeFalse();
      g.advanceDay();
      expect(g.dayId()).toBe(DAY_03);
      expect(g.stage()).toBe('morning');
      expect(g.taskId()).toBe(TASK_DAY3);
      expect(g.progressText()).toBe('第三日收件');
      expect(g.night()).toEqual(NIGHT_V6);
      expect(countKind(g, 'night.resolved')).toBe(1);
      expect(g.save()!.events).toEqual(legacyV6Day2Wrap.events);
      g.startDay();
      expect(g.stage()).toBe('work');
      expect(g.progressText()).toBe('第三日');
      finishToday(g);
      expect(g.stage()).toBe('wrap');
      expect(storedIsValid()).toBeTrue();
      expect(freshService().save()).toEqual(JSON.parse(JSON.stringify(g.save()!)));
    });

    it('Day 4 work 中途 → R7 回覆與 review 分支沿用；可完成當日並進 Day 5 morning', () => {
      const g = loadV6(legacyV6Day4Work, WAIVED_THROUGH_DAY2);
      expect(g.dayId()).toBe(DAY_04);
      expect(g.taskId()).toBe(TASK_DAY4);
      expect(g.archivedCount()).toBe(1);
      expect(g.archived('B716')!.origin).toBe('review');
      expect(g.draft('B731')).toEqual({ value: '07' });
      expect(g.isMessageRead('msg.day4.dept-report')).toBeTrue();
      expect(g.chatChoice(PROMPT_LUNCH)).toBe('join');
      expect(unlockedIds(g, WU_DM)).toEqual([LUNCH_DM['join']]);
      for (const id of REVIEW_ANY_MSGS) expect(unlockedIds(g, LUNCH_CHAT)).toContain(id);
      expect(g.isPromptOpen(PROMPT_REVIEW_RETURNED)).toBeTrue();
      expect(taskRows(g)).toEqual([row(TASK_DAY4, 'active', 6, 1)]);
      finishToday(g);
      g.advanceDay();
      expect([g.dayId(), g.stage(), g.taskId()]).toEqual([DAY_05, 'morning', TASK_DAY5]);
      expect(storedIsValid()).toBeTrue();
    });
  });

  describe('v5 舊檔遷移', () => {
    it('v5 Day 4 中途 → 寫回 v11：新增空 chatReplies、免補清單、空 caseReviews、空 returns 與空排程／已讀回條，batches／taskProgress／events／readMessages 不變', () => {
      const v5 = toV5(legacyV6Day4Work);
      const raw = JSON.stringify(v5);
      localStorage.setItem(SAVE_KEY, raw);
      expect(new SaveRepository().load().migratedFrom).toBe(5);

      const g = freshService();
      expect(g.storageIssue()).toBe('');
      expect(g.dayId()).toBe(DAY_04);
      expect(g.stage()).toBe('work');
      expect(g.archived('B716')!.origin).toBe('review');
      expect(g.isMessageRead('msg.day4.dept-report')).toBeTrue();

      const s = stored()!;
      expect(s.version).toBe(11);
      expect(s.chatReplies).toEqual({});
      expect(s.waivedTasks).toEqual(WAIVED_THROUGH_DAY2);
      expect(s).toEqual({ ...JSON.parse(raw), version: 11, caseReviews: {}, returns: [], issueSchedule: {}, ...V11_MIGRATED_EMPTY, chatReplies: {}, waivedTasks: WAIVED_THROUGH_DAY2 });
      expect(s.batches).toEqual(v5.batches);
      expect(s.taskProgress).toEqual(v5.taskProgress);
      expect(s.events).toEqual(v5.events);
      expect(s.readMessages).toEqual(v5.readMessages);
      expect(s.night).toEqual(v5.night!);
      expect(new SaveRepository().load().migratedFrom).toBe(11);
      expect(storedIsValid()).toBeTrue();

      // 遷移後可接著回答當日 prompt 並完成當日
      expect(g.isPromptOpen(PROMPT_REVIEW_RETURNED)).toBeTrue();
      finishToday(g);
      expect(g.stage()).toBe('wrap');
      expect(storedIsValid()).toBeTrue();
    });
  });

  describe('v4 舊檔遷移', () => {
    it('v4 Day 2 end（當時最後一天）→ v11 Day 2 wrap，寫回 localStorage，可直接接 Day 3 morning（沒有審查處置 → 不產生退件）', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV4Day2End));
      const g = freshService();

      expect(g.hasSave()).toBeTrue();
      expect(g.storageIssue()).toBe('');
      expect(g.dayId()).toBe(DAY_02);
      expect(g.stage()).toBe('wrap');
      expect(g.taskId()).toBe(TASK_DAY2);
      expect(g.reply()).toBe('ask');
      expect(g.evidence()).toEqual({ reportOpened: true, receiptOpened: false });
      expect(taskRows(g)).toEqual([row(TASK_DAY2, 'done', 2, 2), row(TASK_DAY2_ARCHIVE, 'waived', 4, 0)]);
      expect(g.progressText()).toBe('第二日交接完成');
      expect(g.night()).toEqual(legacyV4Day2End.night!);
      expect(g.isMessageRead('msg.a')).toBeTrue();

      // 已寫回 v11
      const s = stored()!;
      expect(s.version).toBe(11);
      expect(s.returns).toEqual([]);
      expect(s.issueSchedule).toEqual({});
      expect(s.mailbox).toEqual([]);
      expect(s.readMail).toEqual([]);
      expect(s.onboarding).toEqual({ step: 0, complete: true });
      expect(s.profile).toEqual({ name: null });
      expect(s.chatReplies).toEqual({});
      expect(s.waivedTasks).toEqual(WAIVED_THROUGH_DAY2);
      expect(s.events).toEqual(legacyV4Day2End.events);
      expect(s.stage).toBe('wrap');
      expect(s.taskProgress).toEqual({ [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false, reply: 'ask' } });
      const raw = s as unknown as Record<string, unknown>;
      expect(raw['evidence']).toBeUndefined();
      expect(raw['reply']).toBeUndefined();
      expect(s).toEqual(JSON.parse(JSON.stringify(g.save()!)));
      expect(new SaveRepository().load().migratedFrom).toBe(11);
      expect(storedIsValid()).toBeTrue();

      g.advanceDay();
      expect(g.save()!.returns).toEqual([]);
      expect(g.dayId()).toBe(DAY_03);
      expect(g.stage()).toBe('morning');
      expect(g.taskId()).toBe(TASK_DAY3);
      expect(g.progressText()).toBe('第三日收件');
      g.startDay();
      expect(g.stage()).toBe('work');
      expect(g.progressText()).toBe('第三日');
      expect(g.night()).toEqual(legacyV4Day2End.night!);
      expect(g.save()!.events.filter((e) => e.kind === 'night.resolved').length).toBe(1);
      expect(storedIsValid()).toBeTrue();
    });

    it('現行 v11 載入不會再寫回（localStorage 字串不變；migratedFrom 11）', () => {
      game.newGame();
      const raw = localStorage.getItem(SAVE_KEY)!;
      expect(new SaveRepository().load().migratedFrom).toBe(11);
      const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
      const g = freshService();
      expect(g.hasSave()).toBeTrue();
      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });
  });

  describe('v2 舊檔遷移', () => {
    it('載入合法 v2 → 可直接續玩，且 localStorage 已寫回 v11（Day 1 補入批次免補）', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV2Day2));
      const g = freshService();

      expect(g.hasSave()).toBeTrue();
      expect(g.storageIssue()).toBe('');
      expect(g.dayId()).toBe(DAY_02);
      expect(g.stage()).toBe('work');
      expect(g.taskId()).toBe(TASK_DAY2);
      expect(g.progressText()).toBe('第二日');
      expect(g.batchId()).toBe(BATCH_DAY01);
      expect(g.archived('B102')!.archiveCode).toBe('0102');
      expect(g.archived('B102')!.source).toEqual(snapOf('B102'));
      expect(g.archivedCount()).toBe(3);
      expect(g.night()).toEqual(legacyV2Day2.night!);
      expect(g.arranged()).toBeTrue();
      expect(g.save()!.events).toEqual(legacyV2Day2.events);

      expect(stored()!.version).toBe(11);
      expect(stored()!.returns).toEqual([]);
      expect(stored()!.issueSchedule).toEqual({});
      expect(stored()!.mailbox).toEqual([]);
      expect(stored()!.readMail).toEqual([]);
      expect(stored()!.onboarding).toEqual({ step: 0, complete: true });
      expect(stored()!.waivedTasks).toEqual([TASK_DAY1_FOLLOWUP]);
      expect(stored()!.chatReplies).toEqual({});
      expect(stored()!.stage).toBe('work');
      expect(stored()!.dayId).toBe(DAY_02);
      expect(stored()!.readMessages).toEqual([]);
      expect((stored() as unknown as Record<string, unknown>)['phase']).toBeUndefined();
      expect(stored()).toEqual(JSON.parse(JSON.stringify(g.save()!)));
      expect(storedIsValid()).toBeTrue();
    });

    it('不會每次載入都重新遷移', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV2Day2));
      const first = freshService();
      const afterFirst = localStorage.getItem(SAVE_KEY)!;
      expect(JSON.parse(afterFirst).version).toBe(11);
      expect(new SaveRepository().load().migratedFrom).toBe(11);

      const second = freshService();
      expect(second.storageIssue()).toBe('');
      expect(second.save()).toEqual(JSON.parse(afterFirst));
      expect(JSON.stringify(second.save())).toBe(JSON.stringify(first.save()!));
      expect(localStorage.getItem(SAVE_KEY)).toBe(afterFirst);
    });

    it('day1 的 v2 舊檔遷移後可以接著歸檔、接補入批次並完成當日', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV2Day1));
      const g = freshService();
      expect(g.dayId()).toBe(DAY_01);
      expect(g.stage()).toBe('work');
      expect(g.archivedCount()).toBe(1);
      expect(g.draft('H17')).toEqual({ value: 'H-1' });
      expect(stored()!.version).toBe(11);
      expect(stored()!.chatReplies).toEqual({});
      expect(stored()!.waivedTasks).toEqual([]);

      g.updateDraft('H17', { value: 'H-17' });
      g.archive('H17', okOf(g, 'H17'));
      g.updateDraft('B607', { value: '0607' });
      g.archive('B607', okOf(g, 'B607'));
      expect(g.completeWork()).toBeTrue();
      expect(g.stage()).toBe('work');
      expect(g.taskId()).toBe(TASK_DAY1_FOLLOWUP);
      archiveCurrent(g, 'default_false');
      expect(g.completeWork()).toBeTrue();
      expect(g.stage()).toBe('wrap');
      expect(storedIsValid()).toBeTrue();
    });

    it('遷移後 Day 2 回覆 → 接今日新件（不是 wrap／end），證據狀態沿用；完成後 wrap', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV2Day2));
      const g = freshService();
      expect(g.evidence()).toEqual({ reportOpened: true, receiptOpened: false });
      expect(g.canReply('ack')).toBeFalse(); // R10：尚未逐筆審查
      reviewAll(g);
      expect(g.canReply('ack')).toBeTrue();
      expect(g.canReply('review')).toBeFalse();
      g.openReceipt();
      expect(g.submitReply('review')).toBeTrue();
      expect(g.stage()).toBe('work');
      expect(g.taskId()).toBe(TASK_DAY2_ARCHIVE);
      archiveCurrent(g, 'default_false');
      expect(g.completeWork()).toBeTrue();
      expect(g.stage()).toBe('wrap');
      expect(g.nextDayId()).toBe(DAY_03);
      expect(storedIsValid()).toBeTrue();
    });
  });

  describe('v3 舊檔遷移', () => {
    it('載入合法 v3（overnight）→ day.01／wrap，已讀與批次保留，且 localStorage 已寫回 v11', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV3Overnight));
      const g = freshService();

      expect(g.storageIssue()).toBe('');
      expect(g.dayId()).toBe(DAY_01);
      expect(g.stage()).toBe('wrap');
      expect(g.taskId()).toBe(TASK_DAY1);
      expect(g.progressText()).toBe('第一日交接完成');
      expect(g.archivedCount()).toBe(3);
      expect(g.draft('B607')).toEqual({ value: '0607' });
      expect(g.isMessageRead('msg.a')).toBeTrue();
      expect(g.night()).toBeNull();

      expect(stored()!.version).toBe(11);
      expect(stored()!.waivedTasks).toEqual([TASK_DAY1_FOLLOWUP]);
      expect(taskRows(g)).toEqual([row(TASK_DAY1, 'done', 3, 3), row(TASK_DAY1_FOLLOWUP, 'waived', 3, 0)]);
      expect(stored()!.chatReplies).toEqual({});
      expect(stored()!.readMessages).toEqual(['msg.a', 'msg.b']);
      expect(stored()!.batches).toEqual(legacyV3Overnight.batches);
      expect(new SaveRepository().load().migratedFrom).toBe(11);
      expect(storedIsValid()).toBeTrue();
    });

    it('v3 遷移後可接著跨日：夜間只判定一次並進 Day 2 morning', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV3Overnight));
      const g = freshService();
      g.advanceDay();
      expect(g.dayId()).toBe(DAY_02);
      expect(g.stage()).toBe('morning');
      expect(g.taskId()).toBe(TASK_DAY2);
      expect(g.night()).not.toBeNull();
      expect(g.save()!.events.filter((e) => e.kind === 'night.resolved').length).toBe(1);
      expect(storedIsValid()).toBeTrue();
      expect(freshService().night()).toEqual(g.night()!);
    });
  });

  describe('壞存檔', () => {
    it('壞 JSON → hasSave false、storageIssue readIssue、needsOverwriteConfirm true、原字串不被覆蓋', () => {
      localStorage.setItem(SAVE_KEY, '{');
      const g = freshService();
      expect(g.hasSave()).toBeFalse();
      expect(g.stage()).toBeNull();
      expect(g.storageIssue()).toBe(STORAGE.readIssue);
      expect(g.statusText()).toBe(STORAGE.readIssue);
      expect(g.needsOverwriteConfirm()).toBeTrue();
      expect(localStorage.getItem(SAVE_KEY)).toBe('{');
    });

    it('schema 不符 → 同樣提示且不覆蓋；newGame 後才取代並清除提示', () => {
      localStorage.setItem(SAVE_KEY, '{"version":5}');
      const g = freshService();
      expect(g.hasSave()).toBeFalse();
      expect(g.storageIssue()).toBe(STORAGE.readIssue);
      expect(localStorage.getItem(SAVE_KEY)).toBe('{"version":5}');

      g.newGame();
      expect(g.hasSave()).toBeTrue();
      expect(g.storageIssue()).toBe('');
      expect(g.statusText()).toBe(STORAGE.saved);
      expect(storedIsValid()).toBeTrue();
    });

    it('殘缺的 v2～v11（無法轉換）→ 提示且不覆蓋', () => {
      for (const raw of ['{"version":2}', '{"version":3}', '{"version":4}', '{"version":6}', '{"version":7}', '{"version":8}', '{"version":9}', '{"version":10}', '{"version":11}']) {
        localStorage.setItem(SAVE_KEY, raw);
        const g = freshService();
        expect(g.hasSave()).toBeFalse();
        expect(g.storageIssue()).toBe(STORAGE.readIssue);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });

    it('v11 但 dayId 與 taskId 矛盾 → 提示且不覆蓋', () => {
      game.newGame();
      const raw = JSON.stringify({ ...game.save()!, taskId: TASK_DAY2 });
      localStorage.setItem(SAVE_KEY, raw);
      const g = freshService();
      expect(g.hasSave()).toBeFalse();
      expect(g.storageIssue()).toBe(STORAGE.readIssue);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });

    it('v10 Day 2 卻是 end（有下一日）→ 提示且不覆蓋', () => {
      playToDay2(game, 'default_false');
      finishToday(game);
      const raw = JSON.stringify({ ...game.save()!, stage: 'end' });
      localStorage.setItem(SAVE_KEY, raw);
      const g = freshService();
      expect(g.hasSave()).toBeFalse();
      expect(g.storageIssue()).toBe(STORAGE.readIssue);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });
  });

  /* ---------- R7 訊息固定回覆 ---------- */

  describe('固定回覆（R7）', () => {
    it('內容中 Day 1–6 的 prompt 都在測試表內（提問說明的 prompt 另測，見「向同事詢問」）', () => {
      const dayPrompts = ALL_PROMPTS.filter((e) => helpRequestOfMessage(e.anchor.id) === undefined);
      expect(dayPrompts.map((e) => e.prompt.id).sort()).toEqual(PROMPT_CASES.map((c) => c.promptId).sort());
      expect(ALL_PROMPTS.filter((e) => helpRequestOfMessage(e.anchor.id) !== undefined).map((e) => e.prompt.id)).toEqual([HELP_PROMPT]);
      for (const c of PROMPT_CASES) expect(promptOf(c.promptId)!.anchor.visibleFrom).withContext(c.promptId).toBe(c.dayId);
    });

    it('無存檔時：chatReply undefined、chatChoice null、不可回答／不回覆，不建立存檔', () => {
      for (const c of PROMPT_CASES) {
        expect(game.chatReply(c.promptId)).toBeUndefined();
        expect(game.chatChoice(c.promptId)).toBeNull();
        expect(game.isPromptOpen(c.promptId)).toBeFalse();
        expect(game.answerPrompt(c.promptId, promptOf(c.promptId)!.prompt.choices[0].id)).toBeFalse();
        expect(game.skipPrompt(c.promptId)).toBeFalse();
      }
      expect(game.conditionContext()).toBeNull();
      expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    });

    it('Day 1 開局只有 Day 1 的 prompt 可回答；未知 prompt 一律不可回答', () => {
      game.newGame();
      for (const c of PROMPT_CASES) expect(game.isPromptOpen(c.promptId)).withContext(c.promptId).toBe(c.dayId === DAY_01);
      expect(game.isPromptOpen(HELP_PROMPT)).toBeFalse(); // 尚未提問
      expect(game.isPromptOpen('prompt.nope')).toBeFalse();
      expect(game.answerPrompt('prompt.nope', 'x')).toBeFalse();
      expect(game.skipPrompt('prompt.nope')).toBeFalse();
      expect(stored()!.chatReplies).toEqual({});
    });

    for (const c of PROMPT_CASES) {
      describe(c.promptId, () => {
        const entry = promptOf(c.promptId)!;

        it(`${c.dayId} 錨點解鎖後可回答；其他 prompt 不因此改變`, () => {
          c.reach(game);
          expect(game.dayId()).toBe(c.dayId);
          expect(game.isPromptOpen(c.promptId)).toBeTrue();
          expect(game.chatReply(c.promptId)).toBeUndefined();
          expect(game.chatChoice(c.promptId)).toBeNull();
          expect(game.conditionContext()!.chatChoice(c.promptId)).toBeNull();
          expect(unlockedIds(game, entry.anchor.channelId)).toContain(entry.anchor.id);
        });

        for (const choice of entry.prompt.choices) {
          it(`回答 ${choice.id}：保存文字與回應快照、回答時間／遊戲日／逐則送達時間（時鐘）、寫 chat.reply、只成功一次、重載後相同`, () => {
            c.reach(game);
            const clock = TestBed.inject(GameClock);
            clock.now = () => T0;
            clock.random = () => 0.5;
            const before = game.save()!;
            expect(game.answerPrompt(c.promptId, choice.id)).toBeTrue();
            const after = game.save()!;

            const expected = {
              kind: 'answered',
              choiceId: choice.id,
              playerText: choice.text,
              responses: choice.responses.map((r, i) => ({
                id: r.id,
                actorId: r.actorId,
                time: r.time,
                lines: [...r.lines],
                deliverAt: T0 + 3500 * (i + 1),
              })),
              answeredAt: T0,
              dayId: c.dayId,
            };
            expect(after.chatReplies).toEqual({ [c.promptId]: expected } as Save['chatReplies']);
            expect(game.chatReply(c.promptId)).toEqual(expected as never);
            expect(game.chatChoice(c.promptId)).toBe(choice.id);
            expect(game.conditionContext()!.chatChoice(c.promptId)).toBe(choice.id);
            // 快照是複本，不與內容物件共用參照
            const snap = game.chatReply(c.promptId);
            if (snap?.kind !== 'answered') throw new Error('expected answered');
            expect(snap.responses).not.toBe(choice.responses as never);
            snap.responses.forEach((r, i) => expect(r.lines).not.toBe(choice.responses[i].lines as never));

            // 事件：只多一筆 chat.reply，payload 只有 promptId、choiceId
            expect(after.events.length).toBe(before.events.length + 1);
            const ev = after.events[after.events.length - 1];
            expect(ev.kind).toBe('chat.reply');
            expect(ev.payload).toEqual({ promptId: c.promptId, choiceId: choice.id });
            expect(after.events.slice(0, -1)).toEqual(before.events);

            // 不動工作進度
            expect(workFields(after)).toEqual(workFields(before));
            expect(stored()).toEqual(JSON.parse(JSON.stringify(after)));
            expect(storedIsValid()).toBeTrue();

            // 重複點擊／改選／改為不回覆都拒絕，存檔不變
            const raw = localStorage.getItem(SAVE_KEY);
            expect(game.isPromptOpen(c.promptId)).toBeFalse();
            for (const other of entry.prompt.choices) expect(game.answerPrompt(c.promptId, other.id)).toBeFalse();
            expect(game.skipPrompt(c.promptId)).toBeFalse();
            expect(game.save()).toBe(after);
            expect(localStorage.getItem(SAVE_KEY)).toBe(raw);

            // 重載：同一份 storage 的新 service 保留回覆且不可再答
            const restored = freshService();
            expect(restored.storageIssue()).toBe('');
            expect(restored.chatReply(c.promptId)).toEqual(expected as never);
            expect(restored.chatChoice(c.promptId)).toBe(choice.id);
            expect(restored.isPromptOpen(c.promptId)).toBeFalse();
            expect(restored.answerPrompt(c.promptId, choice.id)).toBeFalse();
            expect(restored.skipPrompt(c.promptId)).toBeFalse();
            expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
          });
        }

        it('不回覆：只保存 skipped、寫 chat.skip；之後不可回答，重載後相同', () => {
          c.reach(game);
          const before = game.save()!;
          expect(game.skipPrompt(c.promptId)).toBeTrue();
          const after = game.save()!;
          expect(after.chatReplies).toEqual({ [c.promptId]: { kind: 'skipped' } });
          expect(game.chatReply(c.promptId)).toEqual({ kind: 'skipped' });
          expect(game.chatChoice(c.promptId)).toBeNull();
          expect(game.conditionContext()!.chatChoice(c.promptId)).toBeNull();
          expect(after.events.length).toBe(before.events.length + 1);
          const ev = after.events[after.events.length - 1];
          expect(ev.kind).toBe('chat.skip');
          expect(ev.payload).toEqual({ promptId: c.promptId });
          expect(workFields(after)).toEqual(workFields(before));
          expect(storedIsValid()).toBeTrue();

          const raw = localStorage.getItem(SAVE_KEY);
          expect(game.isPromptOpen(c.promptId)).toBeFalse();
          expect(game.skipPrompt(c.promptId)).toBeFalse();
          for (const choice of entry.prompt.choices) expect(game.answerPrompt(c.promptId, choice.id)).toBeFalse();
          expect(game.save()).toBe(after);
          expect(localStorage.getItem(SAVE_KEY)).toBe(raw);

          const restored = freshService();
          expect(restored.chatReply(c.promptId)).toEqual({ kind: 'skipped' });
          expect(restored.isPromptOpen(c.promptId)).toBeFalse();
          expect(restored.answerPrompt(c.promptId, entry.prompt.choices[0].id)).toBeFalse();
        });

        it('未知 choice → false、不寫入，prompt 仍可回答', () => {
          c.reach(game);
          const before = game.save();
          const raw = localStorage.getItem(SAVE_KEY);
          expect(game.answerPrompt(c.promptId, 'no-such-choice')).toBeFalse();
          expect(game.save()).toBe(before);
          expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
          expect(game.isPromptOpen(c.promptId)).toBeTrue();
        });

        const lastDay = c.dayId === DAY_06;
        it(
          lastDay
            ? '最後一天：完成工作後（end）當天仍可回答；availableThrough 為當日'
            : '同日 wrap 仍可回答；跨過 availableThrough 未回覆 → 不可回答、answer/skip false、不寫入',
          () => {
            expect(entry.prompt.availableThrough).toBe(c.dayId);
            c.reach(game);
            finishToday(game);
            expect(game.dayId()).toBe(c.dayId);
            expect(game.isPromptOpen(c.promptId)).toBeTrue();
            if (lastDay) {
              expect(game.stage()).toBe('end');
              return;
            }
            game.advanceDay();
            expect(game.dayId()).not.toBe(c.dayId);
            expect(game.isPromptOpen(c.promptId)).toBeFalse();
            const before = game.save();
            const raw = localStorage.getItem(SAVE_KEY);
            for (const choice of entry.prompt.choices) expect(game.answerPrompt(c.promptId, choice.id)).toBeFalse();
            expect(game.skipPrompt(c.promptId)).toBeFalse();
            expect(game.save()).toBe(before);
            expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
            expect(game.chatReply(c.promptId)).toBeUndefined();
            expect(stored()!.chatReplies).toEqual({});
            expect(game.save()!.events.some((e) => e.kind === 'chat.reply' || e.kind === 'chat.skip')).toBeFalse();
            // 錨點訊息仍留在頻道歷史
            expect(unlockedIds(game, entry.anchor.channelId)).toContain(entry.anchor.id);
            expect(freshService().isPromptOpen(c.promptId)).toBeFalse();
          },
        );
      });
    }

    it('Day 1 回答後 Day 1–6 工作流程照常；回覆跨日保留', () => {
      game.newGame();
      expect(game.answerPrompt('prompt.day1.welcome', 'thanks')).toBeTrue();
      finishToday(game);
      nextDay(game);
      expect(game.skipPrompt('prompt.day2.check-in')).toBeTrue();
      finishToday(game);
      nextDay(game);
      expect(game.answerPrompt(PROMPT_LUNCH, 'join')).toBeFalse(); // 午餐訊息尚未解鎖
      archiveCurrent(game, 'default_false', 2);
      expect(game.answerPrompt(PROMPT_LUNCH, 'join')).toBeTrue();
      playArchiveDaysUntil(game, DAY_06);
      finishToday(game);
      expect(game.stage()).toBe('end');
      expect(game.chatChoice('prompt.day1.welcome')).toBe('thanks');
      expect(game.chatReply('prompt.day2.check-in')).toEqual({ kind: 'skipped' });
      expect(game.chatChoice(PROMPT_LUNCH)).toBe('join');
      expect(game.save()!.events.filter((e) => e.kind === 'chat.reply').length).toBe(2);
      expect(game.save()!.events.filter((e) => e.kind === 'chat.skip').length).toBe(1);
      expect(storedIsValid()).toBeTrue();
      expect(freshService().save()).toEqual(JSON.parse(JSON.stringify(game.save()!)));
    });

    describe('Day 4 review.any／none 分支', () => {
      it('Day 3 有送覆核 → review-returned 可回答、quick-close 不可回答；訊息只見 any 分支', () => {
        playToDay4(game, 'request_review');
        const ids = unlockedIds(game, LUNCH_CHAT);
        for (const id of REVIEW_ANY_MSGS) expect(ids).toContain(id);
        for (const id of REVIEW_NONE_MSGS) expect(ids).not.toContain(id);
        expect(game.isPromptOpen(PROMPT_REVIEW_RETURNED)).toBeTrue();
        expect(game.isPromptOpen(PROMPT_QUICK_CLOSE)).toBeFalse();
        const before = game.save();
        expect(game.answerPrompt(PROMPT_QUICK_CLOSE, 'is-praise')).toBeFalse();
        expect(game.skipPrompt(PROMPT_QUICK_CLOSE)).toBeFalse();
        expect(game.save()).toBe(before);
      });

      it('Day 3 全部預設 → quick-close 可回答、review-returned 不可回答；訊息只見 none 分支', () => {
        playToDay4(game, 'default_false');
        const ids = unlockedIds(game, LUNCH_CHAT);
        for (const id of REVIEW_NONE_MSGS) expect(ids).toContain(id);
        for (const id of REVIEW_ANY_MSGS) expect(ids).not.toContain(id);
        expect(game.isPromptOpen(PROMPT_QUICK_CLOSE)).toBeTrue();
        expect(game.isPromptOpen(PROMPT_REVIEW_RETURNED)).toBeFalse();
        const before = game.save();
        expect(game.answerPrompt(PROMPT_REVIEW_RETURNED, 'ask-useful')).toBeFalse();
        expect(game.skipPrompt(PROMPT_REVIEW_RETURNED)).toBeFalse();
        expect(game.save()).toBe(before);
      });
    });

    describe('Day 3 午餐回答 → Day 4 吳婉庭私訊（conditionContext.chatChoice）', () => {
      for (const choiceId of Object.keys(LUNCH_DM)) {
        for (const policy of ['request_review', 'default_false'] as const) {
          it(`${choiceId}（Day 3 ${policy}）→ Day 4 只解鎖 ${LUNCH_DM[choiceId]}；review 分支不受影響`, () => {
            reachDay3Lunch(game);
            expect(game.answerPrompt(PROMPT_LUNCH, choiceId)).toBeTrue();
            expect(unlockedIds(game, WU_DM)).toEqual([]); // Day 3 尚未到 visibleFrom
            finishToday(game, policy);
            nextDay(game);
            expect(game.dayId()).toBe(DAY_04);
            expect(game.conditionContext()!.chatChoice(PROMPT_LUNCH)).toBe(choiceId);
            expect(unlockedIds(game, WU_DM)).toEqual([LUNCH_DM[choiceId]]);

            const lunch = unlockedIds(game, LUNCH_CHAT);
            const [shown, hidden] = policy === 'request_review' ? [REVIEW_ANY_MSGS, REVIEW_NONE_MSGS] : [REVIEW_NONE_MSGS, REVIEW_ANY_MSGS];
            for (const id of shown) expect(lunch).toContain(id);
            for (const id of hidden) expect(lunch).not.toContain(id);

            const restored = freshService();
            expect(unlockedIds(restored, WU_DM)).toEqual([LUNCH_DM[choiceId]]);
            // 之後各日仍留在歷史
            finishToday(restored);
            restored.advanceDay();
            expect(restored.dayId()).toBe(DAY_05);
            expect(restored.stage()).toBe('morning');
            expect(unlockedIds(restored, WU_DM)).toEqual([LUNCH_DM[choiceId]]);
          });
        }
      }

      it('Day 3 不回覆 → Day 4 私訊一則都不解鎖', () => {
        reachDay3Lunch(game);
        expect(game.skipPrompt(PROMPT_LUNCH)).toBeTrue();
        finishToday(game, 'request_review');
        game.advanceDay();
        expect(game.conditionContext()!.chatChoice(PROMPT_LUNCH)).toBeNull();
        expect(unlockedIds(game, WU_DM)).toEqual([]);
        expect(unlockedIds(freshService(), WU_DM)).toEqual([]);
      });

      it('Day 3 未回答就跨日 → Day 4 私訊一則都不解鎖，也不能補答', () => {
        playToDay3(game);
        finishToday(game, 'default_false');
        game.advanceDay();
        expect(game.conditionContext()!.chatChoice(PROMPT_LUNCH)).toBeNull();
        expect(unlockedIds(game, WU_DM)).toEqual([]);
        expect(game.answerPrompt(PROMPT_LUNCH, 'join')).toBeFalse();
        expect(unlockedIds(game, WU_DM)).toEqual([]);
      });
    });

    it('內容已移除的 prompt 歷史仍可讀出，不可回答', () => {
      game.newGame();
      const snap = { kind: 'answered' as const, choiceId: 'x', playerText: '舊回覆', responses: [] };
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...game.save()!, chatReplies: { 'prompt.removed.old': snap } }));
      const g = freshService();
      expect(g.storageIssue()).toBe('');
      expect(g.chatReply('prompt.removed.old')).toEqual(snap);
      expect(g.chatChoice('prompt.removed.old')).toBe('x');
      expect(g.isPromptOpen('prompt.removed.old')).toBeFalse();
      expect(g.isPromptOpen('prompt.day1.welcome')).toBeTrue();
    });
  });

  /* ---------- R10：編號只驗型別、逐筆審查、延後退件、H204 可編輯編號、欄位映射依玩家對應 ---------- */

  describe('R10 人員編號只驗型別與必填（不比對來源）', () => {
    for (const code of ['102', '0103']) {
      it(`B102 以 "${code}" 歸檔：原樣保存（來源快照仍是 0102），同一條成功流程；刷新、跨日後都不被修回`, () => {
        game.newGame();
        game.updateDraft('B102', { value: code, policy: 'default_false' });
        const ok = okOf(game, 'B102');
        expect(ok).toEqual({ ok: true, code, refusal: false, origin: 'defaulted' });
        game.status.set('');
        game.archive('B102', ok);
        expect(game.status()).toBe(ARCHIVE_UI.statusArchived);
        const entry: ArchivedRecord = { archiveCode: code, refusal: false, origin: 'defaulted', source: snapOf('B102') };
        expect(game.archived('B102')).toEqual(entry);
        expect(game.archived('B102')!.source.code).toBe('0102');
        expect(storedBatch().archived['B102']).toEqual(entry);
        expect(storedIsValid()).toBeTrue();

        // 刷新：格式合法的「不同於來源」編號不是毀損存檔
        let g = freshService();
        expect(g.storageIssue()).toBe('');
        expect(g.archived('B102')).toEqual(entry);
        expect(typeof g.archived('B102')!.archiveCode).toBe('string');

        // 完成 Day 1 → Day 2（核對讀這個批次）→ Day 3
        for (const key of ['H17', 'B607'] as const) {
          g.updateDraft(key, { value: DAY1_SOURCE[key] });
          g.archive(key, okOf(g, key));
        }
        expect(g.completeWork()).toBeTrue();
        archiveCurrent(g, 'default_false');
        expect(g.completeWork()).toBeTrue();
        nextDay(g);
        expect(g.batchId()).toBe(BATCH_DAY01);
        expect(g.archived('B102')).toEqual(entry);
        g = freshService();
        expect(g.storageIssue()).toBe('');
        expect(g.archived('B102')!.archiveCode).toBe(code);
        finishDay2(g, { B102: 'hold' });
        nextDay(g);
        expect(g.dayId()).toBe(DAY_03);
        expect(stored()!.batches[BATCH_DAY01]!.archived['B102']).toEqual(entry);
        expect(freshService().storageIssue()).toBe('');
        expect(storedIsValid()).toBeTrue();
      });
    }

    it('兩筆填成相同編號：各自以 recordKey 保存兩份提交，不互相覆蓋、不合併', () => {
      game.newGame();
      game.updateDraft('B102', { value: '0607', policy: 'request_review' });
      game.archive('B102', okOf(game, 'B102'));
      game.updateDraft('B607', { value: '0607' });
      game.archive('B607', okOf(game, 'B607'));
      expect(game.archivedCount()).toBe(2);
      expect(game.archived('B102')).toEqual({ archiveCode: '0607', refusal: null, origin: 'review', source: snapOf('B102') });
      expect(game.archived('B607')).toEqual({ archiveCode: '0607', refusal: true, origin: 'source', source: snapOf('B607') });
      const events = game.save()!.events.filter((e) => e.kind === 'archive').map((e) => (e.payload as { key: string }).key);
      expect(events).toEqual(['B102', 'B607']);
      const restored = freshService();
      expect(restored.storageIssue()).toBe('');
      expect(Object.keys(stored()!.batches[BATCH_DAY01]!.archived).sort()).toEqual(['B102', 'B607']);
      expect(restored.archived('B102')!.archiveCode).toBe('0607');
      expect(restored.archived('B607')!.archiveCode).toBe('0607');
    });

    it('照玩家輸入保存：不 trim、不補零、不改大小寫', () => {
      game.newGame();
      game.updateDraft('H17', { value: ' h-17 ' });
      game.archive('H17', okOf(game, 'H17'));
      expect(game.archived('H17')!.archiveCode).toBe(' h-17 ');
      expect(freshService().archived('H17')!.archiveCode).toBe(' h-17 ');
      expect(storedIsValid()).toBeTrue();
    });

    it('空白與非文字編號被拒絕（codeRequired），不寫入；純空白視為未填', () => {
      game.newGame();
      for (const value of ['', '   ', '\t']) {
        game.updateDraft('B102', { value, policy: 'default_false' });
        const r = game.validate('B102');
        expect(r).withContext(JSON.stringify(value)).toEqual({ ok: false, error: VALIDATION_MESSAGES.codeRequired });
      }
      game.updateDraft('H17', { value: 102 as unknown as string });
      expect(game.validate('H17')).toEqual({ ok: false, error: VALIDATION_MESSAGES.codeRequired });
      expect(game.archivedCount()).toBe(0);
      expect(stored()!.events).toEqual([]);
    });
  });

  describe('R10 Day 2 逐筆審查（核對後放行／保留待查）', () => {
    it('核對量 2；只開摘要不能回覆，兩筆都有處置才可回覆；處置保存所看版本（保存的 archiveCode）與原始來源、追蹤引用', () => {
      playToDay2With(game, { B102: '102' });
      expect(taskRows(game)).toEqual([row(TASK_DAY2, 'active', 2, 0), row(TASK_DAY2_ARCHIVE, 'pending', 4, 0)]);
      game.openReport();
      expect(game.recordReview('B102')).toBeUndefined();
      expect(game.canReply('ack')).toBeFalse();

      game.setRecordReview('B102', 'release');
      expect(game.recordReview('B102')).toEqual({
        disposition: 'release',
        batchId: BATCH_DAY01,
        archiveTaskId: TASK_DAY1,
        recordKey: 'B102',
        sourceCode: '0102',
        reviewedCode: '102',
      });
      expect(game.canReply('ack')).toBeFalse(); // B607 尚未處置
      expect(game.canReply('ask')).toBeFalse();
      const ev = game.save()!.events[game.save()!.events.length - 1];
      expect(ev.kind).toBe('record.review');
      expect(ev.payload).toEqual({ taskId: TASK_DAY2, key: 'B102', disposition: 'release' });
      expect(storedIsValid()).toBeTrue();

      // 同一處置不重寫；不在這件核對範圍的紀錄（H17）不能處置
      const afterB102 = game.save();
      game.setRecordReview('B102', 'release');
      game.setRecordReview('H17', 'release');
      game.setRecordReview('NOPE', 'hold');
      expect(game.save()).toBe(afterB102);

      game.setRecordReview('B607', 'hold');
      expect(game.recordReview('B607')).toEqual(
        jasmine.objectContaining({ disposition: 'hold', recordKey: 'B607', sourceCode: '0607', reviewedCode: '0607' }),
      );
      expect(game.canReply('ack')).toBeTrue();
      expect(game.canReply('ask')).toBeTrue();
      expect(game.canReply('review')).toBeFalse(); // 仍需先開副本

      // 回覆前可改處置；刷新後保留
      game.setRecordReview('B102', 'hold');
      expect(game.recordReview('B102')!.disposition).toBe('hold');
      game.setRecordReview('B102', 'release');
      let g = freshService();
      expect(g.recordReview('B102')!.disposition).toBe('release');
      expect(g.recordReview('B607')!.disposition).toBe('hold');
      expect(g.reconcile()!.reviews).toEqual(game.reconcile()!.reviews as never);
      expect(countKind(g, 'record.review')).toBe(4);

      // 回覆保存當次核對的摘要版本；處置隨之鎖定
      expect(g.submitReply('ack')).toBeTrue();
      const p = g.save()!.taskProgress[TASK_DAY2];
      expect(p).toEqual({
        kind: 'reconcile',
        reportOpened: true,
        receiptOpened: false,
        reviews: jasmine.any(Object) as never,
        reply: 'ack',
        reportRevision: g.night()!.reportRevision,
      });
      expect([1, 2]).toContain((p as { reportRevision: number }).reportRevision);
      expect(g.recordReview('B102')).toBeUndefined(); // 目前工作已換成 Day 2 新件
      const afterReply = g.save();
      g.setRecordReview('B102', 'hold');
      expect(g.save()).toBe(afterReply);
      expect(storedIsValid()).toBeTrue();
      g = freshService();
      expect(g.save()!.taskProgress[TASK_DAY2]).toEqual(p as never);
    });

    it('請求覆核（review）也需要逐筆處置；確認收件（ack）與放行是不同事件', () => {
      playToDay2With(game, {});
      game.openReport();
      game.openReceipt();
      expect(game.canReply('review')).toBeFalse();
      reviewAll(game, 'hold');
      expect(game.canReply('review')).toBeTrue();
      expect(game.submitReply('review')).toBeTrue();
      const kinds = kindsOf(game.dayEvents());
      expect(kinds).toEqual(['record.review', 'record.review', 'reply.submit', 'task.complete']);
    });
  });

  describe('R11 文件問題（day1-code-audit：Day 1 提交 → Day 2 放行 → Day 3 退件回條 → 次一工作日錯誤文件處理）', () => {
    const TASK_DAY6_ISSUE = 'task.day6.return-review';
    const receiptId = (n: number) => `${RETURN_B102}#${n}`;
    /** 回條郵件的固定 ID（R12）：'mail.'＋回條 ID。 */
    const mailId = (n: number) => `mail.${receiptId(n)}`;
    /** 未開啟的郵件 ID（依收到順序）；同時確認 unreadMailCount 一致。 */
    function unreadMail(g: GameStateService): string[] {
      const ids = g.mailbox().filter((m) => !g.isMailRead(m.id)).map((m) => m.id);
      expect(g.unreadMailCount()).toBe(ids.length);
      return ids;
    }
    /** 回條郵件（R12）：退件回條包、模板＝回條種類、收到日＝回條日，附件引用案件／回條／送件版本。 */
    function receiptMailOf(receipt: ReturnReceipt, caseId = RETURN_B102): MailRecord {
      return {
        id: `mail.${receipt.id}`,
        packId: 'mail.return-receipts',
        templateId: receipt.kind,
        dayId: receipt.dayId,
        attachments: [{ kind: 'return-receipt', caseId, receiptId: receipt.id, versionIndex: receipt.versionIndex }],
      };
    }
    /** 案件不變的部分：第一次提交與第二輪放行的快照。 */
    const BASE = {
      id: RETURN_B102,
      auditId: AUDIT_ID,
      batchId: BATCH_DAY01,
      recordKey: 'B102',
      archiveTaskId: TASK_DAY1,
      reviewTaskId: TASK_DAY2,
      sourceCode: '0102',
      submittedCode: '102',
      reviewedCode: '102',
      disposition: 'release' as const,
      reason: 'code-mismatch' as const,
      notifyDayId: DAY_03,
    };
    const RECEIPT0: ReturnReceipt = { id: receiptId(0), kind: 'returned', dayId: DAY_03, versionIndex: null, code: '102', reason: 'code-mismatch' };
    /** 進 Day 3 時建立的案件：待修正、下一工作日（Day 4）排入待辦、一張退件回條。 */
    const CASE_DAY3: ReturnCase = { ...BASE, status: 'pending', dueDayId: DAY_04, versions: [], receipts: [RECEIPT0] };

    /** B102 以 "102" 提交、Day 2 兩筆放行 → Day 3 morning。 */
    function playToDay3WithReturn(g: GameStateService): void {
      playToDay2With(g, { B102: '102' });
      finishDay2(g);
      g.advanceDay();
      expect([g.dayId(), g.stage()]).toEqual([DAY_03, 'morning']);
    }

    /** 接著完成 Day 3 → Day 4 work（原歸檔工作）。 */
    function playToDay4WithReturn(g: GameStateService): void {
      playToDay3WithReturn(g);
      finishToday(g);
      nextDay(g);
      expect([g.dayId(), g.taskId()]).toEqual([DAY_04, TASK_DAY4]);
    }

    /** Day 4 原歸檔工作交付 → 換到錯誤文件處理。 */
    function toIssueTask(g: GameStateService): void {
      archiveCurrent(g, 'default_false');
      expect(g.completeWork()).toBeTrue();
      expect(g.taskId()).toBe(TASK_DAY4_RETURN);
    }

    function issue(g: GameStateService): ReturnCase {
      const found = g.returns().find((r) => r.id === RETURN_B102);
      if (!found) throw new Error('no B102 case');
      return found;
    }

    /** 目前重新載入不會改動存檔：不寫回、內容相同。 */
    function expectReloadStable(g: GameStateService): GameStateService {
      const raw = localStorage.getItem(SAVE_KEY)!;
      const setItem = jasmine.isSpy(Storage.prototype.setItem)
        ? (Storage.prototype.setItem as jasmine.Spy)
        : spyOn(Storage.prototype, 'setItem').and.callThrough();
      setItem.calls.reset();
      const fresh = freshService();
      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      expect(fresh.save()).toEqual(JSON.parse(JSON.stringify(g.save()!)));
      return fresh;
    }

    it('B102 "102"＋放行 → 進 Day 3 建立一個待修正案件（dueDayId day.04）與一張未讀退件回條；Day 3 沒有錯誤文件處理工作；重複跨日與刷新不重複', () => {
      playToDay2With(game, { B102: '102' });
      finishDay2(game);
      // 放行當下與 Day 2 wrap 都不預告
      expect(game.returns()).toEqual([]);
      expect(game.pendingIssueCount()).toBe(0);
      expect(unreadMail(game)).toEqual([]);
      expect(game.mailbox()).toEqual([]);
      expect(game.conditionContext()!.returnNotified(AUDIT_ID)).toBeFalse();
      expect(unlockedIds(game, LIN_DM)).not.toContain(RETURN_MSG);

      game.advanceDay();
      expect(game.dayId()).toBe(DAY_03);
      expect(game.returns()).toEqual([CASE_DAY3]);
      expect(stored()!.returns).toEqual([CASE_DAY3]);
      // 到期日是下一工作日：Day 3 本身不排程
      expect(game.save()!.issueSchedule).toEqual({});
      expect(game.save()!.readMail).toEqual([]);
      // R12：回條建立的同時寄出一封回條郵件（未讀）
      expect(game.mailbox()).toEqual([receiptMailOf(RECEIPT0)]);
      expect(stored()!.mailbox).toEqual([receiptMailOf(RECEIPT0)]);
      expect(game.pendingIssueCount()).toBe(1);
      expect(unreadMail(game)).toEqual([mailId(0)]);
      expect(countKind(game, 'return.notified')).toBe(1);
      expect(game.save()!.events.find((e) => e.kind === 'return.notified')!.payload).toEqual({ dayId: DAY_03, auditId: AUDIT_ID, count: 1 });
      expect(kindsOf(game.dayEvents())).toEqual(['return.notified']);
      expect(game.conditionContext()!.returnNotified(AUDIT_ID)).toBeTrue();
      expect(game.conditionContext()!.returnNotified('no-such-audit')).toBeFalse();
      expect(unlockedMessages(LIN_DM, game.conditionContext()!).filter((m) => m.id === RETURN_MSG).length).toBe(1);
      // Day 3 的虛擬錯誤文件處理位置不適用：不出現在清單、不佔序號
      expect(taskRows(game)).toEqual([row(TASK_DAY3, 'pending', 5, 0)]);
      expect(game.activeReturns()).toEqual([]);
      expect(stored()!.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('102');
      expect(storedIsValid()).toBeTrue();

      // morning 再跨日是 no-op；刷新不寫回、不重建、不重排
      const morning = game.save();
      game.advanceDay();
      expect(game.save()).toBe(morning);
      let g = expectReloadStable(game);
      expect(g.returns()).toEqual([CASE_DAY3]);
      expect(unreadMail(g)).toEqual([mailId(0)]);
      g.startDay();
      finishToday(g);
      expect(g.returns()).toEqual([CASE_DAY3]);
      g = freshService();
      g.advanceDay();

      // Day 4：進入時排定當天的錯誤文件處理（只引用既有案件，不新增回條）
      expect(g.dayId()).toBe(DAY_04);
      expect(g.save()!.issueSchedule).toEqual({ [DAY_04]: [RETURN_B102] });
      expect(g.returns()).toEqual([CASE_DAY3]);
      expect(g.mailbox()).toEqual([receiptMailOf(RECEIPT0)]); // 跨日、刷新都不重寄
      expect(countKind(g, 'return.notified')).toBe(1);
      expect(g.stage()).toBe('morning');
      expect(g.taskId()).toBe(TASK_DAY4);
      expect(taskRows(g)).toEqual([row(TASK_DAY4, 'pending', 6, 0), row(TASK_DAY4_RETURN, 'pending', 1, 0)]);
      const item = g.dayTasks()[1];
      expect(item.kind).toBe('return-review');
      expect(item.index).toBe(2);
      expect(item.heading).toBe(DOCUMENT_ISSUES_UI.taskHeading);
      expect(item.heading).toBe('錯誤文件處理');
      expect(storedIsValid()).toBeTrue();
      const again = expectReloadStable(g);
      expect(again.dayTasks()).toEqual(g.dayTasks());
      expect(again.save()!.issueSchedule).toEqual({ [DAY_04]: [RETURN_B102] });
    });

    it('Day 4：錯誤文件處理列出案件；重送 "103"（仍錯）→ 已重送／待核對（checkDayId day.05），不結案、不新增回條；本日處理已交付後 completeWork', () => {
      playToDay4WithReturn(game);
      expect(game.isLastTask()).toBeFalse();
      toIssueTask(game);
      expect(game.task()).toEqual({ id: TASK_DAY4_RETURN, kind: 'return-review', dayId: DAY_04 });
      expect(game.taskContent()!.kind).toBe('return-review');
      expect(game.batchId()).toBeNull();
      expect(game.records()).toEqual([]);
      expect(game.isLastTask()).toBeTrue();
      expect(game.taskDone()).toBeFalse();
      expect(taskRows(game)).toEqual([row(TASK_DAY4, 'done', 6, 6), row(TASK_DAY4_RETURN, 'active', 1, 0)]);
      expect(game.activeReturns()).toEqual([CASE_DAY3]);
      expect(game.latestIssueCode(issue(game))).toBe('102'); // 修訂表單預填上一次實際提交的值
      expect(game.completeWork()).toBeFalse(); // 還有待修正的案件

      // 只驗型別：空白、未知案件拒絕；仍不一致（103）也可送出
      const before = game.save();
      expect(game.editableReceiptId(RETURN_B102)).toBe(receiptId(0));
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '  ')).toBe('noop');
      expect(game.resubmitReturnStrict('return.nope', receiptId(0), '0102')).toBe('noop');
      // 版本鎖定（R12）：不是目前可修訂的回條（不存在的回條、別案的回條）一律拒絕
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(1), '0102')).toBe('noop');
      expect(game.resubmitReturnStrict(RETURN_B102, `${RETURN_B607}#0`, '0102')).toBe('noop');
      expect(game.sendReturnToWindowStrict(RETURN_B102, receiptId(1))).toBe('noop');
      expect(game.save()).toBe(before);
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '103')).toBe('ok');
      const resubmitted: ReturnCase = {
        ...BASE,
        status: 'awaiting-check',
        dueDayId: null,
        versions: [{ index: 0, action: 'resubmit', code: '103', dayId: DAY_04, checkDayId: DAY_05 }],
        receipts: [RECEIPT0],
      };
      expect(issue(game)).toEqual(resubmitted);
      expect(game.latestIssueCode(issue(game))).toBe('103');
      expect(stored()!.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('102'); // 原提交不被覆寫
      const ev = game.save()!.events[game.save()!.events.length - 1];
      expect(ev).toEqual(jasmine.objectContaining({ kind: 'return.resubmit', payload: { dayId: DAY_04, returnId: RETURN_B102, versionIndex: 0 } }));
      // 待處理件數歸零，但未讀回條不因此變成已讀（兩者分開）
      expect(game.pendingIssueCount()).toBe(0);
      expect(unreadMail(game)).toEqual([mailId(0)]);
      expect(game.mailbox().length).toBe(1); // 重送不寄信（回條才寄）
      expect(game.editableReceiptId(RETURN_B102)).toBeNull(); // 待核對：回條只能檢閱
      // 同一版本不能再送一次，也不能改送窗口
      const settled = game.save();
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('noop');
      expect(game.sendReturnToWindowStrict(RETURN_B102, receiptId(0))).toBe('noop');
      expect(game.save()).toBe(settled);
      expect(countKind(game, 'return.resubmit')).toBe(1);
      expect(taskRows(game)).toEqual([row(TASK_DAY4, 'done', 6, 6), row(TASK_DAY4_RETURN, 'active', 1, 1)]);
      expect(game.taskDone()).toBeTrue();
      expect(expectReloadStable(game).returns()).toEqual([resubmitted]);
      expect(storedIsValid()).toBeTrue();

      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('wrap');
      expect(taskRows(game)).toEqual([row(TASK_DAY4, 'done', 6, 6), row(TASK_DAY4_RETURN, 'done', 1, 1)]);
      expect(kindsOf(game.dayEvents()).slice(-4)).toEqual(['task.complete', 'return.resubmit', 'task.complete', 'day.complete']);
      const delivered = game.save()!.events.filter((e) => e.kind === 'task.complete').map((e) => (e.payload as { taskId: string }).taskId);
      expect(delivered.slice(-2)).toEqual([TASK_DAY4, TASK_DAY4_RETURN]);
      // 「本日處理已交付」≠「案件已解決」：交接後仍待核對
      expect(issue(game).status).toBe('awaiting-check');
      expect(game.returns().some((r) => r.status === 'resolved')).toBeFalse();
      expect(storedIsValid()).toBeTrue();
      // 通知已處理之後仍留在訊息歷史
      game.markMessagesRead([RETURN_MSG]);
      expect(unlockedIds(game, LIN_DM)).toContain(RETURN_MSG);
    });

    it('Day 5 進入時核對 "103" 仍不一致 → 再次退回（第 2 張退件回條、pending、dueDayId day.06），不排入 Day 5；Day 5 從文件問題頁重送仍錯 → Day 6 第 3 張退件回條', () => {
      playToDay4WithReturn(game);
      toIssueTask(game);
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '103')).toBe('ok');
      expect(game.completeWork()).toBeTrue();
      game.advanceDay();

      // ---- Day 5 morning：下游核對一次 ----
      expect([game.dayId(), game.stage(), game.taskId()]).toEqual([DAY_05, 'morning', TASK_DAY5]);
      const receipt1: ReturnReceipt = { id: receiptId(1), kind: 'returned', dayId: DAY_05, versionIndex: 0, code: '103', reason: 'code-mismatch' };
      const day5Case: ReturnCase = {
        ...BASE,
        status: 'pending',
        dueDayId: DAY_06,
        versions: [{ index: 0, action: 'resubmit', code: '103', dayId: DAY_04, checkDayId: DAY_05, outcome: 'returned', checkedDayId: DAY_05 }],
        receipts: [RECEIPT0, receipt1],
      };
      expect(game.returns()).toEqual([day5Case]);
      expect(countKind(game, 'return.checked')).toBe(1);
      expect(game.save()!.events.find((e) => e.kind === 'return.checked')!.payload).toEqual({
        dayId: DAY_05,
        returnId: RETURN_B102,
        versionIndex: 0,
        outcome: 'returned',
      });
      expect(kindsOf(game.dayEvents())).toEqual(['return.checked']);
      // 排程規則：回條當天（Day 5）收到 → 下一工作日（Day 6）才進待辦；Day 5 沒有錯誤文件處理工作
      expect(game.save()!.issueSchedule).toEqual({ [DAY_04]: [RETURN_B102] });
      expect(taskRows(game)).toEqual([row(TASK_DAY5, 'pending', 8, 0)]);
      expect(game.pendingIssueCount()).toBe(1);
      expect(unreadMail(game)).toEqual([mailId(0), mailId(1)]);
      expect(game.mailbox()).toEqual([receiptMailOf(RECEIPT0), receiptMailOf(receipt1)]);
      expect(game.latestIssueCode(issue(game))).toBe('103');
      expect(storedIsValid()).toBeTrue();
      // 刷新不再核對、不重複回條
      expect(expectReloadStable(game).returns()).toEqual([day5Case]);

      // ---- Day 5 work：目前工作是歸檔，從文件問題頁重送（仍錯 0103）----
      game.startDay();
      expect(game.task()!.kind).toBe('archive');
      const onArchive = game.dayTasks();
      // 再次退回後可修訂的是新回條；舊回條（第一張）只能檢閱
      expect(game.editableReceiptId(RETURN_B102)).toBe(receiptId(1));
      const reReturned = game.save();
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '0103')).toBe('noop');
      expect(game.sendReturnToWindowStrict(RETURN_B102, receiptId(0))).toBe('noop');
      expect(game.save()).toBe(reReturned);
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(1), '0103')).toBe('ok');
      expect(game.taskId()).toBe(TASK_DAY5);
      expect(game.dayTasks()).toEqual(onArchive);
      expect(issue(game).status).toBe('awaiting-check');
      expect(issue(game).versions[1]).toEqual({ index: 1, action: 'resubmit', code: '0103', dayId: DAY_05, checkDayId: DAY_06 });
      expect(issue(game).receipts.length).toBe(2);
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(1), '0102')).toBe('noop'); // 同一案待核對中不能再送
      finishToday(game);
      expect(game.stage()).toBe('wrap');
      game.advanceDay();

      // ---- Day 6 morning：第三次仍錯 → 第 3 張退件回條；最後一天之後不再排入待辦 ----
      expect(game.dayId()).toBe(DAY_06);
      const receipt2: ReturnReceipt = { id: receiptId(2), kind: 'returned', dayId: DAY_06, versionIndex: 1, code: '0103', reason: 'code-mismatch' };
      expect(issue(game)).toEqual({
        ...BASE,
        status: 'pending',
        dueDayId: null,
        versions: [
          { index: 0, action: 'resubmit', code: '103', dayId: DAY_04, checkDayId: DAY_05, outcome: 'returned', checkedDayId: DAY_05 },
          { index: 1, action: 'resubmit', code: '0103', dayId: DAY_05, checkDayId: DAY_06, outcome: 'returned', checkedDayId: DAY_06 },
        ],
        receipts: [RECEIPT0, receipt1, receipt2],
      });
      expect(game.returns().length).toBe(1); // 同一案重錯只增加歷程，不複製成新案件
      expect(countKind(game, 'return.checked')).toBe(2);
      expect(game.save()!.issueSchedule).toEqual({ [DAY_04]: [RETURN_B102] });
      expect(taskRows(game)).toEqual([row(TASK_DAY6, 'pending', 8, 0)]);
      expect(game.pendingIssueCount()).toBe(1);
      expect(unreadMail(game)).toEqual([mailId(0), mailId(1), mailId(2)]);
      expect(game.mailbox()).toEqual([receiptMailOf(RECEIPT0), receiptMailOf(receipt1), receiptMailOf(receipt2)]);
      // 排定日（Day 4）之後才再次退回：那天的錯誤文件處理仍算已交付，存檔合法、可重新載入
      expect(storedIsValid()).toBeTrue();
      let g = expectReloadStable(game);
      expect(g.hasSave()).toBeTrue();
      expect(g.storageIssue()).toBe('');
      expect(g.returns()).toEqual(game.returns());
      finishToday(g);
      expect(g.stage()).toBe('end');
      expect(issue(g).status).toBe('pending'); // 仍留在文件問題清單
      expect(issue(g).receipts.length).toBe(3);
      expect(storedIsValid()).toBeTrue();
      g = expectReloadStable(g);
      expect(g.stage()).toBe('end');
      expect(g.progressText()).toBe('六日試玩完成');
    });

    it('正確修訂 "0102"：送出當下只是已重送／待核對；交接、刷新都不結案；下一工作日下游核對一致才結案（收件回條）', () => {
      playToDay4WithReturn(game);
      toIssueTask(game);
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('ok');
      expect(issue(game).status).toBe('awaiting-check');
      expect(issue(game).receipts).toEqual([RECEIPT0]);
      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('wrap');
      expect(issue(game).status).toBe('awaiting-check');
      let g = expectReloadStable(game);
      expect(g.returns()[0].status).toBe('awaiting-check');
      expect(countKind(g, 'return.checked')).toBe(0);

      g.advanceDay();
      expect(g.dayId()).toBe(DAY_05);
      const resolvedReceipt: ReturnReceipt = { id: receiptId(1), kind: 'resolved', dayId: DAY_05, versionIndex: 0, code: '0102', reason: null };
      const resolved: ReturnCase = {
        ...BASE,
        status: 'resolved',
        dueDayId: null,
        versions: [{ index: 0, action: 'resubmit', code: '0102', dayId: DAY_04, checkDayId: DAY_05, outcome: 'resolved', checkedDayId: DAY_05 }],
        receipts: [RECEIPT0, resolvedReceipt],
      };
      expect(g.returns()).toEqual([resolved]);
      expect(g.save()!.events.filter((e) => e.kind === 'return.checked').map((e) => e.payload)).toEqual([
        { dayId: DAY_05, returnId: RETURN_B102, versionIndex: 0, outcome: 'resolved' },
      ]);
      expect(g.pendingIssueCount()).toBe(0);
      expect(unreadMail(g)).toEqual([mailId(0), mailId(1)]);
      expect(g.mailbox()).toEqual([receiptMailOf(RECEIPT0), receiptMailOf(resolvedReceipt)]);
      expect(g.editableReceiptId(RETURN_B102)).toBeNull();
      expect(taskRows(g)).toEqual([row(TASK_DAY5, 'pending', 8, 0)]);
      // 已結案不能再送或送窗口；原提交仍是 102（歷史不被改寫）
      g.startDay();
      const s = g.save();
      expect(g.resubmitReturnStrict(RETURN_B102, receiptId(1), '0102')).toBe('noop');
      expect(g.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('noop');
      expect(g.sendReturnToWindowStrict(RETURN_B102, receiptId(0))).toBe('noop');
      expect(g.sendReturnToWindowStrict(RETURN_B102, receiptId(1))).toBe('noop');
      expect(g.save()).toBe(s);
      expect(g.save()!.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('102');
      g = freshService();
      expect(g.returns()).toEqual([resolved]);
      playArchiveDaysUntil(g, DAY_06);
      finishToday(g);
      expect(g.stage()).toBe('end');
      expect(g.returns()).toEqual([resolved]);
      expect(countKind(g, 'return.checked')).toBe(1);
      expect(storedIsValid()).toBeTrue();
    });

    it('Day 4 在原歸檔工作時就從文件問題頁送窗口 → 待窗口回覆（未解決）；當日錯誤文件處理同步變成已交付，isLastTask 更新；之後到結束都不自動結案', () => {
      playToDay4WithReturn(game);
      expect(game.isLastTask()).toBeFalse();
      expect(taskRows(game)).toEqual([row(TASK_DAY4, 'active', 6, 0), row(TASK_DAY4_RETURN, 'pending', 1, 0)]);
      expect(game.sendReturnToWindowStrict(RETURN_B102, receiptId(0))).toBe('ok');
      expect(game.taskId()).toBe(TASK_DAY4); // 不受目前工作限制，也不改變目前工作
      const windowed: ReturnCase = {
        ...BASE,
        status: 'awaiting-window',
        dueDayId: null,
        versions: [{ index: 0, action: 'window', code: '102', dayId: DAY_04, checkDayId: null }],
        receipts: [RECEIPT0],
      };
      expect(game.returns()).toEqual([windowed]);
      expect(game.editableReceiptId(RETURN_B102)).toBeNull(); // 待窗口回覆：只能檢閱
      expect(game.save()!.events[game.save()!.events.length - 1]).toEqual(
        jasmine.objectContaining({ kind: 'return.window', payload: { dayId: DAY_04, returnId: RETURN_B102, versionIndex: 0 } }),
      );
      expect(game.pendingIssueCount()).toBe(0);
      // 當日工作同步：錯誤文件處理已交付，原歸檔工作成為最後一件
      expect(game.isLastTask()).toBeTrue();
      expect(taskRows(game)).toEqual([row(TASK_DAY4, 'active', 6, 0), row(TASK_DAY4_RETURN, 'pending', 1, 1)]);
      expect(game.sendReturnToWindowStrict(RETURN_B102, receiptId(0))).toBe('noop');
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('noop');
      archiveCurrent(game, 'default_false');
      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('wrap');
      expect(taskRows(game)).toEqual([row(TASK_DAY4, 'done', 6, 6), row(TASK_DAY4_RETURN, 'done', 1, 1)]);
      const delivered = game.save()!.events.filter((e) => e.kind === 'task.complete').map((e) => (e.payload as { taskId: string }).taskId);
      expect(delivered).not.toContain(TASK_DAY4_RETURN); // 沒有空跑一次錯誤文件處理
      expect(storedIsValid()).toBeTrue();

      nextDay(game);
      expect(game.returns()).toEqual([windowed]);
      playArchiveDaysUntil(game, DAY_06);
      expect(game.returns()).toEqual([windowed]);
      finishToday(game);
      expect(game.stage()).toBe('end');
      expect(game.returns()).toEqual([windowed]);
      expect(countKind(game, 'return.checked')).toBe(0);
      expect(storedIsValid()).toBeTrue();
    });

    it('Day 5 再次退回後留到 Day 6：虛擬 task.day6.return-review 排在欄位映射之後；最後一天重送（即使正確）checkDayId null，結束仍是已重送／待核對', () => {
      playToDay4WithReturn(game);
      toIssueTask(game);
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '103')).toBe('ok');
      expect(game.completeWork()).toBeTrue();
      nextDay(game);
      expect(issue(game)).toEqual(jasmine.objectContaining({ status: 'pending', dueDayId: DAY_06 }));
      // Day 5 不處理也能交接（案件今天沒有到期）
      finishToday(game);
      expect(game.stage()).toBe('wrap');
      expect(issue(game).status).toBe('pending');
      game.advanceDay();

      expect([game.dayId(), game.stage(), game.taskId()]).toEqual([DAY_06, 'morning', TASK_DAY6]);
      expect(game.save()!.issueSchedule).toEqual({ [DAY_04]: [RETURN_B102], [DAY_06]: [RETURN_B102] });
      expect(issue(game).receipts.length).toBe(2); // 排程只引用既有案件，不新增回條
      expect(taskRows(game)).toEqual([row(TASK_DAY6, 'pending', 8, 0), row(TASK_DAY6_ISSUE, 'pending', 1, 0)]);
      expect(game.dayTasks()[1].heading).toBe(DOCUMENT_ISSUES_UI.taskHeading);
      game.startDay();
      expect(game.isLastTask()).toBeFalse();
      mapCorrectly(game);
      game.setFieldBlankPolicy('default_false');
      game.previewFieldMap();
      expect(game.submitFieldMap()).toBeTrue();
      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('work');
      expect(game.taskId()).toBe(TASK_DAY6_ISSUE);
      expect(game.task()).toEqual({ id: TASK_DAY6_ISSUE, kind: 'return-review', dayId: DAY_06 });
      expect(game.taskContent()).toBeNull(); // 虛擬位置不在內容檔
      expect(game.isLastTask()).toBeTrue();
      expect(game.activeReturns().map((r) => r.id)).toEqual([RETURN_B102]);
      expect(game.completeWork()).toBeFalse();
      expect(storedIsValid()).toBeTrue();

      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('noop');
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(1), '0102')).toBe('ok');
      expect(issue(game).versions[1]).toEqual({ index: 1, action: 'resubmit', code: '0102', dayId: DAY_06, checkDayId: null });
      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('end');
      expect(taskRows(game)).toEqual([row(TASK_DAY6, 'done', 8, 8), row(TASK_DAY6_ISSUE, 'done', 1, 1)]);
      // 不為結束畫面自動結案
      expect(issue(game).status).toBe('awaiting-check');
      expect(issue(game).receipts.length).toBe(2);
      const end = game.save();
      game.advanceDay();
      expect(game.save()).toBe(end);
      const g = expectReloadStable(game);
      expect(g.returns()[0].status).toBe('awaiting-check');
      expect(storedIsValid()).toBeTrue();
    });

    it('pendingIssueCount 與未讀郵件分開：markMailRead 寫入存檔、重新載入後仍為已讀；只有新回條的郵件才重新顯示未讀', () => {
      playToDay3WithReturn(game);
      expect(game.pendingIssueCount()).toBe(1);
      expect(unreadMail(game)).toEqual([mailId(0)]);
      expect(game.isMailRead(mailId(0))).toBeFalse();
      game.markMailRead([mailId(0)]);
      expect(unreadMail(game)).toEqual([]);
      expect(game.isMailRead(mailId(0))).toBeTrue();
      expect(game.pendingIssueCount()).toBe(1); // 已讀不等於已處理
      expect(stored()!.readMail).toEqual([mailId(0)]);
      // 重複標記不再寫檔
      const marked = game.save();
      const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
      game.markMailRead([mailId(0), mailId(0)]);
      game.markMailRead([]);
      expect(game.save()).toBe(marked);
      expect(setItem).not.toHaveBeenCalled();
      expect(storedIsValid()).toBeTrue();

      let g = freshService();
      expect(unreadMail(g)).toEqual([]);
      expect(g.pendingIssueCount()).toBe(1);
      g.startDay();
      finishToday(g);
      nextDay(g);
      expect(unreadMail(g)).toEqual([]); // 跨日排程不重生紅點
      archiveCurrent(g, 'default_false');
      expect(g.completeWork()).toBeTrue();
      expect(g.resubmitReturnStrict(RETURN_B102, receiptId(0), '103')).toBe('ok');
      expect(g.pendingIssueCount()).toBe(0);
      expect(unreadMail(g)).toEqual([]); // 處理案件不會動到郵件已讀
      expect(g.completeWork()).toBeTrue();
      g.advanceDay();
      expect(g.pendingIssueCount()).toBe(1);
      expect(unreadMail(g)).toEqual([mailId(1)]);
      g.markMailRead(unreadMail(g));
      g = freshService();
      expect(unreadMail(g)).toEqual([]);
      expect(g.save()!.readMail).toEqual([mailId(0), mailId(1)]);
      expect(g.pendingIssueCount()).toBe(1);
    });

    it('markMailRead 只記錄既有郵件：未知 ID（含回條 ID 本身）不寫入（避免存檔被驗證拒絕、下次讀取失敗）', () => {
      playToDay3WithReturn(game);
      const before = game.save();
      game.markMailRead(['mail.return.nope#0', receiptId(0)]);
      expect(game.save()!.readMail).toEqual([]);
      expect(game.save()).toBe(before);
      expect(game.isMailRead('mail.return.nope#0')).toBeFalse();
      game.markMailRead(['mail.return.nope#0', mailId(0)]);
      expect(game.save()!.readMail).toEqual([mailId(0)]);
      expect(storedIsValid()).toBeTrue();
      const g = freshService();
      expect(g.hasSave()).toBeTrue();
      expect(g.storageIssue()).toBe('');
      expect(unreadMail(g)).toEqual([]);
    });

    it('兩筆都填錯並放行 → 各自一個案件、一次通知（count 2）；Day 4 錯誤文件處理 2 筆，逐筆處理後才可交付', () => {
      playToDay2With(game, { B102: '102', B607: '607' });
      finishDay2(game);
      game.advanceDay();
      expect(game.returns().map((r) => r.id)).toEqual([RETURN_B102, RETURN_B607]);
      expect(game.returns()[1]).toEqual(
        jasmine.objectContaining({ recordKey: 'B607', sourceCode: '0607', submittedCode: '607', status: 'pending', dueDayId: DAY_04 }),
      );
      expect(game.returns()[1].receipts).toEqual([
        { id: `${RETURN_B607}#0`, kind: 'returned', dayId: DAY_03, versionIndex: null, code: '607', reason: 'code-mismatch' },
      ]);
      expect(countKind(game, 'return.notified')).toBe(1);
      expect(game.save()!.events.find((e) => e.kind === 'return.notified')!.payload).toEqual({ dayId: DAY_03, auditId: AUDIT_ID, count: 2 });
      expect(game.pendingIssueCount()).toBe(2);
      expect(unreadMail(game)).toEqual([mailId(0), `mail.${RETURN_B607}#0`]);
      expect(game.mailbox().map((m) => m.attachments[0].caseId)).toEqual([RETURN_B102, RETURN_B607]);
      finishToday(game);
      nextDay(game);
      expect(game.save()!.issueSchedule).toEqual({ [DAY_04]: [RETURN_B102, RETURN_B607] });
      expect(taskRows(game)).toEqual([row(TASK_DAY4, 'active', 6, 0), row(TASK_DAY4_RETURN, 'pending', 2, 0)]);
      archiveCurrent(game, 'default_false');
      expect(game.completeWork()).toBeTrue();
      expect(game.resubmitReturnStrict(RETURN_B607, `${RETURN_B607}#0`, '0607')).toBe('ok');
      expect(taskRows(game)[1]).toEqual(row(TASK_DAY4_RETURN, 'active', 2, 1));
      expect(game.completeWork()).toBeFalse();
      expect(game.sendReturnToWindowStrict(RETURN_B102, receiptId(0))).toBe('ok');
      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('wrap');
      expect(game.returns().map((r) => r.status)).toEqual(['awaiting-window', 'awaiting-check']);
      game.advanceDay();
      expect(game.returns().map((r) => r.status)).toEqual(['awaiting-window', 'resolved']);
      expect(countKind(game, 'return.checked')).toBe(1);
      expect(storedIsValid()).toBeTrue();
    });

    /* ---------- R12：版本鎖定與修訂草稿 ---------- */

    it('R12 editableReceiptId：只有待修正案件的最新退件回條可修訂；待核對、再次退回後的舊回條、待窗口、已結案都是 null；未知案件 null', () => {
      expect(game.editableReceiptId(RETURN_B102)).toBeNull(); // 無存檔
      playToDay3WithReturn(game);
      expect(game.editableReceiptId(RETURN_B102)).toBe(receiptId(0)); // 通知日（morning）就可檢視、可修訂的回條已決定
      expect(game.editableReceiptId('return.nope')).toBeNull();
      game.startDay();
      finishToday(game);
      nextDay(game);
      toIssueTask(game);
      expect(game.editableReceiptId(RETURN_B102)).toBe(receiptId(0));
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '103')).toBe('ok');
      expect(game.editableReceiptId(RETURN_B102)).toBeNull();
      expect(game.completeWork()).toBeTrue();
      nextDay(game);
      expect(issue(game).receipts.map((r) => r.id)).toEqual([receiptId(0), receiptId(1)]);
      expect(game.editableReceiptId(RETURN_B102)).toBe(receiptId(1));
      expect(game.sendReturnToWindowStrict(RETURN_B102, receiptId(1))).toBe('ok');
      expect(game.editableReceiptId(RETURN_B102)).toBeNull();
    });

    it('R12 setIssueDraft：只寫入目前可修訂的回條（工作階段）；相同值、舊回條、不存在的回條、非工作階段都不寫檔；重新載入保留', () => {
      playToDay3WithReturn(game);
      // morning：不是工作階段 → 不寫入
      const morning = game.save();
      game.setIssueDraft(receiptId(0), '0102');
      expect(game.save()).toBe(morning);
      expect(game.issueDraft(receiptId(0))).toBeUndefined();
      game.startDay();
      game.setIssueDraft(receiptId(0), '01');
      expect(game.issueDraft(receiptId(0))).toBe('01');
      expect(stored()!.issueDrafts).toEqual({ [receiptId(0)]: '01' });
      game.setIssueDraft(receiptId(0), '0102');
      expect(game.issueDraft(receiptId(0))).toBe('0102');
      const drafted = game.save();
      const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
      game.setIssueDraft(receiptId(0), '0102'); // 相同值
      game.setIssueDraft(receiptId(1), 'x'); // 尚不存在的回條
      game.setIssueDraft('return.nope#0', 'x');
      expect(game.save()).toBe(drafted);
      expect(setItem).not.toHaveBeenCalled();
      expect(storedIsValid()).toBeTrue();
      const g = freshService();
      expect(g.issueDraft(receiptId(0))).toBe('0102');
      // 空字串也是合法草稿（玩家清空輸入）
      g.setIssueDraft(receiptId(0), '');
      expect(g.issueDraft(receiptId(0))).toBe('');
    });

    it('R12 修訂送出（重送或送窗口）成功時移除該回條的草稿；過期回條的操作 noop、不寫檔、草稿不動', () => {
      playToDay4WithReturn(game);
      toIssueTask(game);
      game.setIssueDraft(receiptId(0), '0102');
      const drafted = game.save();
      const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(1), '0102')).toBe('noop');
      expect(game.sendReturnToWindowStrict(RETURN_B102, receiptId(1))).toBe('noop');
      expect(game.save()).toBe(drafted);
      expect(setItem).not.toHaveBeenCalled();
      expect(game.issueDraft(receiptId(0))).toBe('0102');
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('ok');
      expect(game.issueDraft(receiptId(0))).toBeUndefined();
      expect(stored()!.issueDrafts).toEqual({});
      expect(storedIsValid()).toBeTrue();

      // 送窗口同樣清掉該回條的草稿
      localStorage.clear();
      const g = freshService();
      playToDay4WithReturn(g);
      g.setIssueDraft(receiptId(0), '一些註記');
      expect(g.sendReturnToWindowStrict(RETURN_B102, receiptId(0))).toBe('ok');
      expect(g.issueDraft(receiptId(0))).toBeUndefined();
      expect(stored()!.issueDrafts).toEqual({});
    });

    it('R12 過期回條的草稿保留、可讀出但不再更新；新回條的草稿各自獨立，送出只移除新回條的草稿', () => {
      playToDay4WithReturn(game);
      toIssueTask(game);
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '103')).toBe('ok');
      // 手動放一份舊回條的草稿（例如舊版本留下的）：合法、可讀
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...game.save()!, issueDrafts: { [receiptId(0)]: 'old' } }));
      let g = freshService();
      expect(g.storageIssue()).toBe('');
      expect(g.issueDraft(receiptId(0))).toBe('old');
      const before = g.save();
      g.setIssueDraft(receiptId(0), 'new');
      expect(g.save()).toBe(before);
      expect(g.issueDraft(receiptId(0))).toBe('old');
      expect(g.completeWork()).toBeTrue();
      nextDay(g); // Day 5：再次退回 → #1 可修訂
      expect(g.editableReceiptId(RETURN_B102)).toBe(receiptId(1));
      g.setIssueDraft(receiptId(0), 'new');
      g.setIssueDraft(receiptId(1), '0102');
      expect(g.save()!.issueDrafts).toEqual({ [receiptId(0)]: 'old', [receiptId(1)]: '0102' });
      expect(g.resubmitReturnStrict(RETURN_B102, receiptId(1), '0102')).toBe('ok');
      expect(g.save()!.issueDrafts).toEqual({ [receiptId(0)]: 'old' });
      expect(storedIsValid()).toBeTrue();
      g = freshService();
      expect(g.issueDraft(receiptId(0))).toBe('old');
      expect(g.issueDraft(receiptId(1))).toBeUndefined();
    });

    it('R12 寫入失敗的修訂重送（failed）不改存檔、草稿保留；重試成功後恰好一個版本', () => {
      playToDay4WithReturn(game);
      toIssueTask(game);
      game.setIssueDraft(receiptId(0), '0102');
      const before = game.save();
      const persist = spyOn(TestBed.inject(SaveRepository), 'persist').and.returnValue(STORAGE.writeIssue);
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('failed');
      expect(game.save()).toBe(before);
      expect(game.storageIssue()).toBe(STORAGE.writeIssue);
      expect(game.issueDraft(receiptId(0))).toBe('0102');
      persist.and.callThrough();
      expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('ok');
      expect(game.storageIssue()).toBe('');
      expect(issue(game).versions.length).toBe(1);
      expect(countKind(game, 'return.resubmit')).toBe(1);
      expect(game.issueDraft(receiptId(0))).toBeUndefined();
    });

    it('R12 v10 舊檔（Day 4、第一張回條已讀）→ 載入即寫回 v11：郵件由回條重建、回條已讀 → 郵件已讀、入職已完成、角色 null；再載入不再寫回', () => {
      playToDay4WithReturn(game);
      toIssueTask(game);
      game.markMailRead([mailId(0)]);
      const native = game.save()!;
      const v10 = toV10(native);
      expect(v10.readIssueReceipts).toEqual([receiptId(0)]);
      localStorage.setItem(SAVE_KEY, JSON.stringify(v10));
      expect(new SaveRepository().load().migratedFrom).toBe(10);
      const g = freshService();
      expect(g.storageIssue()).toBe('');
      const s = stored()!;
      expect(s.version).toBe(11);
      expect(s).toEqual(JSON.parse(JSON.stringify(g.save()!)));
      expect(g.save()).toEqual({ ...native, onboarding: { step: 0, complete: true } });
      expect(s.mailbox).toEqual([receiptMailOf(RECEIPT0)]);
      expect(s.readMail).toEqual([mailId(0)]);
      expect(s.helpRequests).toEqual({});
      expect(s.issueDrafts).toEqual({});
      expect((s as unknown as Record<string, unknown>)['readIssueReceipts']).toBeUndefined();
      expect(g.profileName()).toBeNull();
      expect(g.displayName()).toBe(LEGACY_PLAYER_NAME);
      expect(g.onboarding()).toEqual({ step: 0, complete: true });
      expect(routeForSave(g.save()!)).toBe(routeForStage(g.stage()!));
      expect(unreadMail(g)).toEqual([]);
      expect(g.editableReceiptId(RETURN_B102)).toBe(receiptId(0));
      expect(new SaveRepository().load().migratedFrom).toBe(11);
      expectReloadStable(g);
      // 遷移後照常處理
      expect(g.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('ok');
      expect(storedIsValid()).toBeTrue();
    });

    /** 對照組共用：進 Day 3 沒有案件、沒有私訊；Day 4 只有原歸檔工作，做完即 wrap。 */
    function expectNoReturnThroughDay4(g: GameStateService): void {
      g.advanceDay();
      expect(g.dayId()).toBe(DAY_03);
      expect(g.returns()).toEqual([]);
      expect(g.save()!.events.some((e) => e.kind === 'return.notified')).toBeFalse();
      expect(g.conditionContext()!.returnNotified(AUDIT_ID)).toBeFalse();
      expect(unlockedIds(g, LIN_DM)).not.toContain(RETURN_MSG);
      finishToday(g);
      g.advanceDay();
      expect(g.dayId()).toBe(DAY_04);
      expect(g.returns()).toEqual([]);
      expect(g.save()!.issueSchedule).toEqual({});
      expect(g.pendingIssueCount()).toBe(0);
      expect(unreadMail(g)).toEqual([]);
      expect(g.mailbox()).toEqual([]);
      expect(unlockedIds(g, LIN_DM)).not.toContain(RETURN_MSG);
      expect(taskRows(g)).toEqual([row(TASK_DAY4, 'pending', 6, 0)]);
      g.startDay();
      expect(g.isLastTask()).toBeTrue();
      archiveCurrent(g, 'default_false');
      expect(g.completeWork()).toBeTrue();
      expect(g.stage()).toBe('wrap');
      expect(taskRows(g)).toEqual([row(TASK_DAY4, 'done', 6, 6)]);
      const delivered = g.save()!.events.filter((e) => e.kind === 'task.complete').map((e) => (e.payload as { taskId: string }).taskId);
      expect(delivered).not.toContain(TASK_DAY4_RETURN);
      expect(storedIsValid()).toBeTrue();
    }

    it('對照：編號與來源相同＋放行 → 沒有案件、不發私訊，Day 4 只有原工作', () => {
      playToDay2With(game, {});
      finishDay2(game);
      expectNoReturnThroughDay4(game);
    });

    it('對照：填錯但第二輪保留待查 → 沒有案件（含先放行後改保留）', () => {
      playToDay2With(game, { B102: '102', B607: '607' });
      game.openReport();
      game.setRecordReview('B102', 'release');
      game.setRecordReview('B102', 'hold');
      game.setRecordReview('B607', 'hold');
      expect(game.submitReply('ack')).toBeTrue();
      archiveCurrent(game, 'default_false');
      expect(game.completeWork()).toBeTrue();
      expectNoReturnThroughDay4(game);
    });

    it('對照：H17 填錯（不在 Day 2 審查範圍）＋B102／B607 放行 → 沒有案件', () => {
      playToDay2With(game, { H17: 'H-71' });
      expect(game.archived('H17')!.archiveCode).toBe('H-71');
      finishDay2(game);
      expect(Object.keys((game.save()!.taskProgress[TASK_DAY2] as { reviews: object }).reviews).sort()).toEqual(['B102', 'B607']);
      expectNoReturnThroughDay4(game);
    });

    it('對照：舊檔（v8）已完成 Day 2、沒有審查處置（即使 B102 為 "102"）→ 載入寫回 v11、不補造放行、不追罰', () => {
      playToDay2With(game, { B102: '102' });
      finishDay2(game);
      const played = game.save()!;
      const { reviews: _r, reportRevision: _rv, ...legacyProgress } = played.taskProgress[TASK_DAY2] as { reviews: unknown; reportRevision: unknown };
      const { returns: _ret, issueSchedule: _is, readIssueReceipts: _rr, version: _v, ...rest } = toV10(played);
      const v8: SaveV8 = {
        ...rest,
        version: 8,
        taskProgress: { ...played.taskProgress, [TASK_DAY2]: legacyProgress as never },
        events: played.events.filter((e) => e.kind !== 'record.review'),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(v8));
      expect(new SaveRepository().load().migratedFrom).toBe(8);
      const g = freshService();
      expect(g.storageIssue()).toBe('');
      expect(stored()!.version).toBe(11);
      expect(stored()!.returns).toEqual([]);
      expect(stored()!.issueSchedule).toEqual({});
      expect(stored()!.mailbox).toEqual([]);
      expect(stored()!.readMail).toEqual([]);
      expect(stored()!.taskProgress[TASK_DAY2]).toEqual({ kind: 'reconcile', reportOpened: true, receiptOpened: false, reply: 'ack' });
      expect(new SaveRepository().load().migratedFrom).toBe(11);
      expect(g.stage()).toBe('wrap');
      expectNoReturnThroughDay4(g);
    });

    /* ---------- v9 舊檔（R10 退件）→ v10 → v11 ---------- */

    describe('v9 舊檔遷移（pending／resubmitted／window → 持續的文件問題）', () => {
      /** 把現行存檔退回 R10 的 v9 形狀：退件只有 pending／resubmitted／window、沒有回條與排程；事件去掉 R11 才有的欄位。 */
      function toV9(save: Save): SaveV9 {
        const { issueSchedule: _s, readIssueReceipts: _r, returns, version: _v, ...rest } = toV10(save);
        const legacy: LegacyReturnCaseV9[] = returns.map((r) => {
          const last = r.versions[r.versions.length - 1];
          return {
            id: r.id,
            auditId: r.auditId,
            batchId: r.batchId,
            recordKey: r.recordKey,
            archiveTaskId: r.archiveTaskId,
            reviewTaskId: r.reviewTaskId,
            sourceCode: r.sourceCode,
            submittedCode: r.submittedCode,
            reviewedCode: r.reviewedCode,
            disposition: r.disposition,
            reason: r.reason,
            notifyDayId: r.notifyDayId,
            returnDayId: DAY_04,
            status: !last ? 'pending' : last.action === 'resubmit' ? 'resubmitted' : 'window',
            versions: r.versions.map((v) => ({ action: v.action, code: v.code, dayId: v.dayId })),
          };
        });
        const events = rest.events
          .filter((e) => e.kind !== 'return.checked')
          .map((e) => {
            if (e.kind !== 'return.resubmit' && e.kind !== 'return.window') return e;
            const p = e.payload as { dayId: string; returnId: string };
            return { ...e, payload: { dayId: p.dayId, returnId: p.returnId } };
          });
        return { ...rest, version: 9, returns: legacy, events };
      }

      /** 寫入 v9 → 新 service 載入：轉成 v11 並立刻寫回；再載入是 v11、不再遷移。 */
      function loadV9(v9: SaveV9): GameStateService {
        localStorage.setItem(SAVE_KEY, JSON.stringify(v9));
        expect(new SaveRepository().load().migratedFrom).toBe(9);
        const g = freshService();
        expect(g.hasSave()).toBeTrue();
        expect(g.storageIssue()).toBe('');
        expect(stored()!.version).toBe(11);
        expect(stored()).toEqual(JSON.parse(JSON.stringify(g.save()!)));
        expect(new SaveRepository().load().migratedFrom).toBe(11);
        // 舊檔已跨過入職：不補簽、直接進桌面
        expect(g.onboarding()).toEqual({ step: 0, complete: true });
        expect(g.profileName()).toBeNull();
        expect(g.displayName()).toBe(LEGACY_PLAYER_NAME);
        expect(storedIsValid()).toBeTrue();
        // 保留舊事件、不偽造之後的回條或放行
        expect(g.save()!.events).toEqual(v9.events);
        expect(g.save()!.returns.every((r) => r.receipts.length === 1)).toBeTrue();
        return g;
      }

      it('Day 4 work、目前是複審且退件待處理 → pending（dueDayId day.04）、第一張退件回條（已讀，不重亮）、當天排程引用它；可繼續處理並在下一工作日核對', () => {
        playToDay4WithReturn(game);
        toIssueTask(game);
        const native = game.save()!;
        const g = loadV9(toV9(native));
        // 郵件由回條重建（與原生相同）；v9→v10 把第一張退件回條視為已讀 → readMail
        expect(g.save()).toEqual({ ...native, readMail: [mailId(0)], onboarding: { step: 0, complete: true } });
        expect(g.mailbox()).toEqual([receiptMailOf(RECEIPT0)]);
        expect(g.returns()).toEqual([CASE_DAY3]);
        expect(g.save()!.issueSchedule).toEqual({ [DAY_04]: [RETURN_B102] });
        expect(unreadMail(g)).toEqual([]);
        expect(g.pendingIssueCount()).toBe(1);
        expect([g.dayId(), g.stage(), g.taskId()]).toEqual([DAY_04, 'work', TASK_DAY4_RETURN]);
        expect(taskRows(g)).toEqual([row(TASK_DAY4, 'done', 6, 6), row(TASK_DAY4_RETURN, 'active', 1, 0)]);
        expect(g.activeReturns().map((r) => r.id)).toEqual([RETURN_B102]);
        expect(g.latestIssueCode(g.returns()[0])).toBe('102');

        expect(g.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('ok');
        expect(g.returns()[0].versions).toEqual([{ index: 0, action: 'resubmit', code: '0102', dayId: DAY_04, checkDayId: DAY_05 }]);
        expect(g.completeWork()).toBeTrue();
        g.advanceDay();
        expect(g.returns()[0].status).toBe('resolved');
        expect(unreadMail(g)).toEqual([mailId(1)]);
        expect(storedIsValid()).toBeTrue();
      });

      it('Day 4 wrap、已重送（仍錯 103）→ awaiting-check，採最後保存版本、checkDayId day.05；不當成已解決；進 Day 5 由下游核對 → 再次退回', () => {
        playToDay4WithReturn(game);
        toIssueTask(game);
        expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '103')).toBe('ok');
        expect(game.completeWork()).toBeTrue();
        const native = game.save()!;
        const v9 = toV9(native);
        expect(v9.returns[0].status).toBe('resubmitted');
        const g = loadV9(v9);
        const migrated: ReturnCase = {
          ...BASE,
          status: 'awaiting-check',
          dueDayId: null,
          versions: [{ index: 0, action: 'resubmit', code: '103', dayId: DAY_04, checkDayId: DAY_05 }],
          receipts: [RECEIPT0],
        };
        expect(g.returns()).toEqual([migrated]);
        expect(g.save()!.issueSchedule).toEqual({ [DAY_04]: [RETURN_B102] });
        expect(g.save()!.readMail).toEqual([mailId(0)]);
        expect(g.mailbox()).toEqual([receiptMailOf(RECEIPT0)]);
        expect(g.stage()).toBe('wrap');
        expect(taskRows(g)).toEqual([row(TASK_DAY4, 'done', 6, 6), row(TASK_DAY4_RETURN, 'done', 1, 1)]);
        expect(g.pendingIssueCount()).toBe(0);

        g.advanceDay();
        expect(g.dayId()).toBe(DAY_05);
        expect(g.returns()[0]).toEqual({
          ...migrated,
          status: 'pending',
          dueDayId: DAY_06,
          versions: [{ ...migrated.versions[0], outcome: 'returned', checkedDayId: DAY_05 }],
          receipts: [RECEIPT0, { id: receiptId(1), kind: 'returned', dayId: DAY_05, versionIndex: 0, code: '103', reason: 'code-mismatch' }],
        });
        expect(unreadMail(g)).toEqual([mailId(1)]);
        expect(taskRows(g)).toEqual([row(TASK_DAY5, 'pending', 8, 0)]);
        expect(storedIsValid()).toBeTrue();
      });

      it('Day 5（原核對日已過、舊版沒有核對）已重送 0102 → awaiting-check，checkDayId 改為 day.06；不因名稱或內容正確就結案、不補造 Day 5 回條；Day 6 核對才結案', () => {
        playToDay4WithReturn(game);
        toIssueTask(game);
        expect(game.resubmitReturnStrict(RETURN_B102, receiptId(0), '0102')).toBe('ok');
        expect(game.completeWork()).toBeTrue();
        game.advanceDay(); // v10 會在這裡核對；v9 當時不會
        const v9 = toV9(game.save()!);
        expect([v9.dayId, v9.stage, v9.returns[0].status]).toEqual([DAY_05, 'morning', 'resubmitted']);
        expect(v9.events.some((e) => e.kind === 'return.checked')).toBeFalse();
        const g = loadV9(v9);
        expect(g.returns()).toEqual([
          {
            ...BASE,
            status: 'awaiting-check',
            dueDayId: null,
            versions: [{ index: 0, action: 'resubmit', code: '0102', dayId: DAY_04, checkDayId: DAY_06 }],
            receipts: [RECEIPT0],
          },
        ]);
        expect(g.save()!.issueSchedule).toEqual({ [DAY_04]: [RETURN_B102] });
        expect(taskRows(g)).toEqual([row(TASK_DAY5, 'pending', 8, 0)]);
        expect(countKind(g, 'return.checked')).toBe(0);

        g.startDay();
        finishToday(g);
        expect(g.returns()[0].status).toBe('awaiting-check');
        g.advanceDay();
        expect(g.dayId()).toBe(DAY_06);
        expect(g.returns()[0].status).toBe('resolved');
        expect(g.returns()[0].receipts[1]).toEqual({ id: receiptId(1), kind: 'resolved', dayId: DAY_06, versionIndex: 0, code: '0102', reason: null });
        expect(g.save()!.events.filter((e) => e.kind === 'return.checked').map((e) => e.payload)).toEqual([
          { dayId: DAY_06, returnId: RETURN_B102, versionIndex: 0, outcome: 'resolved' },
        ]);
        expect(storedIsValid()).toBeTrue();
      });

      it('送窗口（window）→ awaiting-window（仍未解決）；續玩到結束都不自動結案', () => {
        playToDay4WithReturn(game);
        toIssueTask(game);
        expect(game.sendReturnToWindowStrict(RETURN_B102, receiptId(0))).toBe('ok');
        expect(game.completeWork()).toBeTrue();
        const v9 = toV9(game.save()!);
        expect(v9.returns[0].status).toBe('window');
        const g = loadV9(v9);
        const migrated: ReturnCase = {
          ...BASE,
          status: 'awaiting-window',
          dueDayId: null,
          versions: [{ index: 0, action: 'window', code: '102', dayId: DAY_04, checkDayId: null }],
          receipts: [RECEIPT0],
        };
        expect(g.returns()).toEqual([migrated]);
        expect(g.pendingIssueCount()).toBe(0);
        expect(unreadMail(g)).toEqual([]);
        nextDay(g);
        playArchiveDaysUntil(g, DAY_06);
        finishToday(g);
        expect(g.stage()).toBe('end');
        expect(g.returns()).toEqual([migrated]);
        expect(storedIsValid()).toBeTrue();
      });
    });
  });

  /* ---------- R12：角色、入職前情、向同事詢問、回覆送達時間 ---------- */

  describe('R12 角色與入職前情', () => {
    const LAST_STEP = ONBOARDING.steps.length - 1;
    const CONTRACT = onboardingContractIndex;

    /** 新遊戲逐段前進到合約段（未簽名）。 */
    function toContract(g: GameStateService): void {
      g.newGame();
      for (let step = 1; step <= CONTRACT; step++) expect(g.advanceOnboarding(step)).withContext(`step ${step}`).toBeTrue();
      expect(g.onboarding()).toEqual({ step: CONTRACT, complete: false });
    }

    /** 直接寫入一份指定角色與入職進度的存檔（其餘為新遊戲），重建 service 讀入。 */
    function withProgress(name: string | null, step: number, complete: boolean): GameStateService {
      const g = freshService();
      g.newGame();
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...g.save()!, profile: { name }, onboarding: { step, complete } }));
      const loaded = freshService();
      expect(loaded.storageIssue()).toBe('');
      expect(loaded.hasSave()).toBeTrue();
      return loaded;
    }

    it('內容前提：合約段不是第一段也不是最後一段；舊存檔顯示名為「員工」', () => {
      expect(CONTRACT).toBeGreaterThan(0);
      expect(CONTRACT).toBeLessThan(LAST_STEP);
      expect(ONBOARDING.steps[CONTRACT].kind).toBe('contract');
      expect(LEGACY_PLAYER_NAME).toBe('員工');
    });

    it('無存檔：profileName null、displayName「員工」、onboarding null；入職操作都不做事、不建立存檔', () => {
      expect(game.profileName()).toBeNull();
      expect(game.displayName()).toBe(LEGACY_PLAYER_NAME);
      expect(game.onboarding()).toBeNull();
      expect(game.advanceOnboarding(1)).toBeFalse();
      expect(game.signContractStrict('林小安')).toBe('noop');
      expect(game.completeOnboarding()).toBeFalse();
      expect(game.mailbox()).toEqual([]);
      expect(game.unreadMailCount()).toBe(0);
      expect(game.isMailRead('mail.x')).toBeFalse();
      game.markMailRead(['mail.x']);
      game.setIssueDraft('return.x#0', 'x');
      expect(game.issueDraft('return.x#0')).toBeUndefined();
      expect(game.helpRequest(HELP_REQUEST)).toBeUndefined();
      expect(game.requestHelp(HELP_REQUEST)).toBeFalse();
      expect(game.resubmitReturnStrict('return.x', 'return.x#0', '0102')).toBe('noop');
      expect(game.sendReturnToWindowStrict('return.x', 'return.x#0')).toBe('noop');
      expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    });

    it('新遊戲：未簽名（displayName「員工」）、停在第一段、入職未完成 → routeForSave 為 /onboarding', () => {
      game.newGame();
      expect(game.profileName()).toBeNull();
      expect(game.displayName()).toBe(LEGACY_PLAYER_NAME);
      expect(game.onboarding()).toEqual({ step: 0, complete: false });
      expect(routeForSave(game.save()!)).toBe('/onboarding');
    });

    it('onboarding() 把段落限制在內容範圍內（手改存檔的過大段落不越界）；存檔本身不被改寫', () => {
      const g = withProgress(null, 99, false);
      expect(g.onboarding()).toEqual({ step: LAST_STEP, complete: false });
      expect(g.save()!.onboarding.step).toBe(99);
      expect(stored()!.onboarding.step).toBe(99);
      // 越界段落不能再前進
      expect(g.advanceOnboarding(100)).toBeFalse();
      expect(g.advanceOnboarding(LAST_STEP + 1)).toBeFalse();
    });

    it('advanceOnboarding 只能逐段 +1；停在合約段未簽名不能跳過；不能超過最後一段；完成後不能再前進', () => {
      game.newGame();
      const start = game.save();
      expect(game.advanceOnboarding(0)).toBeFalse();
      expect(game.advanceOnboarding(2)).toBeFalse();
      expect(game.advanceOnboarding(-1)).toBeFalse();
      expect(game.save()).toBe(start);
      expect(game.advanceOnboarding(1)).toBeTrue();
      expect(stored()!.onboarding).toEqual({ step: 1, complete: false });
      expect(game.advanceOnboarding(1)).toBeFalse(); // 重複點擊
      for (let step = 2; step <= CONTRACT; step++) expect(game.advanceOnboarding(step)).toBeTrue();
      expect(game.onboarding()).toEqual({ step: CONTRACT, complete: false });
      // 合約段：未簽名不能前進（簽名本身才會前進）
      const atContract = game.save();
      expect(game.advanceOnboarding(CONTRACT + 1)).toBeFalse();
      expect(game.save()).toBe(atContract);
      expect(game.profileName()).toBeNull();
      expect(game.signContractStrict('林小安')).toBe('ok');
      expect(game.onboarding()).toEqual({ step: CONTRACT + 1, complete: false });
      for (let step = CONTRACT + 2; step <= LAST_STEP; step++) expect(game.advanceOnboarding(step)).toBeTrue();
      expect(game.onboarding()).toEqual({ step: LAST_STEP, complete: false });
      // 最後一段之後改用 completeOnboarding
      expect(game.advanceOnboarding(LAST_STEP + 1)).toBeFalse();
      expect(game.onboarding()!.step).toBe(LAST_STEP);
      expect(game.completeOnboarding()).toBeTrue();
      expect(game.advanceOnboarding(LAST_STEP + 1)).toBeFalse();
      expect(storedIsValid()).toBeTrue();
    });

    it('signContractStrict：不在合約段（第一段、簽名後的下一段）→ noop；名字不合法 → noop，存檔不變、不寫檔', () => {
      game.newGame();
      const start = game.save();
      expect(game.signContractStrict('林小安')).toBe('noop'); // 第一段
      expect(game.save()).toBe(start);
      localStorage.clear();
      toContract(game);
      const atContract = game.save();
      const persist = spyOn(TestBed.inject(SaveRepository), 'persist').and.callThrough();
      for (const bad of ['', '   ', 'a'.repeat(25), '林\u0007安', '\n']) {
        expect(game.signContractStrict(bad)).withContext(JSON.stringify(bad)).toBe('noop');
      }
      expect(persist).not.toHaveBeenCalled();
      expect(game.save()).toBe(atContract);
      expect(game.profileName()).toBeNull();
      expect(game.storageIssue()).toBe('');
    });

    it('signContractStrict：寫入失敗 → failed、存檔與畫面都停在合約段未簽名；重試成功 → ok（正規化後的名字＋下一段，同一次寫入）', () => {
      toContract(game);
      const atContract = game.save();
      const raw = localStorage.getItem(SAVE_KEY);
      const persist = spyOn(TestBed.inject(SaveRepository), 'persist').and.returnValue(STORAGE.writeIssue);
      expect(game.signContractStrict('  林小安  ')).toBe('failed');
      expect(persist).toHaveBeenCalledTimes(1);
      expect(game.save()).toBe(atContract);
      expect(game.profileName()).toBeNull();
      expect(game.displayName()).toBe(LEGACY_PLAYER_NAME);
      expect(game.onboarding()).toEqual({ step: CONTRACT, complete: false });
      expect(game.storageIssue()).toBe(STORAGE.writeIssue);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);

      persist.and.callThrough();
      expect(game.signContractStrict('  林小安  ')).toBe('ok');
      expect(game.storageIssue()).toBe('');
      expect(game.profileName()).toBe('林小安');
      expect(game.displayName()).toBe('林小安');
      expect(game.onboarding()).toEqual({ step: CONTRACT + 1, complete: false });
      expect(stored()!.profile).toEqual({ name: '林小安' });
      expect(stored()!.onboarding).toEqual({ step: CONTRACT + 1, complete: false });
      expect(storedIsValid()).toBeTrue();
      // 已簽名：不能改名（不在合約段）
      expect(game.signContractStrict('別人')).toBe('noop');
      expect(game.profileName()).toBe('林小安');
      // 重新載入保留簽名與段落
      const g = freshService();
      expect(g.displayName()).toBe('林小安');
      expect(g.onboarding()).toEqual({ step: CONTRACT + 1, complete: false });
      expect(routeForSave(g.save()!)).toBe('/onboarding');
    });

    it('signContractStrict：已簽名的存檔停在合約段（手改）→ noop，不覆寫名字', () => {
      const g = withProgress('林小安', CONTRACT, false);
      const before = g.save();
      expect(g.signContractStrict('別人')).toBe('noop');
      expect(g.save()).toBe(before);
      expect(g.profileName()).toBe('林小安');
    });

    it('24 個字元（含組合字、表情序列算一個）可簽；25 個不可', () => {
      toContract(game);
      expect(game.signContractStrict('字'.repeat(25))).toBe('noop');
      const name = '字'.repeat(22) + String.fromCodePoint(0x1f469, 0x200d, 0x1f4bb) + 'e' + String.fromCodePoint(0x301);
      expect(game.signContractStrict(name)).toBe('ok');
      expect(game.profileName()).toBe(name);
    });

    it('completeOnboarding：只有已簽名且停在最後一段才完成；完成後 routeForSave 依階段（/work），重複呼叫 false', () => {
      toContract(game);
      expect(game.completeOnboarding()).toBeFalse(); // 合約段
      expect(game.signContractStrict('林小安')).toBe('ok');
      expect(game.completeOnboarding()).toBeFalse(); // 還不是最後一段
      for (let step = CONTRACT + 2; step <= LAST_STEP; step++) expect(game.advanceOnboarding(step)).toBeTrue();
      expect(game.completeOnboarding()).toBeTrue();
      expect(game.onboarding()).toEqual({ step: LAST_STEP, complete: true });
      expect(stored()!.onboarding).toEqual({ step: LAST_STEP, complete: true });
      expect(routeForSave(game.save()!)).toBe('/work');
      const done = game.save();
      expect(game.completeOnboarding()).toBeFalse();
      expect(game.save()).toBe(done);
      expect(storedIsValid()).toBeTrue();
      // 入職不影響工作進度：Day 1 照常
      expect([game.dayId(), game.stage(), game.taskId()]).toEqual([DAY_01, 'work', TASK_DAY1]);
    });

    it('completeOnboarding：停在最後一段但未簽名（手改）→ false、不寫入', () => {
      const g = withProgress(null, LAST_STEP, false);
      const before = g.save();
      expect(g.completeOnboarding()).toBeFalse();
      expect(g.save()).toBe(before);
      expect(g.onboarding()).toEqual({ step: LAST_STEP, complete: false });
    });

    it('舊存檔（v6）遷移：名字 null → displayName「員工」、入職視為已完成（不強迫補簽）；routeForSave 依階段', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV6Day2Work));
      const g = freshService();
      expect(g.profileName()).toBeNull();
      expect(g.displayName()).toBe(LEGACY_PLAYER_NAME);
      expect(g.onboarding()).toEqual({ step: 0, complete: true });
      expect(routeForSave(g.save()!)).toBe('/work');
      expect(g.advanceOnboarding(1)).toBeFalse();
      expect(g.signContractStrict('林小安')).toBe('noop');
      expect(g.completeOnboarding()).toBeFalse();
      expect(g.profileName()).toBeNull();
    });
  });

  describe('R12 向同事詢問與回覆送達時間（GameClock）', () => {
    const HELP_IDS = ['msg.help.refusal.meaning', 'msg.help.refusal.paths'];
    let clock: GameClock;

    /** 時鐘固定在 now、亂數固定在 r（0 → 每則 +3 秒，1 → 每則 +4 秒）。 */
    function setClock(now: number, r = 0): void {
      clock.now = () => now;
      clock.random = () => r;
    }

    beforeEach(() => {
      clock = TestBed.inject(GameClock);
    });

    it('內容前提：拒絕紀錄的提問在林予安私訊、說明兩則依序送達，第二則帶回覆 prompt', () => {
      expect(helpRequestOf(HELP_REQUEST)!.channelId).toBe(LIN_DM);
      expect(helpMessages(HELP_REQUEST).map((m) => m.id)).toEqual(HELP_IDS);
      expect(promptOf(HELP_PROMPT)!.anchor.id).toBe(HELP_IDS[1]);
      expect(HELP_IDS.map((id) => helpRequestOfMessage(id))).toEqual([HELP_REQUEST, HELP_REQUEST]);
    });

    it('requestHelp：用時鐘保存提問日、提問時間與逐則送達時間（亂數 0 → +3 秒累加），寫 help.request；只成功一次', () => {
      game.newGame();
      expect(game.conditionContext()!.helpRequested(HELP_REQUEST)).toBeFalse();
      setClock(T0, 0);
      const before = game.save()!;
      expect(game.requestHelp(HELP_REQUEST)).toBeTrue();
      const expected = {
        dayId: DAY_01,
        askedAt: T0,
        deliveries: [
          { messageId: HELP_IDS[0], at: T0 + 3000 },
          { messageId: HELP_IDS[1], at: T0 + 6000 },
        ],
      };
      expect(game.helpRequest(HELP_REQUEST)).toEqual(expected);
      expect(stored()!.helpRequests).toEqual({ [HELP_REQUEST]: expected });
      const after = game.save()!;
      expect(after.events.length).toBe(before.events.length + 1);
      expect(after.events[after.events.length - 1]).toEqual(
        jasmine.objectContaining({ kind: 'help.request', payload: { dayId: DAY_01, requestId: HELP_REQUEST } }),
      );
      expect(workFields(after)).toEqual(workFields(before));
      expect(game.conditionContext()!.helpRequested(HELP_REQUEST)).toBeTrue();
      expect(storedIsValid()).toBeTrue();

      // 再問一次（時間、亂數都不同）：false、不寫檔、不重排
      setClock(T0 + 60_000, 1);
      const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
      expect(game.requestHelp(HELP_REQUEST)).toBeFalse();
      expect(game.save()).toBe(after);
      expect(setItem).not.toHaveBeenCalled();
      expect(countKind(game, 'help.request')).toBe(1);
      // 重新載入不重抽
      const g = freshService();
      expect(g.helpRequest(HELP_REQUEST)).toEqual(expected);
      expect(g.requestHelp(HELP_REQUEST)).toBeFalse();
    });

    it('requestHelp：亂數 1 → 每則 +4 秒；提問日＝目前遊戲日；未知提問 false', () => {
      playToDay3(game);
      setClock(T0, 1);
      expect(game.requestHelp('request.nope')).toBeFalse();
      expect(game.requestHelp(HELP_REQUEST)).toBeTrue();
      expect(game.helpRequest(HELP_REQUEST)).toEqual({
        dayId: DAY_03,
        askedAt: T0,
        deliveries: [
          { messageId: HELP_IDS[0], at: T0 + 4000 },
          { messageId: HELP_IDS[1], at: T0 + 8000 },
        ],
      });
      expect(storedIsValid()).toBeTrue();
    });

    it('isHelpMessageDelivered／isPromptOpen：提問前不可回答；說明依保存的送達時間逐則送達，錨點送達後 prompt 才可回答（重新載入相同）', () => {
      game.newGame();
      setClock(T0, 0);
      expect(game.isPromptOpen(HELP_PROMPT)).toBeFalse(); // 還沒問
      expect(game.answerPrompt(HELP_PROMPT, 'ack')).toBeFalse();
      expect(game.isHelpMessageDelivered(HELP_IDS[0])).toBeFalse(); // 沒有排程＝未送達
      expect(game.isHelpMessageDelivered('msg.day1.welcome')).toBeTrue(); // 非提問訊息
      expect(game.requestHelp(HELP_REQUEST)).toBeTrue();
      // 錨點（第二則）在 T0+6000 送達
      setClock(T0 + 2999);
      expect(game.isHelpMessageDelivered(HELP_IDS[0])).toBeFalse();
      expect(game.isPromptOpen(HELP_PROMPT)).toBeFalse();
      setClock(T0 + 3000);
      expect(game.isHelpMessageDelivered(HELP_IDS[0])).toBeTrue();
      expect(game.isHelpMessageDelivered(HELP_IDS[1])).toBeFalse();
      expect(game.isPromptOpen(HELP_PROMPT)).toBeFalse();
      const before = game.save();
      expect(game.answerPrompt(HELP_PROMPT, 'ack')).toBeFalse();
      expect(game.skipPrompt(HELP_PROMPT)).toBeFalse();
      expect(game.save()).toBe(before);
      setClock(T0 + 5999);
      expect(game.isPromptOpen(HELP_PROMPT)).toBeFalse();
      setClock(T0 + 6000);
      expect(game.isHelpMessageDelivered(HELP_IDS[1])).toBeTrue();
      expect(game.isHelpMessageDelivered(HELP_IDS[1], T0 + 5999)).toBeFalse(); // 可傳入判斷時間
      expect(game.isPromptOpen(HELP_PROMPT)).toBeTrue();
      // 重新載入：新的時鐘，保存的排程不變
      const g = freshService();
      const c2 = TestBed.inject(GameClock);
      c2.now = () => T0 + 5999;
      expect(g.isPromptOpen(HELP_PROMPT)).toBeFalse();
      c2.now = () => T0 + 6000;
      expect(g.isPromptOpen(HELP_PROMPT)).toBeTrue();
      // 說明永久留存、可回答到 availableThrough（Day 6）
      expect(promptOf(HELP_PROMPT)!.prompt.availableThrough).toBe(DAY_06);
    });

    it('answerPrompt（提問說明）：保存回答時間、遊戲日與送達時間（亂數 1 → +4 秒）；只成功一次', () => {
      game.newGame();
      setClock(T0, 0);
      expect(game.requestHelp(HELP_REQUEST)).toBeTrue();
      const T1 = T0 + 10_000;
      setClock(T1, 1);
      expect(game.isPromptOpen(HELP_PROMPT)).toBeTrue();
      const choice = promptOf(HELP_PROMPT)!.prompt.choices.find((c) => c.id === 'ask-blank')!;
      expect(game.answerPrompt(HELP_PROMPT, 'ask-blank')).toBeTrue();
      expect(game.chatReply(HELP_PROMPT)).toEqual({
        kind: 'answered',
        choiceId: 'ask-blank',
        playerText: choice.text,
        responses: choice.responses.map((r, i) => ({ id: r.id, actorId: r.actorId, time: r.time, lines: [...r.lines], deliverAt: T1 + 4000 * (i + 1) })),
        answeredAt: T1,
        dayId: DAY_01,
      });
      expect(game.isPromptOpen(HELP_PROMPT)).toBeFalse();
      expect(game.answerPrompt(HELP_PROMPT, 'ack')).toBeFalse();
      expect(storedIsValid()).toBeTrue();
    });

    it('answerPrompt：多則回應逐則累加（亂數 0 → +3 秒、+6 秒）；保存後時鐘或亂數改變、重新載入都不重抽', () => {
      reachDay3Lunch(game);
      setClock(T0, 0);
      expect(game.answerPrompt(PROMPT_LUNCH, 'join')).toBeTrue();
      const reply = game.chatReply(PROMPT_LUNCH);
      if (reply?.kind !== 'answered') throw new Error('expected answered');
      expect(reply.answeredAt).toBe(T0);
      expect(reply.dayId).toBe(DAY_03);
      expect(reply.responses.map((r) => r.deliverAt)).toEqual([T0 + 3000, T0 + 6000]);
      setClock(T0 + 99_999, 1);
      expect(game.chatReply(PROMPT_LUNCH)).toEqual(reply);
      expect(freshService().chatReply(PROMPT_LUNCH)).toEqual(reply);
      expect(stored()!.chatReplies[PROMPT_LUNCH]).toEqual(JSON.parse(JSON.stringify(reply)));
    });
  });

  describe('R10 H204：commitCase(key, decisionId, code) 保存玩家編號', () => {
    it('任意合法編號照玩家輸入保存；決定只帶依據／去向／註記；刷新、跨日與 Day 4 私訊都正常', () => {
      playToDay3(game);
      game.openCase(CASE_H204);
      expect(game.commitCase('H204', 'registry', 'zz 0099')).toBeTrue();
      const entry = game.archived('H204')!;
      const content = archiveTask(TASK_DAY3).caseReview!.decisions.find((d) => d.id === 'registry')!;
      expect(entry.archiveCode).toBe('zz 0099');
      expect(entry.source.code).toBe('H-204');
      expect(entry.caseDecision).toEqual({
        caseId: CASE_H204,
        decisionId: 'registry',
        destination: content.destination,
        basisDocumentId: content.basisDocumentId,
        note: content.note,
      });
      expect(storedIsValid()).toBeTrue();
      const restored = freshService();
      expect(restored.storageIssue()).toBe('');
      expect(restored.archived('H204')).toEqual(entry);
      archiveCurrent(restored, 'default_false');
      expect(restored.completeWork()).toBeTrue();
      nextDay(restored);
      expect(h204Dms(restored)).toEqual([H204_DM['registry']]);
      expect(stored()!.batches[BATCH_DAY03]!.archived['H204']!.archiveCode).toBe('zz 0099');
      expect(storedIsValid()).toBeTrue();
    });

    it('補件決定配上登記表編號也合法（依據與編號各自保存，不互相矯正）', () => {
      playToDay3(game);
      game.openCase(CASE_H204);
      expect(game.commitCase('H204', 'supplement', 'H-204')).toBeTrue();
      expect(game.archived('H204')!.archiveCode).toBe('H-204');
      expect(game.archived('H204')!.caseDecision!.basisDocumentId).toBe('doc.day3.h204.supplement');
      expect(freshService().storageIssue()).toBe('');
    });

    it('選處理方式（草稿 decisionId）不覆寫玩家已編輯的編號；刷新保留；提交用玩家草稿', () => {
      playToDay3(game);
      game.openCase(CASE_H204);
      game.updateDraft('H204', { value: 'H-2O4' });
      game.updateDraft('H204', { decisionId: 'supplement' });
      expect(game.draft('H204')).toEqual({ value: 'H-2O4', decisionId: 'supplement' });
      game.updateDraft('H204', { decisionId: 'review' });
      expect(game.draft('H204')).toEqual({ value: 'H-2O4', decisionId: 'review' });
      expect(storedBatch().drafts['H204']).toEqual({ value: 'H-2O4', decisionId: 'review' });
      expect(storedIsValid()).toBeTrue();

      const restored = freshService();
      const d = restored.draft('H204');
      expect(d).toEqual({ value: 'H-2O4', decisionId: 'review' });
      expect(restored.commitCase('H204', d.decisionId!, d.value)).toBeTrue();
      expect(restored.archived('H204')!.archiveCode).toBe('H-2O4');
      expect(restored.archived('H204')!.caseDecision!.decisionId).toBe('review');
      expect(restored.archived('H204')!.caseDecision!.destination).toBe('review');
    });
  });

  describe('R10 Day 6 欄位映射依玩家對應', () => {
    beforeEach(() => playToDay6(game));

    it('文字欄位互換（contact-status ← record-date、effective-date ← contact-result）可預覽、提交，輸出照互換；刷新保留並可完成', () => {
      game.setFieldAssignment('personnel-code', 'legacy-id');
      game.setFieldAssignment('exclude-flag', 'objection-reply');
      game.setFieldAssignment('contact-status', 'record-date');
      game.setFieldAssignment('effective-date', 'contact-result');
      game.setFieldBlankPolicy('default_false');
      const check = game.previewFieldMap();
      expect(check?.ok).toBeTrue();
      expect(game.fieldMap()!.previewed).toBeTrue();
      expect(game.submitFieldMap()).toBeTrue();
      const sub = game.fieldMap()!.submitted!;
      expect(sub.rowCount).toBe(8);
      expect(sub.affectedCount).toBe(4);
      expect(sub.rows.find((r) => r.id === 'row.0102')!.values).toEqual({
        'personnel-code': '0102',
        'exclude-flag': false,
        'contact-status': '2026-09-16',
        'effective-date': '未接',
      });
      for (const r of game.fieldMapPlan()!.rows) {
        const out = sub.rows.find((x) => x.id === r.id)!.values;
        expect(out['contact-status']).withContext(r.id).toBe(r.values['record-date']);
        expect(out['effective-date']).withContext(r.id).toBe(r.values['contact-result']);
      }
      const ev = stored()!.events[stored()!.events.length - 1];
      expect(ev.payload).toEqual({ taskId: TASK_DAY6, blankPolicy: 'default_false', rowCount: 8, affectedCount: 4 });
      expect(storedIsValid()).toBeTrue();
      const restored = freshService();
      expect(restored.storageIssue()).toBe('');
      expect(restored.fieldMap()!.submitted).toEqual(sub);
      expect(restored.completeWork()).toBeTrue();
      expect(restored.stage()).toBe('end');
    });

    it('布林目標配到文字欄位（exclude-flag ← contact-result）→ unconvertible：不預覽、不可提交、存檔不變', () => {
      game.setFieldAssignment('personnel-code', 'legacy-id');
      game.setFieldAssignment('exclude-flag', 'contact-result');
      game.setFieldAssignment('contact-status', 'objection-reply');
      game.setFieldAssignment('effective-date', 'record-date');
      game.setFieldBlankPolicy('default_false');
      expect(game.fieldMapCheck()).toEqual({ ok: false, error: 'unconvertible' });
      const before = game.save();
      const raw = localStorage.getItem(SAVE_KEY);
      expect(game.previewFieldMap()).toEqual({ ok: false, error: 'unconvertible' });
      expect(game.save()).toBe(before);
      expect(game.fieldMap()!.previewed).toBeFalse();
      expect(game.submitFieldMap()).toBeFalse();
      expect(game.completeWork()).toBeFalse();
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      // 另一個文字欄位（legacy-id）也一樣；無法轉換優先於缺政策
      game.setFieldAssignment('personnel-code', 'contact-result');
      game.setFieldAssignment('exclude-flag', 'legacy-id');
      expect(game.fieldMapCheck()).toEqual({ ok: false, error: 'unconvertible' });
      expect(storedIsValid()).toBeTrue();
    });
  });


  describe('arranged（四格矩陣）', () => {
    it('B102 request_review 走到 Day 2 → arranged() === night().intervention', () => {
      playToDay2(game, 'request_review');
      expect(game.archived('B102')!.refusal).toBeNull();
      expect(game.arranged()).toBe(game.night()!.intervention);
    });

    it('B102 default_false 走到 Day 2 → arranged() 恒 true', () => {
      playToDay2(game, 'default_false');
      expect(game.archived('B102')!.refusal).toBeFalse();
      expect(game.arranged()).toBeTrue();
    });

    for (const [policy, intervention, expected] of [
      ['default_false', false, true],
      ['default_false', true, true],
      ['request_review', false, false],
      ['request_review', true, true],
    ] as const) {
      it(`B102 ${policy}＋介入 ${intervention} → ${expected}；Day 2 新件歸檔前後、wrap、刷新都相同`, () => {
        const g = newGameWithSeed(seedWithIntervention(intervention));
        archiveAll(g, policy);
        expect(g.completeWork()).toBeTrue();
        // Day 1 補入批次不影響核對來源
        archiveCurrent(g, 'request_review');
        expect(g.completeWork()).toBeTrue();
        nextDay(g);
        expect(g.night()!.intervention).toBe(intervention);
        const seen: boolean[] = [g.arranged()];
        expect(replyAfterReview(g, 'ack')).toBeTrue();
        seen.push(g.arranged());
        expect(g.taskId()).toBe(TASK_DAY2_ARCHIVE);
        archiveCurrent(g, 'default_false', 2);
        seen.push(g.arranged());
        seen.push(freshService().arranged());
        archiveCurrent(g, 'default_false');
        expect(g.completeWork()).toBeTrue();
        expect(g.stage()).toBe('wrap');
        seen.push(g.arranged());
        seen.push(freshService().arranged());
        expect(seen).toEqual(Array<boolean>(seen.length).fill(expected));
      });
    }

    it('非核對日（Day 1、Day 3）→ arranged() 一律 false', () => {
      game.newGame();
      game.updateDraft('B102', { value: '0102', policy: 'default_false' });
      game.archive('B102', okOf(game, 'B102'));
      expect(game.arranged()).toBeFalse();

      localStorage.clear();
      const g = freshService();
      playToDay3(g, 'default_false');
      expect(g.arranged()).toBeFalse();
      expect(g.subjectKey()).toBeNull();
    });
  });
});
