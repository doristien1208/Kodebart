import { CONTENT_SOURCES, archiveTask, taskHeading } from './bundle';
import { recordLabel } from './records';
import { issueTaskId } from './schema';
import * as text from './text';
import {
  ARCHIVE_UI,
  EXECUTION_LOG_UI,
  FIELD_MAP_UI,
  HANDOFF_UI,
  MESSAGES,
  MORNING_UI,
  RECORD_STATUS,
  SOURCE_CARD,
  TASKS_UI,
  WORKBENCH,
  archiveFooterPending,
  archiveProgress,
  dayName,
  deliverLabel,
  formatText,
  handoffItem,
  morningDocTitle,
  morningPending,
  progressLabel,
  stepLabel,
  taskKindLabel,
  taskUnit,
  totalTasks,
  transitionCount,
} from './text';

/**
 * KB-P1-02：畫面文案不得寫死筆數。
 * R6-01：共同 archive 介面字串搬到 ui.archive 後，Day 1 玩家可見文字必須逐字不變；
 * text.ts 不再有日別物件（DAY1／DAY2／OVERNIGHT／END／PHASE_LABEL）。
 */

/** R5 時 Day 1 task text 的完整內容（搬移前逐字）；R6 後由 archiveTask 的 3 欄＋ARCHIVE_UI 組成。 */
const DAY1_BEFORE_R6 = {
  eyebrow: 'ARCHIVE / BATCH 01',
  heading: '人員資料歸檔',
  instruction: '請依來源資料核對人員編號，完成歸檔。',
  progressTemplate: '{count} / {total} 已處理',
  doneHeading: '已完成處理',
  doneBody: '資料已保存至本日批次。',
  doneCode: '人員編號：',
  doneMethod: '處理方式：',
  methodReview: '送資料覆核',
  methodArchive: '正式歸檔',
  nameLabel: '姓名',
  fieldLabel: '人員編號',
  useCode: '使用來源編號',
  missingLegend: '缺少拒絕紀錄',
  policyDefault: '依缺值規則填入 false',
  policyReview: '保留 null，送資料覆核',
  validate: '驗證並預覽',
  previewOk: '驗證通過',
  confirm: '確認歸檔',
  footerDone: '本日批次已完成。',
  footerPendingTemplate: '完成 {total} 筆資料後即可交接。',
  finishDay: '完成今日交接',
  statusArchived: '歸檔完成。',
  queueEyebrow: 'QUEUE',
  queueLabel: '本日資料佇列',
  queuePending: '待處理',
  queueDone: '已完成',
  queueDoneMark: '✓',
  queueSelectedMark: '▸',
};

/** R7 §6.1 在 archive 物件加入／取代的鍵（逐字）；其他進度、按鈕與 queue 字串保留。 */
const ARCHIVE_R7_CHANGES = {
  missingLegend: '這筆來源沒有提供拒絕紀錄',
  policyDefault: '視為「未拒絕」，完成正式歸檔',
  policyDefaultHint: '系統將依預設值補齊此欄位。',
  policyReview: '保留為「未確認」，送交資料覆核',
  policyReviewHint: '此筆資料將進入待補佇列。',
  previewOk: '資料檢查完成',
  previewHeading: '歸檔結果',
  previewCode: '人員編號',
  previewStatus: '拒絕狀態',
  previewDestination: '資料去向',
  destinationArchive: '正式歸檔',
  destinationReview: '資料覆核佇列',
};

describe('Day 1 歸檔文字：R6 搬移後只有 R7 §6.1 指定的鍵改變，R8 只搬走 finishDay，R11 只移除 useCode', () => {
  it('Day 1 task 的 3 欄＋ARCHIVE_UI 恰好等於搬移前的 Day 1 text 加上 R7 的加入／取代，減去 R8 搬走與 R11 移除的鍵', () => {
    const { finishDay: _movedToTasks, useCode: _removedR11, ...expected } = { ...DAY1_BEFORE_R6, ...ARCHIVE_R7_CHANGES };
    expect({ ...archiveTask('task.day1.archive').text, ...ARCHIVE_UI }).toEqual(expected);
  });

  it('R8：finishDay 逐字搬到 TASKS_UI，archive／fieldMap 不再有', () => {
    expect(TASKS_UI.finishDay).toBe(DAY1_BEFORE_R6.finishDay);
    expect(Object.keys(ARCHIVE_UI)).not.toContain('finishDay');
    expect(Object.keys(FIELD_MAP_UI)).not.toContain('finishDay');
  });

  it('Day 1 第二批與 Day 2 新件共用同一份 ARCHIVE_UI，日別只有 3 欄', () => {
    for (const id of ['task.day1.archive-followup', 'task.day2.archive']) {
      expect(Object.keys(archiveTask(id).text).sort()).withContext(id).toEqual(['eyebrow', 'heading', 'instruction']);
    }
  });

  it('Day 1 task text 只剩日別 3 欄', () => {
    expect(Object.keys(archiveTask('task.day1.archive').text).sort()).toEqual(['eyebrow', 'heading', 'instruction']);
  });

  it('Day 3–5 共用同一份 ARCHIVE_UI，日別只換 3 欄', () => {
    for (const n of [3, 4, 5]) {
      expect(Object.keys(archiveTask(`task.day${n}.archive`).text).sort()).toEqual(['eyebrow', 'heading', 'instruction']);
    }
  });
});

