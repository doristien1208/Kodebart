import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MailAttachment, ReturnCase } from '../../../core/types';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { archiveWith, finishDay, instantOperations, reviewAll } from '../../testing/play';

/**
 * 郵件／附件規格共用的「照正常流程玩」工具（只給 *.spec.ts 匯入，不進 app bundle）。
 * 一律經 GameStateService 走真實規則（Day 1 B102 輸入錯誤 → Day 2 明確放行 → Day 3 下游退件），不手刻存檔。
 */

/** 重新建立 TestBed（重新讀取 localStorage 的存檔）；提交流程不等待演出節奏。 */
export function bootGame(): GameStateService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.returnValue(Promise.resolve(true));
  return TestBed.inject(GameStateService);
}

/** 在目前的狀態服務上另開新局 → Day 1 B102 輸入 code（來源 0102）→ Day 2 逐筆放行 → Day 3 工作階段。 */
export function playToFirstReturn(game: GameStateService, code = '102'): GameStateService {
  game.newGame();
  archiveWith(game, { B102: code });
  if (!game.completeWork()) throw new Error('Day 1 交付失敗');
  finishDay(game);
  game.openReport();
  reviewAll(game, 'release');
  if (!game.submitReply('ack')) throw new Error('Day 2 回覆失敗');
  finishDay(game);
  if (game.dayId() !== 'day.03' || game.returns().length !== 1) throw new Error('Day 3 沒有退件');
  return game;
}

/** 清空存檔、重新啟動後玩到 Day 3（第一封退件郵件已寄達）。 */
export function toFirstReturn(code = '102'): GameStateService {
  localStorage.clear();
  return playToFirstReturn(bootGame(), code);
}

/** 唯一的退件案件。 */
export function onlyCase(game: GameStateService): ReturnCase {
  const item = game.returns()[0];
  if (!item) throw new Error('沒有退件案件');
  return item;
}

/** 某份回條（依序，0 起算）對應的郵件附件引用。 */
export function receiptRef(game: GameStateService, index: number): MailAttachment {
  const item = onlyCase(game);
  const receipt = item.receipts[index];
  if (!receipt) throw new Error(`沒有第 ${index + 1} 份回條`);
  return { kind: 'return-receipt', caseId: item.id, receiptId: receipt.id, versionIndex: receipt.versionIndex };
}

/** 直接經狀態層從目前可修訂的回條重新送審（不經畫面）。 */
export function resubmitNow(game: GameStateService, code: string): void {
  const item = onlyCase(game);
  const receiptId = game.editableReceiptId(item.id);
  if (!receiptId || game.resubmitReturnStrict(item.id, receiptId, code) !== 'ok') throw new Error('重新送審失敗');
}

/** 完成今天其餘工作並進到下一天的工作階段（錯誤文件處理若已從附件處理，不會再送一次）。 */
export function toNextDay(game: GameStateService): void {
  finishDay(game);
}

/** 把目前存檔改寫後存回（只用於模擬舊存檔或內容移除等邊界），回傳重新啟動的狀態服務。 */
export function rewriteSave(game: GameStateService, change: (save: Record<string, unknown>) => void): GameStateService {
  const save = JSON.parse(JSON.stringify(game.save())) as Record<string, unknown>;
  change(save);
  localStorage.setItem('kodebart-save-v2', JSON.stringify(save));
  return bootGame();
}
