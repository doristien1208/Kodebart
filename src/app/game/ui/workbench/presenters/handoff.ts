import { taskHeading } from '../../../content/bundle';
import { MAIL_UI, TASKS_UI, WORKDAY_UI, caseNumber, handoffItem, issueStatusLabel } from '../../../content/text';
import { DayDirectory } from '../../../core/day-plan';
import { batchOf } from '../../../core/rules';
import { Save } from '../../../core/types';
import { attachmentProgressOf, attachmentStatus, reportProgressOf, transformProgressOf } from '../../../core/workday';
import type { DayTaskItem } from '../../../state/game-state.service';

/**
 * 本日交接（M1 §3 收班）的純函式 presenter：交付清單＋留待下一工作日的項目。
 * 全部由保存的資料推導：未結的退件、保留缺漏或待修正的附件關聯、批次與報告的待補列、送覆核的歸檔紀錄。
 * 只輸出玩家看得懂的文字（工作名稱、案號、數量），不含內部 ID。
 */
export interface HandoffRow {
  taskId: string;
  heading: string;
  summary: string;
  waived: boolean;
}

export interface HandoffView {
  delivered: readonly HandoffRow[];
  pending: readonly string[];
}

function headingOf(taskId: string): string {
  try {
    return taskHeading(taskId);
  } catch {
    return '';
  }
}

export function handoffView(save: Save, tasks: readonly DayTaskItem[], dir: DayDirectory): HandoffView {
  const delivered = tasks.map((t) => ({
    taskId: t.taskId,
    heading: t.heading,
    summary: t.status === 'waived' ? TASKS_UI.statusWaived : handoffItem(t.kind, t.processed),
    waived: t.status === 'waived',
  }));
  const pending: string[] = [];
  // 跨日持續存在的文件問題（未結案）
  for (const r of save.returns) {
    if (r.status !== 'resolved') pending.push(`${caseNumber(r.auditId, r.recordKey)}｜${issueStatusLabel(r.status)}`);
  }
  // 到今天為止的工作：附件、批次、報告、送覆核的歸檔紀錄
  const upTo = dir.days.slice(0, dir.days.indexOf(save.dayId) + 1);
  for (const dayId of upTo) {
    for (const task of dir.plan(dayId)?.tasks ?? []) {
      const heading = headingOf(task.id);
      switch (task.kind) {
        case 'attachment': {
          const p = attachmentProgressOf(save, task.id);
          const latest = p.versions[p.versions.length - 1];
          if (attachmentStatus(p) === 'returned') pending.push(`${heading}｜${MAIL_UI.current}`);
          else if (latest?.destination === 'review') pending.push(`${heading}｜${WORKDAY_UI.statusPending}`);
          break;
        }
        case 'transform': {
          const n = transformProgressOf(save, task.id).submitted?.pendingCount ?? 0;
          if (n > 0) pending.push(`${heading}｜${WORKDAY_UI.pendingCount} ${n}`);
          break;
        }
        case 'report': {
          const n = reportProgressOf(save, task.id).submitted?.pendingCount ?? 0;
          if (n > 0) pending.push(`${heading}｜${WORKDAY_UI.pendingCount} ${n}`);
          break;
        }
        case 'archive': {
          if (dayId !== save.dayId) break;
          const n = Object.values(batchOf(save, task.batchId).archived).filter((a) => a?.origin === 'review').length;
          if (n > 0) pending.push(`${heading}｜${WORKDAY_UI.pendingCount} ${n}`);
          break;
        }
        default:
          break;
      }
    }
  }
  return { delivered, pending };
}