describe('歸檔文字依筆數產生', () => {
  it('progress 同時吃 count 與 total', () => {
    expect(archiveProgress(0, 3)).toBe('0 / 3 已處理');
    expect(archiveProgress(7, 12)).toBe('7 / 12 已處理');
    expect(archiveProgress(8, 8)).toBe('8 / 8 已處理');
  });

  it('footerPending 依 total 產生，不寫死筆數', () => {
    expect(archiveFooterPending(3)).toBe('完成 3 筆資料後即可交接。');
    expect(archiveFooterPending(8)).toBe('完成 8 筆資料後即可交接。');
  });

  it('formatText 與 archiveProgress 同一套代入', () => {
    expect(formatText(ARCHIVE_UI.progressTemplate, { count: 2, total: 5 })).toBe(archiveProgress(2, 5));
  });

  it('佇列狀態一律有文字，不只靠顏色', () => {
    expect(ARCHIVE_UI.queuePending).toBe('待處理');
    expect(ARCHIVE_UI.queueDone).toBe('已完成');
    expect(ARCHIVE_UI.queueDoneMark).toBe('✓');
  });
});

describe('FIELD_MAP_UI', () => {
  it('共同欄位映射介面字串存在且非空', () => {
    for (const [key, value] of Object.entries(FIELD_MAP_UI)) expect(value.length).withContext(key).toBeGreaterThan(0);
    expect(FIELD_MAP_UI.validate).toBe('驗證並預覽');
    expect(FIELD_MAP_UI.confirm).toBe('確認匯入');
  });

  it('R7 §6.1：移除 valueTrue／valueFalse／valueNull，加入／取代預覽字串', () => {
    const keys = Object.keys(FIELD_MAP_UI);
    for (const removed of ['valueTrue', 'valueFalse', 'valueNull']) expect(keys).not.toContain(removed);
    expect({
      blankLegend: FIELD_MAP_UI.blankLegend,
      previewHeading: FIELD_MAP_UI.previewHeading,
      rowCountLabel: FIELD_MAP_UI.rowCountLabel,
      affectedLabel: FIELD_MAP_UI.affectedLabel,
      policyHandledLabel: FIELD_MAP_UI.policyHandledLabel,
      codeSampleLabel: FIELD_MAP_UI.codeSampleLabel,
      excluded: FIELD_MAP_UI.excluded,
      notExcluded: FIELD_MAP_UI.notExcluded,
      pendingReview: FIELD_MAP_UI.pendingReview,
    }).toEqual({
      blankLegend: '來源的「異議回覆」為空白時',
      previewHeading: '匯入預覽',
      rowCountLabel: '總列數',
      affectedLabel: '空白資料',
      policyHandledLabel: '依本次規則處理',
      codeSampleLabel: '人員編號樣本',
      excluded: '排除',
      notExcluded: '未排除',
      pendingReview: '待確認',
    });
  });
});

describe('RECORD_STATUS 與 SOURCE_CARD（R7 §6.1）', () => {
  it('recordStatus 逐字', () => {
    expect(RECORD_STATUS).toEqual({
      notApplicable: '不適用',
      missing: '未提供',
      refused: '已拒絕',
      notRefused: '未拒絕',
      unconfirmed: '未確認',
      defaultedNotRefused: '未拒絕（依規則補登）',
      sourceNotRefused: '未拒絕（來源資料）',
      sourceRefused: '已拒絕（來源資料）',
    });
  });

  it('SOURCE_CARD 只剩標籤與安排項目（R12）；refusalNA／Null／True 已移除', () => {
    expect(Object.keys(SOURCE_CARD).sort()).toEqual([
      'arrangement',
      'arrangementValue',
      'code',
      'eyebrow',
      'name',
      'nameUnregistered',
      'refusal',
    ]);
    expect(SOURCE_CARD.eyebrow('B102')).toBe('SOURCE / B102');
    expect([SOURCE_CARD.name, SOURCE_CARD.code, SOURCE_CARD.refusal]).toEqual(['姓名', '人員編號', '拒絕紀錄']);
    expect([SOURCE_CARD.arrangement, SOURCE_CARD.arrangementValue]).toEqual(['安排項目', '後續聯繫安排']);
  });

  it('資料檔中玩家可見的字串沒有獨立的 true／false／null（note 除外）', () => {
    const hits: string[] = [];
    const walk = (file: string, node: unknown, path: string): void => {
      if (typeof node === 'string') {
        if (/\b(true|false|null)\b/i.test(node)) hits.push(`${file} ${path}：${node}`);
      } else if (Array.isArray(node)) node.forEach((v, i) => walk(file, v, `${path}[${i}]`));
      else if (typeof node === 'object' && node !== null) {
        for (const [k, v] of Object.entries(node)) if (k !== 'note') walk(file, v, `${path}.${k}`);
      }
    };
    const { ui, actors, channels, bulletins, days } = CONTENT_SOURCES;
    for (const src of [ui, actors, channels, bulletins, ...days]) walk(src.file, src.data, '');
    expect(hits).toEqual([]);
  });
});

