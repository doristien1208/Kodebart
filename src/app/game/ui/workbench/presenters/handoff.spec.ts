import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { taskHeading } from '../../../content/bundle';
import { MAIL_UI, TASKS_UI, WORKDAY_UI, handoffItem } from '../../../content/text';
import { Save } from '../../../core/types';
import { DAY_DIRECTORY } from '../../../state/day-directory';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { M1Choices, M1_SAVE_A, M1_SAVE_B, doM1Task, instantOperations, playM1To } from '../../testing/play';
import { handoffView } from './handoff';

/**
 * 本日交接 presenter（M1 §3 收班）：交付清單（今天每件工作與數量）＋留待下一工作日的項目，
 * 全部由保存的資料推導；不含內部 ID。
 */

const INTERNAL = /task\.|record\.|doc\.|batch\.|day\.0|mail\.|return\.|\b(true|false|null|undefined)\b/;

function newGame(): GameStateService {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.returnValue(Promise.resolve(true));
  const game = TestBed.inject(GameStateService);
  game.newGame();
  return game;
}

/** 做完今天除了最後一件之外的工作，最後一件只送件不交付（交接面板打開的時點）。 */
function toHandoff(game: GameStateService, c: M1Choices): void {
  while (!game.isLastTask()) doM1Task(game, c);
  const task = game.task();
  if (task?.kind === 'transform') {
    game.setTransformPolicy(c.transform);
    game.previewTransform();
    expect(game.submitTransformStrict()).toBe('ok');
  } else if (task?.kind === 'attachment') {
    expect(game.submitAttachmentStrict(c.attach[task.id] ?? { choiceId: 'review' })).toBe('ok');
  } else {
    throw new Error(`最後一件不是預期的工作：${task?.kind}`);
  }
  expect(game.taskDone()).toBeTrue();
}

function saveOf(game: GameStateService): Save {
  const s = game.save();
  if (!s) throw new Error('沒有存檔');
  return s;
}

describe('handoff presenter（M1 本日交接）', () => {
  afterEach(() => localStorage.clear());

  it('交付清單逐件列出今天的工作與數量；保留缺漏的批次、送覆核的附件與歸檔紀錄留待下一工作日', () => {
    const game = newGame();
    const keep: M1Choices = { ...M1_SAVE_B, attach: { ...M1_SAVE_B.attach, 'task.day5.m1-attachment': { choiceId: 'review' } } };
    playM1To(game, 'day.05', keep);
    toHandoff(game, keep);
    const v = handoffView(saveOf(game), game.dayTasks(), DAY_DIRECTORY);
    expect(v.delivered.map((r) => r.heading)).toEqual(game.dayTasks().map((t) => t.heading));
    expect(v.delivered.map((r) => r.summary)).toEqual(game.dayTasks().map((t) => handoffItem(t.kind, t.processed)));
    expect(v.delivered.every((r) => !r.waived)).toBeTrue();
    expect(v.pending).toContain(`${taskHeading('task.day5.m1-attachment')}｜${WORKDAY_UI.statusPending}`);
    expect(v.pending.some((p) => p.startsWith(`${taskHeading('task.day5.m1-transform')}｜${WORKDAY_UI.pendingCount} `))).toBeTrue();
    expect(v.pending.some((p) => p.startsWith(`${taskHeading('task.day5.archive')}｜${WORKDAY_UI.pendingCount} `))).toBeTrue();
    // 前一天保留缺漏的批次也還在交接清單上
    expect(v.pending.some((p) => p.startsWith(`${taskHeading('task.day4.m1-transform')}｜`))).toBeTrue();
    for (const line of [...v.pending, ...v.delivered.flatMap((r) => [r.heading, r.summary])]) expect(line).not.toMatch(INTERNAL);
  });

  it('退回待修正的附件關聯與未結的退件案件跨日留在交接清單；免補的工作標示免補', () => {
    const game = newGame();
    playM1To(game, 'day.03', { ...M1_SAVE_A, codes: { ...M1_SAVE_A.codes, B102: '102' } });
    playM1To(game, 'day.05', M1_SAVE_A);
    toHandoff(game, M1_SAVE_A);
    const v = handoffView(saveOf(game), game.dayTasks(), DAY_DIRECTORY);
    expect(v.pending).toContain(`${taskHeading('task.day4.m1-attachment')}｜${MAIL_UI.current}`);
    expect(v.pending.some((p) => p.startsWith('RT-B102｜'))).toBeTrue();

    const waived = handoffView(
      saveOf(game),
      game.dayTasks().map((t, i) => (i === 0 ? { ...t, status: 'waived' as const } : t)),
      DAY_DIRECTORY,
    );
    expect(waived.delivered[0]).toEqual(jasmine.objectContaining({ summary: TASKS_UI.statusWaived, waived: true }));
  });

  it('沒有留待事項時清單為空（照來源填寫、引用回覆、套用預設）', () => {
    const game = newGame();
    const clean: M1Choices = { ...M1_SAVE_A, codes: {} };
    playM1To(game, 'day.02', clean);
    toHandoffDay2(game);
    expect(handoffView(saveOf(game), game.dayTasks(), DAY_DIRECTORY).pending).toEqual([]);
  });
});

/** Day 2：核對送出回覆即完成，交接只看今天。 */
function toHandoffDay2(game: GameStateService): void {
  while (!game.isLastTask()) doM1Task(game, M1_SAVE_A);
  expect(game.isLastTask()).toBeTrue();
}