describe('progressLabel（封面進度，R6-02）', () => {
  it('morning（次日收件，R8）用新的一日的日名', () => {
    expect(progressLabel(2, 'morning', 6)).toBe('第二日收件');
    expect(progressLabel(6, 'morning', 6)).toBe('第六日收件');
  });

  it('work／wrap／end 由日序與 stage 產生', () => {
    expect(progressLabel(1, 'work', 6)).toBe('第一日');
    expect(progressLabel(3, 'work', 6)).toBe('第三日');
    expect(progressLabel(1, 'wrap', 6)).toBe('第一日交接完成');
    expect(progressLabel(2, 'wrap', 6)).toBe('第二日交接完成');
    expect(progressLabel(5, 'wrap', 6)).toBe('第五日交接完成');
    expect(progressLabel(6, 'end', 6)).toBe('六日試玩完成');
  });

  it('Day 3–6 不會顯示「第二」', () => {
    for (const n of [3, 4, 5, 6]) {
      for (const stage of ['work', 'wrap', 'morning'] as const) expect(progressLabel(n, stage, 6)).not.toContain('二');
    }
  });
});

describe('transitionCount 依筆數補零', () => {
  it('個位數補零到兩位、兩位數以上照原樣', () => {
    expect(transitionCount(0)).toBe('00');
    expect(transitionCount(3)).toBe('03');
    expect(transitionCount(8)).toBe('08');
    expect(transitionCount(12)).toBe('12');
    expect(transitionCount(120)).toBe('120');
  });
});

describe('WORKBENCH 日名與樣板', () => {
  it('docTitle 用 ui.workbench.dayName 的國字日名', () => {
    expect(WORKBENCH.docTitle(1, 'work')).toBe('第一日 — 工作');
    expect(WORKBENCH.docTitle(2, 'messages')).toBe('第二日 — 通訊');
    expect(WORKBENCH.docTitle(6, 'news')).toBe('第六日 — 公告');
    expect(WORKBENCH.docTitle(4, 'mail')).toBe('第四日 — 郵件');
    expect(WORKBENCH.dayTag(2)).toBe('DAY / 02');
    expect(WORKBENCH.dayTag(6)).toBe('DAY / 06');
  });

  it('Day 1–6 都有國字日名', () => {
    expect([1, 2, 3, 4, 5, 6].map(dayName)).toEqual(['一', '二', '三', '四', '五', '六']);
  });

  it('WORKBENCH 不再有日別的 heading.work／greeting；R12 起 heading 只剩公告頁', () => {
    expect(Object.keys(WORKBENCH.heading)).toEqual(['news']);
    expect(Object.keys(WORKBENCH)).not.toContain('greeting');
  });
});

describe('text.ts 不綁日別（R6-01）', () => {
  it('舊的日別物件已移除', () => {
    const keys = Object.keys(text);
    for (const removed of ['DAY1', 'DAY2', 'OVERNIGHT', 'END', 'PHASE_LABEL', 'DAY3', 'DAY4', 'DAY5', 'DAY6']) {
      expect(keys).not.toContain(removed);
    }
    expect(Object.keys(text.ASIDE)).not.toContain('heading');
    expect(Object.keys(text.ASIDE)).not.toContain('body');
  });
});

describe('MESSAGES 只剩介面字串（KB-R5-02 第 6 點、R7 §6.1）', () => {
  it('舊的單一對話轉接與 R7 移除的 eyebrow／back 都不在', () => {
    const keys = Object.keys(MESSAGES);
    for (const removed of ['author', 'time', 'day1', 'day2Lead', 'day2SmallTalk', 'eyebrow', 'back']) {
      expect(keys).not.toContain(removed);
    }
  });

  it('通訊軟體外殼、header 與固定回覆的字串', () => {
    expect({
      workspace: MESSAGES.workspace,
      listLabel: MESSAGES.listLabel,
      backToList: MESSAGES.backToList,
      sectionTitle: MESSAGES.sectionTitle,
      sectionEmpty: MESSAGES.sectionEmpty,
      selectHeading: MESSAGES.selectHeading,
      selectPrompt: MESSAGES.selectPrompt,
      emptyChannel: MESSAGES.emptyChannel,
      online: MESSAGES.online,
      you: MESSAGES.you,
      quickReplyHeading: MESSAGES.quickReplyHeading,
      skipReply: MESSAGES.skipReply,
    }).toEqual({
      workspace: '柯迪巴特通訊',
      listLabel: '頻道與私訊',
      backToList: '返回頻道列表',
      sectionTitle: { department: '部門頻道', group: '群組', direct: '私訊' },
      sectionEmpty: '目前沒有對話',
      selectHeading: '選擇一個對話',
      selectPrompt: '從左側開啟頻道或私訊。',
      emptyChannel: '目前沒有訊息。',
      online: '在線',
      you: '你',
      quickReplyHeading: '選擇回覆',
      skipReply: '不回覆',
    });
  });

  it('成員數依數量代入', () => {
    expect(MESSAGES.memberCount(3)).toBe('3 位成員');
    expect(MESSAGES.memberCount(12)).toBe('12 位成員');
  });

  it('未讀文字依數量代入', () => {
    expect(MESSAGES.unread(3)).toBe('3 則未讀訊息');
    expect(MESSAGES.unreadChannel('林予安', 2)).toBe('林予安：2 則未讀訊息');
  });
});

describe('recordLabel', () => {
  it('有姓名顯示姓名，沒有則顯示人員編號', () => {
    expect(recordLabel({ key: 'X', name: '林予安', code: 'H-17', refusal: null, refusalApplies: false })).toBe('林予安');
    expect(recordLabel({ key: 'Y', name: null, code: '0102', refusal: null, refusalApplies: true })).toBe('0102');
  });
});

describe('同日多工作、日結與次日收件（R8 §1–2）', () => {
  it('TASKS_UI 逐字：步驟、狀態與交付按鈕', () => {
    expect(TASKS_UI).toEqual({
      listLabel: '今日工作項目',
      stepTemplate: '第 {index} / {total} 項',
      statusDone: '已完成',
      statusActive: '進行中',
      statusPending: '待處理',
      statusWaived: '不適用',
      deliver: '交付此項工作',
      finishDay: '完成今日交接',
      kind: { archive: '歸檔', reconcile: '核對', 'field-map': '匯入', 'return-review': '複審' },
      unit: { archive: '筆', reconcile: '筆', 'field-map': '列', 'return-review': '筆' },
    });
  });

  it('stepLabel 以 1 起算；deliverLabel 只在最後一項用「完成今日交接」', () => {
    expect(stepLabel(1, 2)).toBe('第 1 / 2 項');
    expect(stepLabel(2, 2)).toBe('第 2 / 2 項');
    expect(stepLabel(3, 4)).toBe('第 3 / 4 項');
    expect(deliverLabel(false)).toBe('交付此項工作');
    expect(deliverLabel(true)).toBe('完成今日交接');
  });

  it('舊檔免補的狀態不宣稱已提交', () => {
    expect(TASKS_UI.statusWaived).not.toMatch(/完成|提交|交付|歸檔/);
  });

  it('種類的業務動詞與單位', () => {
    expect(['archive', 'reconcile', 'field-map'].map((k) => taskKindLabel(k as 'archive'))).toEqual(['歸檔', '核對', '匯入']);
    expect(taskUnit('field-map')).toBe('列');
    expect(taskUnit('reconcile')).toBe('筆');
  });

  it('日結頁：總數是「項工作」，每項各自的筆數／列數', () => {
    expect(totalTasks(2)).toBe('共 2 項工作');
    expect(handoffItem('archive', 3)).toBe('歸檔 3 筆');
    expect(handoffItem('reconcile', 2)).toBe('核對 2 筆');
    expect(handoffItem('field-map', 8)).toBe('匯入 8 列');
    expect(handoffItem('return-review', 1)).toBe('複審 1 筆');
    expect(HANDOFF_UI.next).toBe('結束今日，查看明日收件');
    expect(HANDOFF_UI.heading).toBe('本日交接');
  });

  it('次日收件：待處理數、開始按鈕與分頁標題', () => {
    expect(morningPending('archive', 4)).toBe('待處理 4 筆');
    expect(morningPending('field-map', 8)).toBe('待處理 8 列');
    expect(morningPending('return-review', 2)).toBe('待處理 2 筆');
    expect(MORNING_UI.start).toBe('開始今日工作');
    expect(morningDocTitle(2)).toBe('第二日 — 收件');
    expect(morningDocTitle(3)).not.toContain('{');
  });
});

describe('EXECUTION_LOG_UI（系統作業紀錄，R8 §3）', () => {
  it('標題、空狀態與值文字', () => {
    expect(EXECUTION_LOG_UI.heading).toBe('系統作業紀錄');
    expect(EXECUTION_LOG_UI.empty).toBe('等待作業輸入');
    expect(EXECUTION_LOG_UI.check.pass).toBe('通過');
    expect(EXECUTION_LOG_UI.result.delivered).toBe('已交付');
    expect(EXECUTION_LOG_UI.result.sentReview).toBe('送覆核');
  });

  it('資料去向與空白處理沿用 ui.archive／ui.fieldMap，不另存一份', () => {
    expect(EXECUTION_LOG_UI.destination).toEqual({ archive: ARCHIVE_UI.destinationArchive, review: ARCHIVE_UI.destinationReview });
    expect(EXECUTION_LOG_UI.destination.review).toBe('資料覆核佇列');
    expect(EXECUTION_LOG_UI.blank).toEqual({ default: FIELD_MAP_UI.notExcluded, review: FIELD_MAP_UI.pendingReview });
  });

  it('指令與鍵名來自資料檔；範例格式可由這些字組出', () => {
    const { prompt, command, key, check, destination, result } = EXECUTION_LOG_UI;
    expect(`${prompt} ${command.archive} 0102`).toBe('$ archive.submit 0102');
    expect(JSON.stringify({ [key.check]: check.pass, [key.personnelId]: '0102', [key.destination]: destination.review })).toBe(
      '{"check":"通過","personnelId":"0102","destination":"資料覆核佇列"}',
    );
    expect(`${prompt} ${command.handoff}`).toBe('$ task.handoff');
    expect(JSON.stringify({ [key.result]: result.delivered, [key.items]: 3 })).toBe('{"result":"已交付","items":3}');
  });

  it('不含夜間判定或「已獲安排」之類的判斷字', () => {
    const all = JSON.stringify(EXECUTION_LOG_UI);
    for (const banned of ['夜間', '安排', '介入', 'intervention', 'origin', '正確']) expect(all).not.toContain(banned);
  });
});

describe('比對案件與視窗殼的共用字（R9）', () => {
  it('CASE_REVIEW_UI 來自 ui.caseReview；說明為中性功能文字', () => {
    expect(text.CASE_REVIEW_UI).toEqual((CONTENT_SOURCES.ui.data as { caseReview: unknown }).caseReview as typeof text.CASE_REVIEW_UI);
    expect(text.CASE_REVIEW_UI.instruction).toBe('兩份來源的人員編號不同，請選擇處理方式並保留依據。');
    expect(text.CASE_REVIEW_UI.destination).toEqual({ archive: '正式歸檔', review: '窗口待查' });
    expect(text.caseMarkedCount(2)).toBe('已標記 2 處差異');
  });

  it('WINDOW_SHELL_UI：只剩紀錄窗的歷史切換（R12 移除停靠／展開／收合／關閉／重新開啟與切換列）', () => {
    expect(text.WINDOW_SHELL_UI).toEqual({ history: { show: '顯示較早紀錄', hide: '收合' } });
  });

  it('系統作業紀錄：案件的依據與註記鍵名、案件去向沿用 ui.caseReview（窗口待查 ≠ 資料覆核佇列）', () => {
    const { prompt, command, key, check, caseDestination } = EXECUTION_LOG_UI;
    expect(caseDestination).toEqual(text.CASE_REVIEW_UI.destination);
    expect(caseDestination.review).not.toBe(EXECUTION_LOG_UI.destination.review);
    expect(`${prompt} ${command.archive} H-205`).toBe('$ archive.submit H-205');
    expect(
      JSON.stringify({
        [key.check]: check.pass,
        [key.personnelId]: 'H-205',
        [key.destination]: caseDestination.archive,
        [key.basis]: '補件資料',
        [key.note]: '原表與補件編號不同；採用補件，保留原表。',
      }),
    ).toBe('{"check":"通過","personnelId":"H-205","destination":"正式歸檔","basis":"補件資料","note":"原表與補件編號不同；採用補件，保留原表。"}');
  });

  it('不含 true／false／null、seed、夜間判定或「正確答案／推薦」之類的判斷字', () => {
    const all = JSON.stringify([text.CASE_REVIEW_UI, text.WINDOW_SHELL_UI, EXECUTION_LOG_UI]);
    for (const banned of ['true', 'false', 'null', 'seed', '夜間', '介入', '正確', '正解', '答案', '推薦', '建議', '錯誤', '真相']) {
      expect(all).withContext(banned).not.toContain(banned);
    }
  });
});

describe('歸檔與欄位映射：編號只驗型別、錯配只說無法轉換（R10 §4–5）', () => {
  it('ARCHIVE_UI 沒有 codeMismatch 或「必須與來源一致」之類的提示；R11 起也沒有來源編號帶入（useCode）', () => {
    expect(Object.keys(ARCHIVE_UI)).not.toContain('codeMismatch');
    expect(Object.keys(ARCHIVE_UI)).not.toContain('useCode');
    for (const [key, value] of Object.entries(ARCHIVE_UI)) {
      for (const banned of ['不一致', '不符', '必須與來源', '需與來源', '請改成', '錯誤']) {
        expect(value).withContext(`${key} ${banned}`).not.toContain(banned);
      }
    }
  });

  it('FIELD_MAP_UI.convertError 是中性的無法轉換提示，不指定哪個配對才對', () => {
    expect(FIELD_MAP_UI.convertError).toBe('部分來源值無法轉換成目標欄位的格式，請檢查欄位對應。');
    for (const banned of ['正確', '正解', '應對應', '錯誤', 'null', 'true', 'false']) {
      expect(FIELD_MAP_UI.convertError).withContext(banned).not.toContain(banned);
    }
  });
});

describe('操作流程、浮動視窗、逐筆審查與退件複審的共用字（R10）', () => {
  const R10_JSON_UI = {
    recordReview: { heading: '逐筆審查', release: '核對後放行', hold: '保留待查' },
    returnedReview: {
      heading: '退件複審',
      instruction: '請核對退件原因與歷次送件資料，填寫本次處理結果。',
      source: '原始來源',
      firstSubmission: '第一次送件',
      reviewRecord: '第二輪審查紀錄',
      reason: '退件原因',
      codeMismatch: '送件的人員編號與隨附原表不一致，請核對後重新送審。',
      resubmit: '重新送審',
      sendToWindow: '註記並送窗口待查',
      resubmitted: '已重新送審',
      pendingWindow: '等待窗口確認',
    },
  };

  it('RETURNED_REVIEW_UI 逐字等於 R10-return-review.json 的 ui.returnedReview', () => {
    expect(text.RETURNED_REVIEW_UI).toEqual(R10_JSON_UI.returnedReview);
  });

  it('RECORD_REVIEW_UI：JSON 的 heading／release／hold 逐字，另加狀態與送出前提示', () => {
    const r = text.RECORD_REVIEW_UI;
    expect({ heading: r.heading, release: r.release, hold: r.hold }).toEqual(R10_JSON_UI.recordReview);
    expect(r).toEqual({
      ...R10_JSON_UI.recordReview,
      listLabel: '逐筆審查清單',
      statusPending: '尚未審查',
      statusReleased: '已放行',
      statusHeld: '已保留待查',
      requiredNotice: '請先完成每筆資料的審查處置，再送出本日回覆。',
    });
  });

  it('OPERATION_UI：階段文字逐字；格式檢查通過不宣稱內容正確，已保存只在持久化後', () => {
    expect(text.OPERATION_UI).toEqual({
      ariaLabel: '作業執行狀態',
      received: '已接收提交',
      validating: '格式檢查中',
      validated: '格式檢查通過',
      processing: '資料處理中',
      saving: '保存中',
      done: '已保存',
      failed: '保存失敗',
      failedHint: '本次提交尚未保存，可重新嘗試。',
      rejectedHint: '狀態已變更，本次提交沒有套用；請確認目前的狀態後再處理。',
      retry: '重試',
      busy: '作業處理中，請稍候',
    });
  });

  it('WINDOWS_UI：最小化／最大化／還原／關閉、視窗列；重設視窗位置改在桌面主選單（R12）', () => {
    expect(text.WINDOWS_UI).toEqual({
      minimize: '最小化',
      maximize: '最大化',
      restore: '還原',
      close: '關閉',
      taskbarLabel: '視窗列',
      openLog: '開啟系統作業紀錄',
      documentsLabel: '文件',
      moveHint: '標題列取得焦點時，可用方向鍵移動視窗。',
    });
  });

  it('比對案件：可編輯編號的標籤；R11 移除「帶入{heading}」按鈕與 useDocumentLabel', () => {
    expect(text.CASE_REVIEW_UI.codeInputLabel).toBe('歸檔人員編號');
    expect(Object.keys(text.CASE_REVIEW_UI)).not.toContain('useDocumentTemplate');
    expect(Object.keys(text)).not.toContain('useDocumentLabel');
  });

  it('taskHeading：一般任務取 text.heading；return-review（內容定義或虛擬 issueTaskId(n)）取 ui.documentIssues.taskHeading（R11）', () => {
    expect(taskHeading('task.day1.archive')).toBe('人員資料歸檔');
    expect(taskHeading('task.day2.reconcile')).toBe('核對昨日批次摘要');
    expect(taskHeading('task.day6.field-map')).toBe('服務銜接表欄位轉換');
    expect(taskHeading('task.day4.return-review')).toBe('錯誤文件處理');
    expect(taskHeading('task.day4.return-review')).toBe(text.DOCUMENT_ISSUES_UI.taskHeading);
    expect(taskHeading(issueTaskId(5))).toBe('錯誤文件處理');
    expect(taskHeading('task.day1.return-review')).toBe('錯誤文件處理');
    expect(() => taskHeading('task.day9.nope')).toThrowError(/task\.day9\.nope/);
    expect(() => taskHeading('task.day9.return-review')).toThrowError(/task\.day9\.return-review/);
  });

  it('系統作業紀錄：退件複審的指令名來自資料檔', () => {
    const { prompt, command } = EXECUTION_LOG_UI;
    expect(`${prompt} ${command.returnReview} B102`).toBe('$ return.submit B102');
  });

  it('系統作業紀錄：逐筆審查有專用指令名與 source 鍵（不再借用 check）', () => {
    const { prompt, command, key } = EXECUTION_LOG_UI;
    expect(command.recordReview).toBe('review.record');
    expect(command.recordReview).not.toBe(key.check);
    expect(`${prompt} ${command.recordReview} 102`).toBe('$ review.record 102');
    expect(
      JSON.stringify({ [key.personnelId]: '102', [key.source]: '0102', [key.result]: text.RECORD_REVIEW_UI.release }),
    ).toBe('{"personnelId":"102","source":"0102","result":"核對後放行"}');
  });

  it('新增的功能字不含 true／false／null、seed、夜間判定或「正確答案／推薦」之類的判斷字', () => {
    const all = JSON.stringify([text.OPERATION_UI, text.WINDOWS_UI, text.RECORD_REVIEW_UI, text.RETURNED_REVIEW_UI, FIELD_MAP_UI.convertError]);
    for (const banned of ['true', 'false', 'null', 'seed', '夜間', '介入', '正確', '正解', '答案', '推薦', '建議', '錯誤', '真相']) {
      expect(all).withContext(banned).not.toContain(banned);
    }
  });
});

describe('文件問題與錯誤文件處理的共用字（R11）', () => {
  const ui = (CONTENT_SOURCES.ui.data as { documentIssues: typeof text.DOCUMENT_ISSUES_UI }).documentIssues;

  it('DOCUMENT_ISSUES_UI 來自 ui.documentIssues；狀態、區段逐字；R12 移除「文件問題」頁專用的字', () => {
    const d = text.DOCUMENT_ISSUES_UI;
    expect(d).toEqual(ui);
    expect(Object.keys(d)).toEqual([
      'status',
      'next',
      'submissionTemplate',
      'sourceTaskTemplate',
      'sections',
      'outcome',
      'receipts',
      'close',
      'taskEyebrow',
      'taskHeading',
      'taskInstruction',
      'task',
    ]);
    expect(d.status).toEqual({ pending: '待修正', awaitingCheck: '已重送／待核對', awaitingWindow: '待窗口回覆', resolved: '已解決' });
    expect(d.sections).toEqual({ original: '原件', versions: '歷次修改', reviewRecord: '第二輪審查紀錄' });
    expect(Object.keys(d.receipts)).toEqual(['returnedTemplate', 'resolvedTemplate', 'codeLabel', 'resolvedNote']);
    expect(d.close).toBe('返回清單');
    expect(d.taskHeading).toBe('錯誤文件處理');
  });

  it('issueStatusLabel：core 狀態值（含連字號）對應到介面文字', () => {
    expect(text.issueStatusLabel('pending')).toBe('待修正');
    expect(text.issueStatusLabel('awaiting-check')).toBe('已重送／待核對');
    expect(text.issueStatusLabel('awaiting-window')).toBe('待窗口回覆');
    expect(text.issueStatusLabel('resolved')).toBe('已解決');
  });

  it('送窗口待查的版本狀態；R12 移除下次處理日與退回次數的格式器', () => {
    expect(text.DOCUMENT_ISSUES_UI.next).toEqual({ windowWaiting: '等待窗口回覆' });
    for (const removed of ['issueDueLabel', 'issueCheckLabel', 'issueReturnCount']) {
      expect(Object.keys(text)).withContext(removed).not.toContain(removed);
    }
  });

  it('第幾次送件、來源工作', () => {
    expect(text.issueSubmissionLabel(1)).toBe('第 1 次送件');
    expect(text.issueSubmissionLabel(2)).toBe('第 2 次送件');
    expect(text.issueSourceTaskLabel(1, taskHeading('task.day1.archive'))).toBe('第一日 · 人員資料歸檔');
  });

  it('退件原因沿用 ui.returnedReview.codeMismatch（不另存一份）', () => {
    expect(text.issueReasonText('code-mismatch')).toBe(text.RETURNED_REVIEW_UI.codeMismatch);
    expect(Object.keys(text.DOCUMENT_ISSUES_UI)).not.toContain('reason');
  });

  it('案號：依稽核的 caseNumberTemplate 代入存檔 key（前導零保留）；未知稽核退回 key', () => {
    expect(text.caseNumber('day1-code-audit', 'B102')).toBe('RT-B102');
    expect(text.caseNumber('day1-code-audit', '0102')).toBe('RT-0102');
    expect(text.caseNumber('day9-retired', 'B102')).toBe('B102');
  });

  it('回條標題；R12 移除回條發出日與未讀／待處理件數的格式器', () => {
    const no = text.caseNumber('day1-code-audit', 'B102');
    expect(text.receiptLabel('returned', no)).toBe('退件回條：RT-B102');
    expect(text.receiptLabel('resolved', no)).toBe('收件回條：RT-B102');
    for (const removed of ['receiptIssuedLabel', 'issueUnreadCount', 'issuePendingCount']) {
      expect(Object.keys(text)).withContext(removed).not.toContain(removed);
    }
  });

  it('中性功能文字：不含 true／false／null、seed、夜間判定或「正確答案／推薦」之類的判斷字（任務標題「錯誤文件處理」是交辦指定名稱）', () => {
    const { taskHeading: _named, ...rest } = text.DOCUMENT_ISSUES_UI;
    const all = JSON.stringify([rest, text.WORKBENCH.nav.mail, text.WORKBENCH.team]);
    for (const banned of ['true', 'false', 'null', 'seed', '夜間', '介入', '正確', '正解', '答案', '推薦', '建議', '錯誤', '真相', '來源編號']) {
      expect(all).withContext(banned).not.toContain(banned);
    }
  });

  it('重送不等於已解決：已解決只出現在收件回條／已結案，已重送狀態寫明待核對', () => {
    expect(text.DOCUMENT_ISSUES_UI.status.awaitingCheck).toContain('待核對');
    expect(text.DOCUMENT_ISSUES_UI.status.awaitingWindow).not.toContain('解決');
    expect(text.DOCUMENT_ISSUES_UI.receipts.resolvedNote).toContain('結案');
  });
});

/* ---------- R12：桌面、工作平台、郵件、入職與詢問 ---------- */

describe('R12 桌面與工作平台的介面字', () => {
  it('DESKTOP_UI：三個應用入口、主選單三個選項、狀態區與分頁標題', () => {
    expect(text.DESKTOP_UI.apps).toEqual({ work: '工作平台', messages: '通訊', mail: '郵件' });
    expect(text.DESKTOP_UI.menu).toEqual({
      button: '主選單',
      label: '主選單',
      backToCover: '返回開始頁',
      motion: '動態效果',
      resetLayout: '重設視窗位置',
    });
    expect(text.DESKTOP_UI.label).toBe('桌面');
    expect(text.DESKTOP_UI.appsLabel).toBe('桌面應用');
    expect(text.DESKTOP_UI.statusLabel).toBe('系統狀態');
    expect(text.pageTitle(text.DESKTOP_UI.docTitle)).toBe('桌面 · 錯誤世界');
  });

  it('desktopOpenApp／mailUnreadCount 代入樣板', () => {
    expect(text.desktopOpenApp(text.DESKTOP_UI.apps.mail)).toBe('開啟郵件');
    expect(text.desktopOpenApp(text.DESKTOP_UI.apps.work)).toBe('開啟工作平台');
    expect(text.mailUnreadCount(2)).toBe('2 封未讀郵件');
    expect(text.mailUnreadCount(0)).toBe('0 封未讀郵件');
  });

  it('WORKBENCH：單組導航（工作、通訊、公告、郵件）、右上身分區組別；沒有雙 group 與「文件問題」', () => {
    expect(WORKBENCH.nav).toEqual({ work: '工作', messages: '通訊', news: '公告', mail: '郵件' });
    expect(WORKBENCH.team).toBe('資料作業組');
    expect(WORKBENCH.identityLabel).toBe('目前登入');
    expect(Object.keys(WORKBENCH)).not.toContain('navGroupPersonal');
    expect(Object.keys(WORKBENCH)).not.toContain('navGroupTeam');
    expect(Object.keys(WORKBENCH.nav)).not.toContain('issues');
    expect(Object.keys(WORKBENCH)).not.toContain('role');
    expect(Object.keys(WORKBENCH)).not.toContain('backToCover');
  });

  it('MESSAGES 的「跳到最新」提示；DOCUMENT_ISSUES_UI.task', () => {
    expect(MESSAGES.newBelow).toBe('有新訊息');
    expect(MESSAGES.newBelowAria).toBe('捲到最新訊息');
    expect(text.DOCUMENT_ISSUES_UI.task).toEqual({ openMail: '開啟最新郵件', handled: '已處理' });
    expect(text.DOCUMENT_ISSUES_UI.taskInstruction).not.toContain('「文件問題」');
  });
});

describe('R12 郵件的介面字與模板代入', () => {
  it('MAIL_UI 是退件回條包的 ui，mailSenderName 取寄件者名稱；未知包回傳 undefined', () => {
    expect(text.MAIL_UI.appName).toBe('郵件');
    expect(text.MAIL_UI.inbox).toBe('收件匣');
    expect(text.MAIL_UI.stale).toBe('此版本已不是目前待處理版本，請從最新郵件開啟文件。');
    expect(text.mailSenderName('mail.return-receipts')).toBe('資料作業窗口');
    expect(text.mailSenderName('mail.retired')).toBeUndefined();
  });

  it('mailVersionLabel：null＝原始送件；index n → 修訂 n+1', () => {
    expect(text.mailVersionLabel(null)).toBe('原始送件');
    expect(text.mailVersionLabel(0)).toBe('修訂 1');
    expect(text.mailVersionLabel(2)).toBe('修訂 3');
  });

  it('mailReasonText：code-mismatch 用郵件包的原因文字；null 為空字串', () => {
    expect(text.mailReasonText('code-mismatch')).toBe('送件的人員編號與隨附原表不一致。');
    expect(text.mailReasonText(null)).toBe('');
  });

  it('renderMailTemplate：代入退件郵件的主旨、內文與附件名', () => {
    const pack = text.MAIL_UI;
    const params = { caseNumber: 'RT-0102', versionLabel: text.mailVersionLabel(0), reason: text.mailReasonText('code-mismatch') };
    const tpl = CONTENT_SOURCES.mail[0].data as {
      templates: { returned: { subject: string; lines: string[]; attachmentLabel: string } };
    };
    expect(text.renderMailTemplate(tpl.templates.returned.subject, params)).toBe('文件退回｜RT-0102');
    expect(tpl.templates.returned.lines.map((l) => text.renderMailTemplate(l, params))).toEqual([
      '你好，這筆文件核對後仍需修正。',
      '案件：RT-0102',
      '核對版本：修訂 1',
      `退回原因：${pack.codeMismatch}`,
      '請從本信附件開啟文件，確認後重新送審；需要補查的項目也可以轉交窗口。',
    ]);
    expect(text.renderMailTemplate(tpl.templates.returned.attachmentLabel, params)).toBe('RT-0102｜修訂 1｜核對結果');
  });

  it('renderMailTemplate 是純字串取代：缺值代入空字串、非白名單 placeholder 原樣保留、值不再被解析', () => {
    expect(text.renderMailTemplate('{caseNumber}／{reason}', { caseNumber: 'RT-B102' })).toBe('RT-B102／');
    expect(text.renderMailTemplate('{caseNumber}{playerName}', { caseNumber: 'A' })).toBe('A{playerName}');
    expect(text.renderMailTemplate('{caseNumber}', { caseNumber: '<b>$&{reason}</b>', reason: 'x' })).toBe('<b>$&{reason}</b>');
  });
});

describe('R12 入職前情與詢問入口的介面字', () => {
  it('ONBOARDING_UI 與舊存檔顯示名', () => {
    expect(text.ONBOARDING_UI.continue).toBe('點擊畫面或按 Enter 繼續');
    expect(text.ONBOARDING_UI.saveFailed).toBe('簽名尚未保存，請再試一次。');
    expect(text.ONBOARDING_UI.legacyPlayerName).toBe('員工');
  });

  it('onboardingLoggingIn 代入角色名；名字中的大括號不再被代入', () => {
    expect(text.onboardingLoggingIn('王小明')).toBe('正在登入，王小明。');
    expect(text.onboardingLoggingIn('{playerName}')).toBe('正在登入，{playerName}。');
  });

  it('helpUi：第一次詢問與之後重看；未知提問回傳 undefined', () => {
    expect(text.helpUi('request.refusal-record')).toEqual({ ask: '這個欄位是什麼？', revisit: '查看予安的說明' });
    expect(text.helpUi('request.nobody')).toBeUndefined();
  });

  it('R12 介面字不含 true／false／null、seed 或內部 ID', () => {
    const all = JSON.stringify([
      text.DESKTOP_UI,
      text.MAIL_UI,
      text.ONBOARDING_UI,
      text.helpUi('request.refusal-record'),
      WORKBENCH.nav,
      WORKBENCH.team,
      WORKBENCH.identityLabel,
      MESSAGES.newBelow,
      MESSAGES.newBelowAria,
      text.DOCUMENT_ISSUES_UI.task,
    ]);
    for (const banned of ['true', 'false', 'null', 'seed', 'mail.', 'request.', 'sender.', 'receipt']) {
      expect(all).withContext(banned).not.toContain(banned);
    }
  });
});
