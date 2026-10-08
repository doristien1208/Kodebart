import { CONTENT_SOURCES } from './bundle';
import { ContentInput, issueTaskId } from './schema';
import {
  ContentIssue,
  assertContentValid,
  describeIssue,
  formatIssues,
  parseContent,
  validateContent,
} from './validate-content';

/**
 * KB-R4-03／KB-R5-02：內容驗證。
 * 正式資料必須通過；每一種錯誤都要被指出，且訊息要能指向來源檔、內容 ID 與完整欄位路徑。
 * 反例全部以正式資料的副本改壞一處產生，不是只拿正確 JSON 測。
 */

/* ---------- 測試用的可變副本 ---------- */

function clone(): ContentInput {
  return JSON.parse(JSON.stringify(CONTENT_SOURCES)) as ContentInput;
}

type Path = readonly (string | number)[];

function containerAt(root: unknown, path: Path): Record<string, unknown> {
  let cur: unknown = root;
  for (const part of path) cur = (cur as Record<string, unknown>)[String(part)];
  return cur as Record<string, unknown>;
}

function setAt(root: unknown, path: Path, value: unknown): void {
  containerAt(root, path.slice(0, -1))[String(path[path.length - 1])] = value;
}

function removeAt(root: unknown, path: Path): void {
  delete containerAt(root, path.slice(0, -1))[String(path[path.length - 1])];
}

function pushAt(root: unknown, path: Path, value: unknown): void {
  (containerAt(root, path) as unknown as unknown[]).push(value);
}

/** 改一處後回傳問題清單。 */
function issuesAfter(mutate: (input: ContentInput) => void): ContentIssue[] {
  const input = clone();
  mutate(input);
  return validateContent(input);
}

function messages(issues: readonly ContentIssue[]): string {
  return formatIssues(issues);
}

function fields(issues: readonly ContentIssue[]): string[] {
  return issues.map((i) => i.field);
}

const DAY1 = 0;
const DAY2 = 1;
const DAY3 = 2;
const DAY4 = 3;
const DAY6 = 5;

/** Day 6 field-map 任務在 JSON 中的路徑。 */
const FM = ['tasks', 0] as const;

describe('validateContent 正式資料', () => {
  it('目前的內容檔沒有任何問題', () => {
    const issues = validateContent(CONTENT_SOURCES);
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('assertContentValid 不丟例外', () => {
    expect(() => assertContentValid(CONTENT_SOURCES)).not.toThrow();
  });

  it('錯誤時 assertContentValid 會丟出含來源檔的例外', () => {
    const input = clone();
    setAt(input.days[DAY1].data, ['messages', 0, 'actorId'], 'actor.nobody');
    expect(() => assertContentValid(input)).toThrowError(/day-01\.json/);
  });
});

describe('parseContent（bundle 載入時的明確斷言）', () => {
  it('通過時回傳依 day 排序的內容，即使檔案順序相反', () => {
    const input = clone();
    input.days.reverse();
    const bundle = parseContent(input);
    expect(bundle.days.map((d) => d.id)).toEqual(['day.01', 'day.02', 'day.03', 'day.04', 'day.05', 'day.06']);
    expect(bundle.days[0].tasks[0].kind).toBe('archive');
  });

  it('有問題時 throw，且例外訊息含全部問題（不會只報第一個）', () => {
    const input = clone();
    removeAt(input.days[DAY2].data, ['tasks', 0, 'text', 'dialog', 'response', 'ask']);
    removeAt(input.days[DAY1].data, ['tasks', 0, 'text', 'heading']);
    let thrown: unknown = null;
    try {
      parseContent(input);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const text = (thrown as Error).message;
    expect(text).toContain('內容驗證失敗（2 項）');
    expect(text).toContain('data/days/day-02.json [task.day2.reconcile] tasks[0].text.dialog.response.ask：');
    expect(text).toContain('data/days/day-01.json [task.day1.archive] tasks[0].text.heading：');
  });
});

describe('validateContent 重複 ID', () => {
  it('跨檔重複的內容 ID 會被指出，並說明先前出現的檔案', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['messages', 0, 'id'], 'msg.day1.welcome'));
    const dup = issues.find((i) => i.message.includes('ID 重複'));
    expect(dup).toBeDefined();
    expect(dup?.id).toBe('msg.day1.welcome');
    expect(dup?.file).toBe('data/days/day-02.json');
    expect(dup?.message).toContain('day-01.json');
  });

  it('重複的存檔 key 會被指出（不同內容 ID 也不行）', () => {
    const issues = issuesAfter((input) =>
      pushAt(input.days[DAY2].data, ['records'], {
        id: 'record.dup',
        key: 'B102',
        name: null,
        code: '9999',
        refusal: null,
        refusalApplies: false,
      }),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('B102');
  });

  it('兩個 archive 任務不得共用同一個 batchId', () => {
    const issues = issuesAfter((input) => {
      const day1Task = containerAt(input.days[DAY1].data, ['tasks', 0]);
      const copy = JSON.parse(JSON.stringify(day1Task)) as Record<string, unknown>;
      copy['id'] = 'task.day2.archive-again';
      setAt(input.days[DAY2].data, ['tasks'], [copy]);
    });
    expect(issues.some((i) => i.field === 'tasks[0].batchId' && i.message.includes('ID 重複'))).toBeTrue();
  });
});

describe('validateContent 引用', () => {
  it('不存在的人物', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['messages', 0, 'actorId'], 'actor.nobody'));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toContain('找不到人物 actor.nobody');
    expect(describeIssue(issues[0])).toContain('msg.day1.welcome');
  });

  it('不存在的頻道', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY1].data, ['messages', 0, 'channelId'], 'channel.dm.nobody'),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('找不到頻道');
  });

  it('不存在的紀錄（跨日引用也會檢查）', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY2].data, ['documents', 0, 'recordIds', 0], 'record.does-not-exist'),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].file).toBe('data/days/day-02.json');
    expect(issues[0].message).toContain('找不到紀錄');
  });

  it('不存在的附件／文件', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY2].data, ['tasks', 0, 'documentIds', 1], 'doc.day2.missing'),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('找不到文件');
  });

  it('ui 的同事引用也要存在', () => {
    const issues = issuesAfter((input) => setAt(input.ui.data, ['aside', 'colleagueActorId'], 'actor.ghost'));
    expect(issues.length).toBe(1);
    expect(issues[0].file).toBe('data/ui.zh-Hant.json');
  });
});

describe('validateContent 日程：day 數字、day ID 與 nextDayId（KB-R5-02 第 3 點、KB-R5-03）', () => {
  it('day 數字與 day.NN 不一致', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['day'], 3));
    const mismatch = issues.find((i) => i.message.includes('不一致'));
    expect(mismatch).toBeDefined();
    expect(mismatch?.id).toBe('day.02');
    expect(mismatch?.field).toBe('day');
    expect(mismatch?.message).toContain('day 數字 3 與 ID day.02');
  });

  it('day ID 沒有前導零或不是兩位數字時是格式錯誤', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['id'], 'day.2'));
    expect(issues.some((i) => i.field === 'id' && i.message.includes('至少兩位數字'))).toBeTrue();
  });

  it('day 必須是整數且不重複', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['day'], 1));
    expect(issues.some((i) => i.field === 'day' && i.message.includes('已在'))).toBeTrue();
  });

  it('複製檔案只改 id／day 而沒改內容 ID 時，task／transition／document／message 都會被指出', () => {
    const issues = issuesAfter((input) => {
      setAt(input.days[DAY2].data, ['id'], 'day.07');
      setAt(input.days[DAY2].data, ['day'], 7);
      setAt(input.days[DAY1].data, ['nextDayId'], 'day.07');
      setAt(input.ui.data, ['workbench', 'dayName', '7'], '七');
    });
    const tokenIssues = issues.filter((i) => i.message.includes('`day7`'));
    expect(fields(tokenIssues)).toEqual(
      jasmine.arrayWithExactContents([
        'documents[0].id',
        'documents[1].id',
        'tasks[0].id',
        'tasks[1].id',
        'messages[0].id',
        'messages[1].id',
        'messages[2].id',
        'messages[3].id',
        'messages[3].replyPrompt.id',
        'messages[3].replyPrompt.choices[0].responses[0].id',
        'messages[3].replyPrompt.choices[1].responses[0].id',
        'transition.id',
      ]),
    );
    expect(tokenIssues.every((i) => i.file === 'data/days/day-02.json')).toBeTrue();
  });

  it('單一 task ID 不含所屬日識別', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'id'], 'task.archive'));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('task.archive');
    expect(issues[0].field).toBe('tasks[0].id');
    expect(issues[0].message).toContain('`day1`');
  });

  it('缺少 nextDayId', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY1].data, ['nextDayId']));
    expect(issues.some((i) => i.field === 'nextDayId' && i.message.includes('缺少必要欄位 nextDayId'))).toBeTrue();
  });

  it('nextDayId 指向不存在的日', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['nextDayId'], 'day.09'));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('day.01');
    expect(issues[0].field).toBe('nextDayId');
    expect(issues[0].message).toContain('找不到日別 day.09');
  });

  it('最後一日被指定 nextDayId 後，它的結束轉場也會被要求換成日結轉場的形狀', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY6].data, ['nextDayId'], 'day.09'));
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'nextDayId',
        'transition.text.summary',
        'transition.text.thanks',
        'transition.text.outro',
      ]),
    );
    expect(issues.find((i) => i.field === 'transition.text.outro')?.message).toContain('最後一日才用結束轉場');
  });

  it('nextDayId 指向自己', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['nextDayId'], 'day.01'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('不得指向自己');
  });

  it('nextDayId 型別錯誤（數字）', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['nextDayId'], 2));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('得到 number');
  });

  it('每一個存在的日別都要有 ui.workbench.dayName', () => {
    const issues = issuesAfter((input) => removeAt(input.ui.data, ['workbench', 'dayName', '2']));
    expect(issues.length).toBe(1);
    expect(issues[0].file).toBe('data/ui.zh-Hant.json');
    expect(issues[0].field).toBe('workbench.dayName.2');
  });
});

describe('validateContent 任務：每日至少一個、有序，依 kind 檢查批次欄位（R8）', () => {
  /** 深拷貝正式資料中的某個 task，改掉 id（與 archive 的 batchId）。 */
  const taskCopy = (input: ContentInput, day: number, index: number, id: string, batchId?: string): Record<string, unknown> => {
    const t = JSON.parse(JSON.stringify(containerAt(input.days[day].data, ['tasks', index]))) as Record<string, unknown>;
    t['id'] = id;
    if (batchId !== undefined) t['batchId'] = batchId;
    return t;
  };

  it('正式資料：Day 1 為 archive → archive、Day 2 為 reconcile → archive、Day 4 為 archive → return-review，其他各一項', () => {
    const plan = CONTENT_SOURCES.days.map((d) =>
      (d.data as { tasks: { id: string; kind: string }[] }).tasks.map((t) => `${t.kind}:${t.id}`),
    );
    expect(plan).toEqual([
      ['archive:task.day1.archive', 'archive:task.day1.archive-followup'],
      ['reconcile:task.day2.reconcile', 'archive:task.day2.archive'],
      ['archive:task.day3.archive'],
      ['archive:task.day4.archive', 'return-review:task.day4.return-review'],
      ['archive:task.day5.archive'],
      ['field-map:task.day6.field-map'],
    ]);
  });

  it('一天只有一項工作也合法（刪掉 Day 1 的第二批）', () => {
    const issues = issuesAfter((input) => {
      const tasks = containerAt(input.days[DAY1].data, ['tasks']) as unknown as unknown[];
      tasks.splice(1, 1);
    });
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('同一天混合多種 kind：archive → reconcile → field-map → archive', () => {
    const issues = issuesAfter((input) => {
      const day6 = taskCopy(input, DAY6, 0, 'task.day1.field-map');
      const reconcile = taskCopy(input, DAY2, 0, 'task.day1.reconcile');
      reconcile['sourceBatchId'] = 'batch.day01.archive';
      delete reconcile['returnAudit']; // 稽核 ID 全域唯一（R10），複製的核對不帶稽核
      const [first, second] = containerAt(input.days[DAY1].data, ['tasks']) as unknown as unknown[];
      setAt(input.days[DAY1].data, ['tasks'], [first, reconcile, day6, second]);
    });
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('同 kind 連續三次（archive × 3）只要 task／batch ID 各自唯一', () => {
    const ok = issuesAfter((input) =>
      pushAt(input.days[DAY1].data, ['tasks'], taskCopy(input, DAY1, 0, 'task.day1.archive-third', 'batch.day01.archive-third')),
    );
    expect(ok.length).withContext(messages(ok)).toBe(0);
  });

  it('同日重複的 task ID', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY1].data, ['tasks', 1, 'id'], 'task.day1.archive'),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[1].id');
    expect(issues[0].message).toContain('ID 重複');
  });

  it('跨日重複的 task ID', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['tasks', 1, 'id'], 'task.day1.archive-followup'));
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['tasks[1].id', 'tasks[1].id']));
    expect(issues.some((i) => i.message.includes('ID 重複，已在 data/days/day-01.json 使用'))).toBeTrue();
    expect(issues.some((i) => i.message.includes('`day2`'))).toBeTrue();
  });

  it('同日第二批沿用第一批的 batchId', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 1, 'batchId'], 'batch.day01.archive'));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('batch.day01.archive');
    expect(issues[0].field).toBe('tasks[1].batchId');
    expect(issues[0].message).toContain('ID 重複');
  });

  it('跨日沿用別日的 batchId', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['tasks', 1, 'batchId'], 'batch.day01.archive-followup'));
    expect(issues.length).toBe(1);
    expect(issues[0].file).toBe('data/days/day-02.json');
    expect(issues[0].field).toBe('tasks[1].batchId');
    expect(issues[0].message).toContain('已在 data/days/day-01.json 使用');
  });

  it('第二項工作的引用與 text 照同一套規則檢查（完整路徑指到 tasks[1]）', () => {
    const issues = issuesAfter((input) => {
      setAt(input.days[DAY2].data, ['tasks', 1, 'recordIds', 0], 'record.day2-h99');
      removeAt(input.days[DAY2].data, ['tasks', 1, 'text', 'heading']);
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['tasks[1].recordIds[0]', 'tasks[1].text.heading']));
    expect(issues.every((i) => i.id === 'task.day2.archive')).toBeTrue();
  });

  it('每日零個 task', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks'], []));
    expect(issues.some((i) => i.field === 'tasks' && i.message.includes('至少需要一個可執行任務，得到 0 個'))).toBeTrue();
  });

  it('archive 任務缺 batchId（Day 2 的 sourceBatchId 也因此找不到批次）', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY1].data, ['tasks', 0, 'batchId']));
    expect(issues.length).toBe(2);
    const missing = issues.find((i) => i.file === 'data/days/day-01.json');
    expect(missing?.field).toBe('tasks[0].batchId');
    expect(missing?.message).toContain('缺少 id');
    const dangling = issues.find((i) => i.file === 'data/days/day-02.json');
    expect(dangling?.field).toBe('tasks[0].sourceBatchId');
    expect(dangling?.message).toContain('找不到批次 batch.day01.archive');
  });

  it('batchId 必須用 batch. 前綴', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'batchId'], 'day01.archive'));
    expect(issues.some((i) => i.field === 'tasks[0].batchId' && i.message.includes('`batch.` 開頭'))).toBeTrue();
    // 同時讓 Day 2 的 sourceBatchId 找不到批次
    expect(issues.some((i) => i.field === 'tasks[0].sourceBatchId' && i.message.includes('找不到批次'))).toBeTrue();
  });

  it('archive 任務不可帶 sourceBatchId', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY1].data, ['tasks', 0, 'sourceBatchId'], 'batch.day01.archive'),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].sourceBatchId');
  });

  it('archive 任務的 recordIds 不得為空', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'recordIds'], []));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].recordIds');
    expect(issues[0].message).toContain('不得為空陣列');
  });

  it('reconcile 任務缺 sourceBatchId', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY2].data, ['tasks', 0, 'sourceBatchId']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('task.day2.reconcile');
    expect(issues[0].field).toBe('tasks[0].sourceBatchId');
    expect(issues[0].message).toContain('sourceBatchId');
  });

  it('reconcile 任務的 sourceBatchId 指向不存在的批次', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY2].data, ['tasks', 0, 'sourceBatchId'], 'batch.day09.archive'),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('找不到批次 batch.day09.archive');
  });

  it('reconcile 任務不可定義 batchId', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['tasks', 0, 'batchId'], 'batch.day02.x'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].batchId');
  });

  it('reconcile 任務的 documentIds 不得為空', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['tasks', 0, 'documentIds'], []));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].documentIds');
  });

  it('未知的 task kind', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'kind'], 'sort'));
    const kind = issues.find((i) => i.field === 'tasks[0].kind');
    expect(kind?.id).toBe('task.day1.archive');
    expect(kind?.message).toContain('archive／reconcile');
    // kind 不明就不會登記批次，Day 2 的 sourceBatchId 跟著找不到；不會再有其他噪音。
    expect(issues.length).toBe(2);
    expect(issues.some((i) => i.field === 'tasks[0].sourceBatchId' && i.message.includes('找不到批次'))).toBeTrue();
  });
});

describe('validateContent 文字區塊：依 kind 逐欄檢查（KB-R5-02 第 1、2 點）', () => {
  it('archive 任務缺 heading', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY1].data, ['tasks', 0, 'text', 'heading']));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-01.json [task.day1.archive] tasks[0].text.heading：缺少必要欄位或型別錯誤：需要 string，得到 undefined',
    );
  });

  it('archive 任務的字串欄位不得為空', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'text', 'instruction'], ''));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].text.instruction');
    expect(issues[0].message).toBe('不得為空字串');
  });

  it('archive 任務 text 只放日別文字：帶入共同介面字串會被擋下並指向 ui.archive（R6-01）', () => {
    const issues = issuesAfter((input) => {
      setAt(input.days[DAY3].data, ['tasks', 0, 'text', 'progressTemplate'], '{count} / {total} 已處理');
      setAt(input.days[DAY3].data, ['tasks', 0, 'text', 'queueLabel'], '本日資料佇列');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents(['tasks[0].text.progressTemplate', 'tasks[0].text.queueLabel']),
    );
    expect(issues.every((i) => i.id === 'task.day3.archive' && i.message.includes('ui.zh-Hant.json 的 archive'))).toBeTrue();
  });

  it('archive 任務 text 的其他多餘欄位也會被指出；note 例外', () => {
    const extra = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'text', 'subtitle'], '副標'));
    expect(extra.length).toBe(1);
    expect(extra[0].field).toBe('tasks[0].text.subtitle');
    expect(extra[0].message).toContain('不在此區塊 shape 內');
    const note = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'text', 'note'], '編輯備註'));
    expect(note.length).withContext(messages(note)).toBe(0);
  });

  it('ui.archive 缺共同欄位或為空字串', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['archive', 'confirm']);
      setAt(input.ui.data, ['archive', 'queueLabel'], '');
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['archive.confirm', 'archive.queueLabel']));
    expect(issues.every((i) => i.file === 'data/ui.zh-Hant.json')).toBeTrue();
  });

  it('ui.fieldMap 缺欄位', () => {
    const issues = issuesAfter((input) => removeAt(input.ui.data, ['fieldMap', 'policyRequired']));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('fieldMap.policyRequired');
  });

  it('ui.progressLabel 的樣板需要 {dayName}；舊的 phaseLabel 會被指出', () => {
    const tpl = issuesAfter((input) => setAt(input.ui.data, ['progressLabel', 'workTemplate'], '第{day}日'));
    expect(tpl.every((i) => i.field === 'progressLabel.workTemplate')).toBeTrue();
    expect(tpl.some((i) => i.message.includes('缺少必要的 placeholder {dayName}'))).toBeTrue();
    const legacy = issuesAfter((input) => setAt(input.ui.data, ['phaseLabel'], { day1: '第一日' }));
    expect(legacy.length).toBe(1);
    expect(legacy[0].field).toBe('phaseLabel');
    expect(legacy[0].message).toContain('progressLabel');
  });

  it('reconcile 任務缺 dialog.response.ask（完整欄位路徑）', () => {
    const issues = issuesAfter((input) =>
      removeAt(input.days[DAY2].data, ['tasks', 0, 'text', 'dialog', 'response', 'ask']),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].file).toBe('data/days/day-02.json');
    expect(issues[0].id).toBe('task.day2.reconcile');
    expect(issues[0].field).toBe('tasks[0].text.dialog.response.ask');
  });

  it('reconcile 任務缺 reply 選項 choices.review', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY2].data, ['tasks', 0, 'text', 'choices', 'review']));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].text.choices.review');
  });

  it('巢狀物件寫成字串是型別錯誤', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['tasks', 0, 'text', 'dialog'], '交接回覆'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].text.dialog');
    expect(issues[0].message).toContain('需要物件，得到 string');
  });

  it('巢狀物件寫成陣列是型別錯誤', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['tasks', 0, 'text', 'choices'], ['a', 'b', 'c']));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].text.choices');
    expect(issues[0].message).toContain('得到 array');
  });

  it('字串欄位寫成數字是型別錯誤', () => {
    const issues = issuesAfter((input) => setAt(input.ui.data, ['archive', 'queueDoneMark'], 1));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('archive.queueDoneMark');
    expect(issues[0].message).toContain('得到 number');
  });

  it('整個 text 不是物件', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'text'], null));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].text');
    expect(issues[0].message).toContain('得到 null');
  });

  it('report 文件缺 sourceOrigin.rules', () => {
    const issues = issuesAfter((input) =>
      removeAt(input.days[DAY2].data, ['documents', 0, 'text', 'sourceOrigin', 'rules']),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('doc.day2.summary');
    expect(issues[0].field).toBe('documents[0].text.sourceOrigin.rules');
  });

  it('receipt 文件缺 destArchive', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY2].data, ['documents', 1, 'text', 'destArchive']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('doc.day2.receipt');
    expect(issues[0].field).toBe('documents[1].text.destArchive');
  });

  it('文件 kind 寫錯時不會用錯的 shape 去檢查，只報 kind', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['documents', 1, 'kind'], 'report'));
    // receipt 的 text 以 report 的 shape 檢查會缺一堆欄位；這是故意的：kind 決定形狀。
    expect(issues.every((i) => i.field.startsWith('documents[1].text.'))).toBeTrue();
    expect(fields(issues)).toContain('documents[1].text.versionTemplate');
    const unknownKind = issuesAfter((input) => setAt(input.days[DAY2].data, ['documents', 1, 'kind'], 'memo'));
    expect(unknownKind.length).toBe(1);
    expect(unknownKind[0].field).toBe('documents[1].kind');
    expect(unknownKind[0].message).toContain('report／receipt');
  });

  it('文件的 recordIds 不得為空', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['documents', 0, 'recordIds'], []));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('documents[0].recordIds');
  });

  it('有下一日的轉場缺 heading', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY1].data, ['transition', 'text', 'heading']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('transition.day1.overnight');
    expect(issues[0].field).toBe('transition.text.heading');
  });

  it('Day 2 已改為日結轉場（接 Day 3）', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY2].data, ['transition', 'text', 'body']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('transition.day2.wrap');
    expect(issues[0].field).toBe('transition.text.body');
  });

  it('日結轉場殘留 countLabel／next 會被指出並指向 ui.handoff（R8）', () => {
    const issues = issuesAfter((input) => {
      setAt(input.days[DAY3].data, ['transition', 'text', 'countLabel'], '　筆資料已處理');
      setAt(input.days[DAY3].data, ['transition', 'text', 'next'], '前往第四天');
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['transition.text.countLabel', 'transition.text.next']));
    expect(issues.every((i) => i.id === 'transition.day3.wrap' && i.message.includes('ui.handoff'))).toBeTrue();
  });

  it('正式 Day 1–5 的日結轉場只有 docTitle／eyebrow／heading／body／backToCover', () => {
    for (const day of CONTENT_SOURCES.days.slice(0, 5)) {
      const text = containerAt(day.data, ['transition', 'text']);
      expect(Object.keys(text).sort()).withContext(day.file).toEqual(['backToCover', 'body', 'docTitle', 'eyebrow', 'heading']);
    }
  });

  it('reconcile 對話框殘留 dialog.finish 會被指出（完成按鈕改用 ui.tasks）', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['tasks', 0, 'text', 'dialog', 'finish'], '完成本日交接'));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('task.day2.reconcile');
    expect(issues[0].field).toBe('tasks[0].text.dialog.finish');
    expect(issues[0].message).toContain('ui.tasks');
  });

  it('最後一日的轉場缺 summary 與 outro', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.days[DAY6].data, ['transition', 'text', 'summary']);
      removeAt(input.days[DAY6].data, ['transition', 'text', 'outro']);
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['transition.text.summary', 'transition.text.outro']));
    expect(issues.every((i) => i.id === 'transition.day6.end')).toBeTrue();
  });

  it('結束轉場殘留已移除的 outcome 會被指出（task-neutral，R6-02）', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY6].data, ['transition', 'text', 'outcome'], { ack: 'a', ask: 'b', review: 'c' }),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('transition.text.outcome');
    expect(issues[0].message).toContain('summary');
  });

  it('舊形狀的結束轉場（有 outcome、沒有 summary）兩項都會被指出', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.days[DAY6].data, ['transition', 'text', 'summary']);
      setAt(input.days[DAY6].data, ['transition', 'text', 'outcome'], { ack: 'a', ask: 'b', review: 'c' });
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['transition.text.summary', 'transition.text.outcome']));
  });

  it('把 Day 1 改成最後一日（nextDayId: null）後，它的轉場會以結束轉場的形狀檢查', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['nextDayId'], null));
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents(['transition.text.summary', 'transition.text.thanks', 'transition.text.outro']),
    );
  });

  it('每日頂層文字缺欄位', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY1].data, ['workbench', 'greeting']));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('workbench.greeting');
    expect(issues[0].id).toBe('day.01');
  });
});

describe('validateContent 訊息：visibleFrom 與已停用的條件（KB-R5-01）', () => {
  it('缺 visibleFrom', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY1].data, ['messages', 0, 'visibleFrom']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('msg.day1.welcome');
    expect(issues[0].field).toBe('messages[0].visibleFrom');
    expect(issues[0].message).toContain('缺少必要欄位 visibleFrom');
  });

  it('visibleFrom 指向不存在的日', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['messages', 0, 'visibleFrom'], 'day.07'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('messages[0].visibleFrom');
    expect(issues[0].message).toContain('找不到日別 day.07');
  });

  it('visibleFrom 型別錯誤', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['messages', 0, 'visibleFrom'], 2));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('得到 number');
  });

  it('unlock 殘留 cond.day.* 會被指出並提示改用 visibleFrom', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['messages', 0, 'unlock'], ['cond.day.1']));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('messages[0].unlock[0]');
    expect(issues[0].message).toContain('已停用');
    expect(issues[0].message).toContain('visibleFrom');
  });

  it('unlock 殘留 cond.phase.* 會被指出並提示改用 cond.stage.*', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY2].data, ['messages', 0, 'unlock'], ['cond.phase.day2']),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('cond.stage');
  });

  it('未知條件 ID', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['messages', 0, 'unlock'], ['cond.nope']));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('未知的條件 ID');
  });

  it('白名單內的 stage 條件通過', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY1].data, ['messages', 0, 'unlock'], ['cond.stage.work', 'cond.always']),
    );
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('未知動作 ID', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'actions'], ['action.magic']));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('未知的動作 ID');
  });

  it('白名單內的動作 ID 通過', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY1].data, ['tasks', 0, 'actions'], ['action.archive.commit']),
    );
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });
});

describe('validateContent 必要欄位與型別（其他）', () => {
  it('缺少 ui 欄位會指到 ui 檔', () => {
    const issues = issuesAfter((input) => removeAt(input.ui.data, ['storage', 'saved']));
    expect(issues.length).toBe(1);
    expect(issues[0].file).toBe('data/ui.zh-Hant.json');
  });

  it('人員編號寫成數字（前導零會消失）是型別錯誤', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['records', 1, 'code'], 102));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('record.b102');
    expect(issues[0].message).toContain('字串');
  });

  it('boolean 欄位寫成字串是型別錯誤', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['records', 0, 'refusalApplies'], 'false'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('boolean');
  });

  it('訊息內容不得為空陣列', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['messages', 0, 'lines'], []));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('空陣列');
  });

  it('整個檔案型別錯誤時不會炸掉，只回報問題', () => {
    const issues = issuesAfter((input) => {
      input.ui.data = [];
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].field).toBe('(root)');
  });

  it('每日檔不是物件時不會炸掉', () => {
    const issues = issuesAfter((input) => {
      input.days[DAY2].data = 'nope';
    });
    expect(issues.some((i) => i.file === 'data/days/day-02.json' && i.field === '(root)')).toBeTrue();
    // Day 1 的 nextDayId 因此找不到 day.02
    expect(issues.some((i) => i.field === 'nextDayId' && i.message.includes('找不到日別 day.02'))).toBeTrue();
  });
});

describe('validateContent ID 命名規則', () => {
  it('前綴錯誤', () => {
    const issues = issuesAfter((input) => setAt(input.actors.data, ['actors', 0, 'id'], 'person.lin-yuan'));
    expect(issues.some((i) => i.message.includes('必須以 `actor.` 開頭'))).toBeTrue();
  });

  it('大寫或空白', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'id'], 'task.Day1 Archive'));
    expect(issues.some((i) => i.message.includes('小寫'))).toBeTrue();
  });

  it('缺少 id', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY1].data, ['messages', 1, 'id']));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('缺少 id');
  });
});

describe('validateContent 頻道結構（KB-R4-04）', () => {
  it('kind 必須是 department／group／direct', () => {
    const issues = issuesAfter((input) => setAt(input.channels.data, ['channels', 0, 'kind'], 'broadcast'));
    expect(issues.some((i) => i.field.endsWith('kind'))).toBeTrue();
  });

  it('direct 頻道不自帶標題（取自對方稱呼）', () => {
    const issues = issuesAfter((input) => setAt(input.channels.data, ['channels', 2, 'title'], '某某'));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('channel.dm.lin-yuan');
    expect(issues[0].field).toBe('channels[2].title');
  });

  it('部門頻道不得缺標題', () => {
    const issues = issuesAfter((input) => removeAt(input.channels.data, ['channels', 0, 'title']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('channel.department.data-ops');
  });

  it('群組頻道必須有標題', () => {
    const issues = issuesAfter((input) =>
      pushAt(input.channels.data, ['channels'], { id: 'channel.group.example', kind: 'group', topic: '範例', actorIds: [] }),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('channels[4].title');
    expect(issues[0].message).toContain('title');
  });

  it('正式頻道：department／group 有 topic，direct 沒有且恰好一位對象（R7 §4）', () => {
    const list = (CONTENT_SOURCES.channels.data as { channels: Record<string, unknown>[] }).channels;
    expect(list.map((c) => c['id'])).toEqual([
      'channel.department.data-ops',
      'channel.group.lunch-chat',
      'channel.dm.lin-yuan',
      'channel.dm.wu-wan-ting',
    ]);
    for (const c of list) {
      if (c['kind'] === 'direct') {
        expect('topic' in c).withContext(String(c['id'])).toBeFalse();
        expect((c['actorIds'] as unknown[]).length).toBe(1);
      } else expect(typeof c['topic']).withContext(String(c['id'])).toBe('string');
    }
  });

  it('部門頻道缺 topic（R7）', () => {
    const issues = issuesAfter((input) => removeAt(input.channels.data, ['channels', 0, 'topic']));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/channels.json [channel.department.data-ops] channels[0].topic：department 頻道必須有非空的 topic，得到 undefined',
    );
  });

  it('群組頻道的 topic 為空字串或非字串', () => {
    const empty = issuesAfter((input) => setAt(input.channels.data, ['channels', 1, 'topic'], ''));
    expect(empty.length).toBe(1);
    expect(empty[0].field).toBe('channels[1].topic');
    expect(empty[0].message).toContain('得到 空字串');
    const wrong = issuesAfter((input) => setAt(input.channels.data, ['channels', 1, 'topic'], ['午餐']));
    expect(wrong.length).toBe(1);
    expect(wrong[0].message).toContain('得到 array');
  });

  it('direct 頻道不得填 topic', () => {
    const issues = issuesAfter((input) => setAt(input.channels.data, ['channels', 3, 'topic'], '私訊'));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('channel.dm.wu-wan-ting');
    expect(issues[0].field).toBe('channels[3].topic');
    expect(issues[0].message).toContain('direct 頻道不填 topic');
  });

  it('direct 頻道必須恰好一位對象', () => {
    const issues = issuesAfter((input) =>
      setAt(input.channels.data, ['channels', 3, 'actorIds'], ['actor.wu-wan-ting', 'actor.yang-zi-qian']),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('channels[3].actorIds');
    expect(issues[0].message).toContain('剛好一位');
  });
});

describe('validateContent 樣板與可執行內容', () => {
  it('未知的 placeholder', () => {
    const issues = issuesAfter((input) => setAt(input.ui.data, ['archive', 'progressTemplate'], '{count} / {totals} 已處理'));
    expect(issues.some((i) => i.message.includes('未知的 placeholder {totals}'))).toBeTrue();
  });

  it('缺少必要的 placeholder', () => {
    const issues = issuesAfter((input) => setAt(input.ui.data, ['archive', 'footerPendingTemplate'], '完成後即可交接。'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('archive.footerPendingTemplate');
    expect(issues[0].message).toContain('缺少必要的 placeholder');
  });

  it('report 文件的 versionTemplate 用錯 placeholder 名稱', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY2].data, ['documents', 0, 'text', 'versionTemplate'], '版本 {rev}'),
    );
    expect(issues.every((i) => i.id === 'doc.day2.summary' && i.field === 'documents[0].text.versionTemplate')).toBeTrue();
    expect(issues.some((i) => i.message.includes('未知的 placeholder {rev}'))).toBeTrue();
    expect(issues.some((i) => i.message.includes('缺少必要的 placeholder {revision}'))).toBeTrue();
  });

  it('未登記的樣板欄位', () => {
    const issues = issuesAfter((input) => setAt(input.ui.data, ['cover', 'mysteryTemplate'], '{count}'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('未知的樣板欄位');
  });

  it('一般欄位不得使用大括號', () => {
    const issues = issuesAfter((input) => setAt(input.ui.data, ['cover', 'title'], '錯誤世界 {title}'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('*Template');
  });

  it('不得夾帶運算式', () => {
    const issues = issuesAfter((input) => setAt(input.ui.data, ['cover', 'title'], '${globalThis}'));
    expect(issues.some((i) => i.message.includes('運算式'))).toBeTrue();
  });

  it('不得夾帶函式字串', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY1].data, ['messages', 0, 'lines', 0], '() => doSomething()'),
    );
    expect(issues.some((i) => i.message.includes('函式字串'))).toBeTrue();
  });
});

describe('describeIssue', () => {
  it('同時列出來源檔、內容 ID 與完整欄位路徑', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['messages', 0, 'unlock'], ['cond.nope']));
    const line = describeIssue(issues[0]);
    expect(line).toContain('data/days/day-01.json');
    expect(line).toContain('[msg.day1.welcome]');
    expect(line).toContain('messages[0].unlock[0]：');
  });
});

describe('validateContent reconcile 的 subjectRecordId（R6-01）', () => {
  it('缺 subjectRecordId', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY2].data, ['tasks', 0, 'subjectRecordId']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('task.day2.reconcile');
    expect(issues[0].field).toBe('tasks[0].subjectRecordId');
  });

  it('subjectRecordId 指向不存在的紀錄', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['tasks', 0, 'subjectRecordId'], 'record.nope'));
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['tasks[0].subjectRecordId', 'tasks[0].subjectRecordId']));
    expect(issues.some((i) => i.message.includes('找不到紀錄 record.nope'))).toBeTrue();
    expect(issues.some((i) => i.message.includes('必須列在同一任務的 recordIds 內'))).toBeTrue();
  });

  it('subjectRecordId 存在但不在該任務的 recordIds', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['tasks', 0, 'subjectRecordId'], 'record.h17'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('recordIds');
  });
});

describe('validateContent field-map 任務（R6-03）', () => {
  const fmIssues = (mutate: (task: Record<string, unknown>) => void): ContentIssue[] =>
    issuesAfter((input) => mutate(containerAt(input.days[DAY6].data, FM)));

  it('正式 Day 6 是 field-map 任務且通過', () => {
    const task = containerAt(CONTENT_SOURCES.days[DAY6].data, FM);
    expect(task['kind']).toBe('field-map');
    expect(validateContent(CONTENT_SOURCES).length).toBe(0);
  });

  it('targetFields 的 sourceId 不存在', () => {
    const issues = fmIssues((t) => setAt(t, ['targetFields', 2, 'sourceId'], 'contact-note'));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-06.json [task.day6.field-map] tasks[0].targetFields[2].sourceId：找不到來源欄位 contact-note（預設配對需列在 sourceFields）',
    );
  });

  it('兩個目標的預設配對指向同一個來源（非一對一）', () => {
    const issues = fmIssues((t) => setAt(t, ['targetFields', 3, 'sourceId'], 'legacy-id'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].targetFields[3].sourceId');
    expect(issues[0].message).toContain('已由目標 personnel-code 使用；預設配對必須一對一');
  });

  it('sourceId 只是作者預設：換成另一組存在、一對一且可轉換的預設配對同樣通過（驗證不認定唯一正解）', () => {
    const issues = fmIssues((t) => {
      // 兩個 text 目標的預設來源互換（聯繫狀態 ↔ 生效日期），意義不同但型別合法
      setAt(t, ['targetFields', 2, 'sourceId'], 'record-date');
      setAt(t, ['targetFields', 3, 'sourceId'], 'contact-result');
    });
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('目標欄位 id 重複', () => {
    const issues = fmIssues((t) => setAt(t, ['targetFields', 2, 'id'], 'exclude-flag'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].targetFields[2].id');
    expect(issues[0].message).toContain('重複');
  });

  it('來源欄位 id 重複', () => {
    const issues = fmIssues((t) => setAt(t, ['sourceFields', 3, 'id'], 'contact-result'));
    expect(issues.some((i) => i.field === 'tasks[0].sourceFields[3].id' && i.message.includes('重複'))).toBeTrue();
  });

  it('boolean 目標缺 trueValue', () => {
    const issues = fmIssues((t) => removeAt(t, ['targetFields', 1, 'trueValue']));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].targetFields[1].trueValue');
    expect(issues[0].message).toContain('boolean 欄位必須有非空的 trueValue');
  });

  it('boolean 目標的 trueValue 與 falseValue 相同', () => {
    const issues = fmIssues((t) => setAt(t, ['targetFields', 1, 'falseValue'], '有'));
    expect(issues.some((i) => i.field === 'tasks[0].targetFields[1].falseValue')).toBeTrue();
  });

  it('text 目標不得帶 trueValue／falseValue', () => {
    const issues = fmIssues((t) => setAt(t, ['targetFields', 0, 'trueValue'], '有'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].targetFields[0].trueValue');
  });

  it('未知的 convert', () => {
    const issues = fmIssues((t) => setAt(t, ['targetFields', 3, 'convert'], 'date'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('text／boolean');
  });

  it('資料列缺少某個來源欄位的鍵', () => {
    const issues = fmIssues((t) => removeAt(t, ['rows', 2, 'values', 'contact-result']));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].rows[2].values.contact-result');
    expect(issues[0].message).toContain('空值請填空字串');
  });

  it('資料列多出不是來源欄位的鍵', () => {
    const issues = fmIssues((t) => setAt(t, ['rows', 0, 'values', 'name'], '某某'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].rows[0].values.name');
    expect(issues[0].message).toContain('values 的鍵必須恰為 sourceFields');
  });

  it('boolean 目標的預設來源值不在值域內（作者預設配對必須可轉換）', () => {
    const issues = fmIssues((t) => setAt(t, ['rows', 1, 'values', 'objection-reply'], '不明'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].rows[1].values.objection-reply');
    expect(issues[0].message).toContain('有／無 或空字串');
    expect(issues[0].message).toContain('預設配對需可轉換');
  });

  it('不是任何 boolean 目標預設來源的欄位，值不受 boolean 值域限制（玩家配錯時由規則層擋 unconvertible）', () => {
    const issues = fmIssues((t) => setAt(t, ['rows', 1, 'values', 'contact-result'], '不明'));
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('空字串是合法的空值（由 blankPolicy 決定）', () => {
    const issues = fmIssues((t) => setAt(t, ['rows', 1, 'values', 'objection-reply'], ''));
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('來源值寫成數字（前導零會消失）是型別錯誤', () => {
    const issues = fmIssues((t) => setAt(t, ['rows', 0, 'values', 'legacy-id'], 102));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].rows[0].values.legacy-id');
    expect(issues[0].message).toContain('前導零');
  });

  it('rows 不得為空', () => {
    const issues = fmIssues((t) => setAt(t, ['rows'], []));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].rows');
    expect(issues[0].message).toContain('不得為空陣列');
  });

  it('sourceFields／targetFields 不得為空', () => {
    expect(fields(fmIssues((t) => setAt(t, ['targetFields'], [])))).toEqual(['tasks[0].targetFields']);
    const noSources = fmIssues((t) => setAt(t, ['sourceFields'], []));
    expect(noSources.some((i) => i.field === 'tasks[0].sourceFields')).toBeTrue();
  });

  it('資料列 id 必須以 row. 開頭', () => {
    const issues = fmIssues((t) => setAt(t, ['rows', 0, 'id'], 'line.0102'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].rows[0].id');
    expect(issues[0].message).toContain('`row.` 開頭');
  });

  it('資料列 id 重複', () => {
    const issues = fmIssues((t) => setAt(t, ['rows', 1, 'id'], 'row.0102'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].rows[1].id');
  });

  it('field-map 任務不使用 batchId／sourceBatchId', () => {
    const issues = fmIssues((t) => setAt(t, ['sourceBatchId'], 'batch.day05.archive'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[0].sourceBatchId');
  });

  it('field-map text 缺 policyReview；多餘欄位也被指出', () => {
    const issues = fmIssues((t) => {
      removeAt(t, ['text', 'policyReview']);
      setAt(t, ['text', 'recommended'], 'policyDefault');
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['tasks[0].text.policyReview', 'tasks[0].text.recommended']));
  });
});

describe('validateContent 批次覆核條件 cond.review.*（R6-03）', () => {
  const setUnlock = (day: number, index: number, unlock: string[]) => (input: ContentInput) =>
    setAt(input.days[day].data, ['messages', index, 'unlock'], unlock);

  it('正式 Day 4 午休群組：三則 any、兩則 none，同一批次（R7 §5）', () => {
    const msgs = (CONTENT_SOURCES.days[DAY4].data as { messages: { id: string; unlock: string[] }[] }).messages;
    const review = msgs.filter((m) => m.unlock.some((c) => c.startsWith('cond.review.')));
    expect(review.map((m) => [m.id, ...m.unlock])).toEqual([
      ['msg.day4.review-returned', 'cond.review.any.batch.day03.archive'],
      ['msg.day4.review-name', 'cond.review.any.batch.day03.archive'],
      ['msg.day4.review-mood', 'cond.review.any.batch.day03.archive'],
      ['msg.day4.quick-praise', 'cond.review.none.batch.day03.archive'],
      ['msg.day4.green-number', 'cond.review.none.batch.day03.archive'],
    ]);
  });

  it('引用較早的 archive 批次通過（Day 4 引用 Day 1）', () => {
    const issues = issuesAfter(setUnlock(DAY4, 0, ['cond.review.any.batch.day01.archive']));
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('未知批次', () => {
    const issues = issuesAfter(setUnlock(DAY4, 1, ['cond.review.any.batch.day09.archive']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('msg.day4.dm-lunch-join');
    expect(issues[0].field).toBe('messages[1].unlock[0]');
    expect(issues[0].message).toContain('找不到批次 batch.day09.archive');
  });

  it('批次屬於同一天（結果尚未確定）', () => {
    const issues = issuesAfter(setUnlock(DAY3, 0, ['cond.review.none.batch.day03.archive']));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('messages[0].unlock[0]');
    expect(issues[0].message).toContain('必須早於訊息的 visibleFrom');
  });

  it('批次晚於訊息的 visibleFrom', () => {
    const issues = issuesAfter(setUnlock(DAY1, 0, ['cond.review.any.batch.day03.archive']));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('第 3 天');
  });

  it('batch ID 格式錯誤時是未知條件，並提示覆核條件格式', () => {
    const issues = issuesAfter(setUnlock(DAY4, 0, ['cond.review.any.day03']));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('未知的條件 ID');
    expect(issues[0].message).toContain('cond.review.any|none');
  });
});

describe('validateContent 編號一律為字串', () => {
  it('每一筆紀錄的 code 與 field-map 每一列的值都是字串，前導零保留', () => {
    for (const source of CONTENT_SOURCES.days) {
      const day = source.data as { records: { code: unknown }[]; tasks: { kind: string; rows?: { values: Record<string, unknown> }[] }[] };
      for (const r of day.records) expect(typeof r.code).withContext(source.file).toBe('string');
      for (const t of day.tasks) {
        for (const row of t.rows ?? []) {
          for (const v of Object.values(row.values)) expect(typeof v).withContext(source.file).toBe('string');
        }
      }
    }
  });

  it('Day 3–5 的 B 紀錄 code 寫成數字會被擋下', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY3].data, ['records', 2, 'code'], 314));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('record.day3-b314');
  });
});

/* ---------- R7：訊息固定回覆、聊天條件、日期標籤與介面語意 ---------- */

/** Day 1 msg.day1.pace 的 replyPrompt（dm.lin-yuan）。 */
const P1 = ['messages', 1, 'replyPrompt'] as const;
/** Day 3 msg.day3.lunch-ask-player 的 replyPrompt（group.lunch-chat）。 */
const P3 = ['messages', 5, 'replyPrompt'] as const;
/** Day 1 第一個選項的第一則回應。 */
const R1 = [...P1, 'choices', 0, 'responses', 0] as const;

describe('validateContent 訊息 replyPrompt（R7 §3）', () => {
  it('正式資料：每日恰好的 prompt 與全域唯一的 prompt／response ID', () => {
    type Raw = { messages: { id: string; replyPrompt?: { id: string; choices: { id: string; responses: { id: string }[] }[] } }[] };
    const all = CONTENT_SOURCES.days.flatMap((d) => (d.data as Raw).messages);
    expect(all.flatMap((m) => (m.replyPrompt ? [m.replyPrompt.id] : []))).toEqual([
      'prompt.day1.welcome',
      'prompt.day2.check-in',
      'prompt.day3.lunch-plan',
      'prompt.day4.review-returned',
      'prompt.day4.quick-close',
      'prompt.day5.missing-box',
      'prompt.day6.closed-box',
    ]);
    const msgIds = [
      ...all.map((m) => m.id),
      ...all.flatMap((m) => m.replyPrompt?.choices.flatMap((c) => c.responses.map((r) => r.id)) ?? []),
    ];
    expect(new Set(msgIds).size).toBe(msgIds.length);
  });

  it('prompt ID 必須以 prompt. 開頭', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1, 'id'], 'day1.welcome'));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-01.json [day1.welcome] messages[1].replyPrompt.id：ID 必須以 `prompt.` 開頭',
    );
  });

  it('prompt ID 全域唯一（同檔另一個 prompt）', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY4].data, ['messages', 8, 'replyPrompt', 'id'], 'prompt.day4.review-returned'),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('messages[8].replyPrompt.id');
    expect(issues[0].message).toContain('ID 重複，已在 data/days/day-04.json 使用');
  });

  it('prompt ID 不得與其他種類的 ID 重複', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1, 'id'], 'msg.day1.welcome'));
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['messages[1].replyPrompt.id', 'messages[1].replyPrompt.id']));
    expect(issues.some((i) => i.message.includes('`prompt.` 開頭'))).toBeTrue();
    expect(issues.some((i) => i.message.includes('ID 重複'))).toBeTrue();
  });

  it('prompt ID 缺所屬日識別；Day 4 以 cond.chat 引用它的三則私訊也跟著找不到 prompt', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY3].data, [...P3, 'id'], 'prompt.lunch-plan'));
    const token = issues.filter((i) => i.file === 'data/days/day-03.json');
    expect(token.length).toBe(1);
    expect(token[0].field).toBe('messages[5].replyPrompt.id');
    expect(token[0].message).toContain('`day3`');
    const dangling = issues.filter((i) => i.file === 'data/days/day-04.json');
    expect(dangling.map((i) => i.id)).toEqual(['msg.day4.dm-lunch-join', 'msg.day4.dm-lunch-floor', 'msg.day4.dm-lunch-own']);
    expect(dangling.every((i) => i.message.includes('找不到 prompt prompt.day3.lunch-plan'))).toBeTrue();
  });

  it('replyPrompt 不是物件', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1], ['thanks']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('msg.day1.pace');
    expect(issues[0].field).toBe('messages[1].replyPrompt');
    expect(issues[0].message).toContain('得到 array');
  });

  it('replyPrompt 的多餘欄位', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1, 'expires'], 'day.02'));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('prompt.day1.welcome');
    expect(issues[0].field).toBe('messages[1].replyPrompt.expires');
  });

  it('choice ID 在同一 prompt 內重複', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1, 'choices', 1, 'id'], 'thanks'));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-01.json [prompt.day1.welcome] messages[1].replyPrompt.choices[1].id：choice id thanks 在同一 prompt 內重複',
    );
  });

  it('不同 prompt 可以用相同的 choice ID', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['messages', 3, 'replyPrompt', 'choices', 0, 'id'], 'thanks'));
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('choice ID 不得含 . 或大寫', () => {
    for (const bad of ['say.thanks', 'Thanks', '']) {
      const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1, 'choices', 0, 'id'], bad));
      expect(issues.length).withContext(bad).toBe(1);
      expect(issues[0].field).toBe('messages[1].replyPrompt.choices[0].id');
    }
    const dotted = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1, 'choices', 0, 'id'], 'say.thanks'));
    expect(dotted[0].message).toContain('不得含 `.`');
  });

  it('choice 的玩家文字不得為空', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1, 'choices', 0, 'text'], ''));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('messages[1].replyPrompt.choices[0].text');
    expect(issues[0].message).toContain('非空字串');
  });

  it('choices 不得為空；responses 不得為空', () => {
    const noChoices = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1, 'choices'], []));
    expect(fields(noChoices)).toEqual(['messages[1].replyPrompt.choices']);
    const noResponses = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1, 'choices', 1, 'responses'], []));
    expect(fields(noResponses)).toEqual(['messages[1].replyPrompt.choices[1].responses']);
    expect(noResponses[0].message).toContain('不得為空陣列');
  });

  it('response ID 與普通訊息重複', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...R1, 'id'], 'msg.day1.welcome'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('messages[1].replyPrompt.choices[0].responses[0].id');
    expect(issues[0].message).toContain('ID 重複');
  });

  it('普通訊息 ID 與 response 重複（跨檔）', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['messages', 0, 'id'], 'msg.day1.reply.thanks'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('ID 重複');
  });

  it('response ID 必須用 msg. 前綴並含所屬日識別', () => {
    const prefix = issuesAfter((input) => setAt(input.days[DAY1].data, [...R1, 'id'], 'reply.day1.thanks'));
    expect(prefix.length).toBe(1);
    expect(prefix[0].message).toContain('`msg.` 開頭');
    const token = issuesAfter((input) => setAt(input.days[DAY1].data, [...R1, 'id'], 'msg.reply.thanks'));
    expect(token.length).toBe(1);
    expect(token[0].message).toContain('`day1`');
  });

  it('response 時間必須是 HH:MM', () => {
    for (const bad of ['8:38', '08:60', '24:00', '0838', '']) {
      const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...R1, 'time'], bad));
      expect(issues.length).withContext(bad).toBe(1);
      expect(describeIssue(issues[0])).toContain(
        'data/days/day-01.json [msg.day1.reply.thanks] messages[1].replyPrompt.choices[0].responses[0].time：時間必須是 HH:MM',
      );
    }
    const missing = issuesAfter((input) => removeAt(input.days[DAY1].data, [...R1, 'time']));
    expect(missing.length).toBe(1);
    expect(missing[0].message).toContain('需要 string');
  });

  it('普通訊息的時間也必須是 HH:MM，錯誤指向完整路徑', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['messages', 0, 'time'], '8:42'));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('msg.day2.handoff');
    expect(issues[0].field).toBe('messages[0].time');
  });

  it('response lines 不得為空陣列或空字串', () => {
    const empty = issuesAfter((input) => setAt(input.days[DAY1].data, [...R1, 'lines'], []));
    expect(fields(empty)).toEqual(['messages[1].replyPrompt.choices[0].responses[0].lines']);
    const blank = issuesAfter((input) => setAt(input.days[DAY1].data, [...R1, 'lines'], ['']));
    expect(fields(blank)).toEqual(['messages[1].replyPrompt.choices[0].responses[0].lines[0]']);
  });

  it('response 的人物不存在（只報找不到，不另報成員）', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...R1, 'actorId'], 'actor.nobody'));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-01.json [msg.day1.reply.thanks] messages[1].replyPrompt.choices[0].responses[0].actorId：找不到人物 actor.nobody',
    );
  });

  it('response 的人物必須是 anchor 頻道的成員', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...R1, 'actorId'], 'actor.wu-wan-ting'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('messages[1].replyPrompt.choices[0].responses[0].actorId');
    expect(issues[0].message).toContain('不是頻道 channel.dm.lin-yuan 的成員');
    // 群組頻道的成員可以回應
    const member = issuesAfter((input) =>
      setAt(input.days[DAY3].data, [...P3, 'choices', 2, 'responses', 0, 'actorId'], 'actor.lin-yuan'),
    );
    expect(member.length).withContext(messages(member)).toBe(0);
  });

  it('response 不另存 channelId／visibleFrom（繼承 anchor）', () => {
    const issues = issuesAfter((input) => {
      setAt(input.days[DAY1].data, [...R1, 'channelId'], 'channel.dm.lin-yuan');
      setAt(input.days[DAY1].data, [...R1, 'visibleFrom'], 'day.01');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'messages[1].replyPrompt.choices[0].responses[0].channelId',
        'messages[1].replyPrompt.choices[0].responses[0].visibleFrom',
      ]),
    );
    expect(issues.every((i) => i.message.includes('繼承 anchor 訊息'))).toBeTrue();
  });

  it('availableThrough 早於 anchor 的 visibleFrom', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY3].data, [...P3, 'availableThrough'], 'day.02'));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-03.json [prompt.day3.lunch-plan] messages[5].replyPrompt.availableThrough：availableThrough day.02（第 2 天）不得早於 anchor 訊息的 visibleFrom（第 3 天）',
    );
  });

  it('availableThrough 指向不存在的日、缺少或型別錯誤', () => {
    const unknown = issuesAfter((input) => setAt(input.days[DAY3].data, [...P3, 'availableThrough'], 'day.09'));
    expect(unknown.length).toBe(1);
    expect(unknown[0].message).toContain('找不到日別 day.09');
    const missing = issuesAfter((input) => removeAt(input.days[DAY3].data, [...P3, 'availableThrough']));
    expect(missing.length).toBe(1);
    expect(missing[0].message).toContain('缺少必要欄位 availableThrough');
    const wrong = issuesAfter((input) => setAt(input.days[DAY3].data, [...P3, 'availableThrough'], 3));
    expect(wrong.length).toBe(1);
    expect(wrong[0].message).toContain('得到 number');
  });

  it('availableThrough 可以晚於 visibleFrom（跨日仍可回答）', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, [...P1, 'availableThrough'], 'day.02'));
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });
});

describe('validateContent 聊天條件 cond.chat.*（R7 §3）', () => {
  const setUnlock = (day: number, index: number, unlock: string[]) => (input: ContentInput) =>
    setAt(input.days[day].data, ['messages', index, 'unlock'], unlock);

  it('正式 Day 4 的三則吳婉庭私訊各引用 Day 3 午餐 prompt 的一個 choice', () => {
    const msgs = (CONTENT_SOURCES.days[DAY4].data as { messages: { id: string; channelId: string; unlock: string[] }[] }).messages;
    const dm = msgs.filter((m) => m.channelId === 'channel.dm.wu-wan-ting');
    expect(dm.map((m) => [m.id, ...m.unlock])).toEqual([
      ['msg.day4.dm-lunch-join', 'cond.chat.day3.lunch-plan.join'],
      ['msg.day4.dm-lunch-floor', 'cond.chat.day3.lunch-plan.ask-floor'],
      ['msg.day4.dm-lunch-own', 'cond.chat.day3.lunch-plan.brought-own'],
    ]);
  });

  it('引用不存在的 prompt', () => {
    const issues = issuesAfter(setUnlock(DAY4, 1, ['cond.chat.day3.dinner-plan.join']));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toContain(
      'data/days/day-04.json [msg.day4.dm-lunch-join] messages[1].unlock[0]：找不到 prompt prompt.day3.dinner-plan',
    );
  });

  it('引用 prompt 不存在的 choice', () => {
    const issues = issuesAfter(setUnlock(DAY4, 1, ['cond.chat.day3.lunch-plan.skip']));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('prompt prompt.day3.lunch-plan 沒有 choice skip');
    expect(issues[0].message).toContain('join、ask-floor、brought-own');
  });

  it('格式錯誤的聊天條件是未知條件，並提示格式', () => {
    for (const bad of ['cond.chat.join', 'cond.chat.day3.lunch-plan.Join', 'cond.chat.']) {
      const issues = issuesAfter(setUnlock(DAY4, 1, [bad]));
      expect(issues.length).withContext(bad).toBe(1);
      expect(issues[0].message).toContain('未知的條件 ID');
      expect(issues[0].message).toContain('cond.chat.<prompt ID 去掉 prompt.>.<choice ID>');
    }
  });

  it('prompt 的 anchor 晚於訊息的 visibleFrom（回答前訊息已該出現）', () => {
    const issues = issuesAfter(setUnlock(DAY1, 0, ['cond.chat.day3.lunch-plan.join']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('msg.day1.welcome');
    expect(issues[0].message).toContain('從第 3 天起才能回答，晚於訊息的 visibleFrom（第 1 天）');
  });

  it('同一天、anchor 以外的訊息可以引用（當日回答後解鎖）', () => {
    const issues = issuesAfter(setUnlock(DAY3, 1, ['cond.chat.day3.lunch-plan.join']));
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('anchor 訊息不得引用自己的 prompt', () => {
    const issues = issuesAfter(setUnlock(DAY3, 5, ['cond.chat.day3.lunch-plan.join']));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('msg.day3.lunch-ask-player');
    expect(issues[0].message).toContain('不得引用這則訊息自己的 prompt');
  });
});

describe('validateContent chatDateLabel（R7 §4）', () => {
  it('正式 Day 1–6 的日期標籤', () => {
    expect(CONTENT_SOURCES.days.map((d) => (d.data as { chatDateLabel: string }).chatDateLabel)).toEqual([
      '9 月 15 日',
      '9 月 16 日',
      '9 月 17 日',
      '9 月 18 日',
      '9 月 19 日',
      '9 月 22 日',
    ]);
  });

  it('缺 chatDateLabel', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY1].data, ['chatDateLabel']));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-01.json [day.01] chatDateLabel：缺少必要欄位或型別錯誤：需要 string，得到 undefined',
    );
  });

  it('chatDateLabel 為空字串或非字串', () => {
    const empty = issuesAfter((input) => setAt(input.days[DAY3].data, ['chatDateLabel'], ''));
    expect(empty.length).toBe(1);
    expect(empty[0].id).toBe('day.03');
    expect(empty[0].message).toBe('不得為空字串');
    const wrong = issuesAfter((input) => setAt(input.days[DAY3].data, ['chatDateLabel'], 917));
    expect(wrong.length).toBe(1);
    expect(wrong[0].message).toContain('得到 number');
  });
});

describe('validateContent ui 的 R7 區塊（§6.1）', () => {
  it('fieldMap 殘留 valueTrue／valueFalse／valueNull 會被指出', () => {
    const issues = issuesAfter((input) => {
      setAt(input.ui.data, ['fieldMap', 'valueTrue'], 'true');
      setAt(input.ui.data, ['fieldMap', 'valueFalse'], 'false');
      setAt(input.ui.data, ['fieldMap', 'valueNull'], 'null');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents(['fieldMap.valueTrue', 'fieldMap.valueFalse', 'fieldMap.valueNull']),
    );
    expect(issues.every((i) => i.file === 'data/ui.zh-Hant.json' && i.message.includes('excluded'))).toBeTrue();
  });

  it('fieldMap 缺 excluded／notExcluded／pendingReview', () => {
    const issues = issuesAfter((input) => {
      for (const key of ['excluded', 'notExcluded', 'pendingReview']) removeAt(input.ui.data, ['fieldMap', key]);
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents(['fieldMap.excluded', 'fieldMap.notExcluded', 'fieldMap.pendingReview']),
    );
  });

  it('sourceCard 殘留舊的 refusalNA／Null／True 或其他多餘欄位', () => {
    const legacy = issuesAfter((input) => setAt(input.ui.data, ['sourceCard', 'refusalTrue'], '已附 · true'));
    expect(legacy.length).toBe(1);
    expect(legacy[0].field).toBe('sourceCard.refusalTrue');
    expect(legacy[0].message).toContain('recordStatus');
    const extra = issuesAfter((input) => setAt(input.ui.data, ['sourceCard', 'hint'], '說明'));
    expect(extra.length).toBe(1);
    expect(extra[0].field).toBe('sourceCard.hint');
    const missing = issuesAfter((input) => removeAt(input.ui.data, ['sourceCard', 'refusal']));
    expect(fields(missing)).toEqual(['sourceCard.refusal']);
  });

  it('sourceCard 缺安排項目標籤或值為空字串（R12）', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['sourceCard', 'arrangement']);
      setAt(input.ui.data, ['sourceCard', 'arrangementValue'], '');
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['sourceCard.arrangement', 'sourceCard.arrangementValue']));
  });

  it('sourceCard 缺 missingNote 或為空字串（R12）', () => {
    const missing = issuesAfter((input) => removeAt(input.ui.data, ['sourceCard', 'missingNote']));
    expect(fields(missing)).toEqual(['sourceCard.missingNote']);
    const empty = issuesAfter((input) => setAt(input.ui.data, ['sourceCard', 'missingNote'], ''));
    expect(fields(empty)).toEqual(['sourceCard.missingNote']);
  });

  it('recordStatus 缺欄位、空字串或多餘欄位', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['recordStatus', 'missing']);
      setAt(input.ui.data, ['recordStatus', 'unconfirmed'], '');
      setAt(input.ui.data, ['recordStatus', 'maybe'], '也許');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents(['recordStatus.missing', 'recordStatus.unconfirmed', 'recordStatus.maybe']),
    );
    const gone = issuesAfter((input) => removeAt(input.ui.data, ['recordStatus']));
    expect(fields(gone)).toEqual(['recordStatus']);
  });

  it('messages 殘留 eyebrow／back 會被指出；缺新欄位也會', () => {
    const legacy = issuesAfter((input) => {
      setAt(input.ui.data, ['messages', 'eyebrow'], 'INTERNAL MESSAGES');
      setAt(input.ui.data, ['messages', 'back'], '返回工作');
    });
    expect(fields(legacy)).toEqual(jasmine.arrayWithExactContents(['messages.eyebrow', 'messages.back']));
    expect(legacy.find((i) => i.field === 'messages.back')?.message).toContain('不放「返回工作」');
    const missing = issuesAfter((input) => {
      removeAt(input.ui.data, ['messages', 'workspace']);
      removeAt(input.ui.data, ['messages', 'sectionTitle', 'direct']);
    });
    expect(fields(missing)).toEqual(jasmine.arrayWithExactContents(['messages.workspace', 'messages.sectionTitle.direct']));
  });

  it('memberCountTemplate 需要 {count}', () => {
    const issues = issuesAfter((input) => setAt(input.ui.data, ['messages', 'memberCountTemplate'], '{n} 位成員'));
    expect(issues.every((i) => i.field === 'messages.memberCountTemplate')).toBeTrue();
    expect(issues.some((i) => i.message.includes('缺少必要的 placeholder {count}'))).toBeTrue();
    expect(issues.some((i) => i.message.includes('未知的 placeholder {n}'))).toBeTrue();
  });

  it('archive 缺新的預覽欄位', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['archive', 'previewDestination']);
      removeAt(input.ui.data, ['archive', 'policyReviewHint']);
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['archive.previewDestination', 'archive.policyReviewHint']));
  });
});

/* ---------- R8：同日多工作的共用 UI 字串 ---------- */

describe('validateContent ui 的 R8 區塊（tasks／handoff／morning／executionLog）', () => {
  it('archive／fieldMap 殘留 finishDay 會被指出並指向 ui.tasks', () => {
    const issues = issuesAfter((input) => {
      setAt(input.ui.data, ['archive', 'finishDay'], '完成今日交接');
      setAt(input.ui.data, ['fieldMap', 'finishDay'], '完成今日交接');
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['archive.finishDay', 'fieldMap.finishDay']));
    expect(issues.every((i) => i.message.includes('ui.tasks.finishDay'))).toBeTrue();
  });

  it('每日 archive 任務 text 帶 finishDay 也指向 ui.tasks', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 1, 'text', 'finishDay'], '完成今日交接'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('tasks[1].text.finishDay');
    expect(issues[0].message).toContain('ui.tasks.finishDay');
  });

  it('四個區塊缺欄位、空字串、多餘欄位、巢狀型別錯誤', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['tasks', 'deliver']);
      removeAt(input.ui.data, ['tasks', 'kind', 'field-map']);
      setAt(input.ui.data, ['tasks', 'unit'], '筆');
      setAt(input.ui.data, ['handoff', 'next'], '');
      setAt(input.ui.data, ['morning', 'loading'], '載入中');
      removeAt(input.ui.data, ['executionLog', 'check', 'pass']);
      removeAt(input.ui.data, ['executionLog', 'key', 'personnelId']);
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'tasks.deliver',
        'tasks.kind.field-map',
        'tasks.unit',
        'handoff.next',
        'morning.loading',
        'executionLog.check.pass',
        'executionLog.key.personnelId',
      ]),
    );
    expect(issues.every((i) => i.file === 'data/ui.zh-Hant.json')).toBeTrue();
  });

  it('整個區塊缺少', () => {
    const issues = issuesAfter((input) => {
      for (const key of ['tasks', 'handoff', 'morning', 'executionLog']) removeAt(input.ui.data, [key]);
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['tasks', 'handoff', 'morning', 'executionLog']));
  });

  it('樣板 placeholder：stepTemplate／totalTemplate／itemTemplate／pendingTemplate／morningTemplate', () => {
    const cases: [Path, string, string][] = [
      [['tasks', 'stepTemplate'], '第 {index} 項', '缺少必要的 placeholder {total}'],
      [['handoff', 'totalTemplate'], '共 {n} 項工作', '未知的 placeholder {n}'],
      [['handoff', 'itemTemplate'], '{kind} {count}', '缺少必要的 placeholder {unit}'],
      [['morning', 'pendingTemplate'], '待處理 {count}', '缺少必要的 placeholder {unit}'],
      [['progressLabel', 'morningTemplate'], '收件', '缺少必要的 placeholder {dayName}'],
    ];
    for (const [path, value, message] of cases) {
      const issues = issuesAfter((input) => setAt(input.ui.data, path, value));
      expect(issues.length).withContext(path.join('.')).toBeGreaterThan(0);
      expect(issues.every((i) => i.field === path.join('.'))).withContext(path.join('.')).toBeTrue();
      expect(issues.some((i) => i.message.includes(message))).withContext(path.join('.')).toBeTrue();
    }
  });

  it('morning.docTitleTemplate 依完整路徑登記：只用 {dayName}，不沿用 workbench.docTitleTemplate 的 {view}', () => {
    const withView = issuesAfter((input) => setAt(input.ui.data, ['morning', 'docTitleTemplate'], '第{dayName}日 — {view}'));
    expect(withView.length).toBe(1);
    expect(withView[0].field).toBe('morning.docTitleTemplate');
    expect(withView[0].message).toContain('未知的 placeholder {view}');
    const workbench = issuesAfter((input) => setAt(input.ui.data, ['workbench', 'docTitleTemplate'], '第{dayName}日'));
    expect(workbench.length).toBe(1);
    expect(workbench[0].message).toContain('缺少必要的 placeholder {view}');
  });
});

/* ---------- R8 §4：訊息的工作進度解鎖 unlockAfter ---------- */

describe('validateContent 訊息 unlockAfter（R8 §4）', () => {
  /** Day 3 msg.day3.lunch-order。 */
  const LUNCH_ORDER = ['messages', 2] as const;
  const setAfter = (day: number, index: number, value: unknown) => (input: ContentInput) =>
    setAt(input.days[day].data, ['messages', index, 'unlockAfter'], value);

  it('正式 Day 3：午餐群組四則都在原歸檔批次提交 2 筆後才解鎖，其他訊息沒有 unlockAfter', () => {
    type Raw = { messages: { id: string; unlockAfter?: unknown }[] };
    const all = CONTENT_SOURCES.days.flatMap((d) => (d.data as Raw).messages);
    expect(all.filter((m) => m.unlockAfter !== undefined).map((m) => [m.id, m.unlockAfter])).toEqual(
      ['msg.day3.lunch-order', 'msg.day3.lunch-yesterday', 'msg.day3.lunch-hungry', 'msg.day3.lunch-ask-player'].map((id) => [
        id,
        { archiveBatchId: 'batch.day03.archive', archivedCount: 2 },
      ]),
    );
  });

  it('引用較早日或同日的 archive 批次都通過', () => {
    const earlier = issuesAfter(setAfter(DAY3, 0, { archiveBatchId: 'batch.day01.archive-followup', archivedCount: 3 }));
    expect(earlier.length).withContext(messages(earlier)).toBe(0);
    const sameDay = issuesAfter(setAfter(DAY2, 0, { archiveBatchId: 'batch.day02.archive', archivedCount: 1 }));
    expect(sameDay.length).withContext(messages(sameDay)).toBe(0);
  });

  it('找不到批次（含 reconcile 的來源不是自己的批次、或少了 batch. 前綴）', () => {
    for (const batch of ['batch.day09.archive', 'day03.archive']) {
      const issues = issuesAfter((input) => setAt(input.days[DAY3].data, [...LUNCH_ORDER, 'unlockAfter', 'archiveBatchId'], batch));
      expect(issues.length).withContext(batch).toBe(1);
      expect(describeIssue(issues[0])).toBe(
        `data/days/day-03.json [msg.day3.lunch-order] messages[2].unlockAfter.archiveBatchId：找不到批次 ${batch}（unlockAfter 只能引用 archive 任務的 batchId）`,
      );
    }
  });

  it('archivedCount 必須是 1 以上的整數', () => {
    for (const bad of [0, -1, 1.5, '2', null]) {
      const issues = issuesAfter((input) => setAt(input.days[DAY3].data, [...LUNCH_ORDER, 'unlockAfter', 'archivedCount'], bad));
      expect(issues.length).withContext(String(bad)).toBe(1);
      expect(issues[0].field).toBe('messages[2].unlockAfter.archivedCount');
      expect(issues[0].message).toContain('1 以上的整數');
    }
  });

  it('archivedCount 超過批次筆數（永遠不會解鎖）', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY3].data, [...LUNCH_ORDER, 'unlockAfter', 'archivedCount'], 6));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('messages[2].unlockAfter.archivedCount');
    expect(issues[0].message).toContain('超過批次 batch.day03.archive 的筆數（5 筆）');
    const exact = issuesAfter((input) => setAt(input.days[DAY3].data, [...LUNCH_ORDER, 'unlockAfter', 'archivedCount'], 5));
    expect(exact.length).withContext(messages(exact)).toBe(0);
  });

  it('批次屬於比訊息 visibleFrom 更晚的日', () => {
    const issues = issuesAfter(setAfter(DAY1, 0, { archiveBatchId: 'batch.day03.archive', archivedCount: 2 }));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('msg.day1.welcome');
    expect(issues[0].field).toBe('messages[0].unlockAfter.archiveBatchId');
    expect(issues[0].message).toContain('屬於第 3 天，晚於訊息的 visibleFrom（第 1 天）');
  });

  it('不是物件、缺欄位或多餘欄位', () => {
    const notObj = issuesAfter(setAfter(DAY3, 2, 'batch.day03.archive'));
    expect(fields(notObj)).toEqual(['messages[2].unlockAfter']);
    expect(notObj[0].message).toContain('需要物件，得到 string');
    const missing = issuesAfter(setAfter(DAY3, 2, { archivedCount: 2 }));
    expect(fields(missing)).toEqual(['messages[2].unlockAfter.archiveBatchId']);
    const extra = issuesAfter((input) => setAt(input.days[DAY3].data, [...LUNCH_ORDER, 'unlockAfter', 'time'], '11:43'));
    expect(fields(extra)).toEqual(['messages[2].unlockAfter.time']);
    expect(extra[0].message).toContain('只允許 archiveBatchId、archivedCount');
  });
});

/* ---------- R9 §0：報告文件的中性版本行、同日 archive → reconcile 順序 ---------- */

describe('validateContent 報告文件 versionNeutral（R9 §0）', () => {
  it('正式 Day 2 摘要有非空的中性版本行', () => {
    type Raw = { documents: { kind: string; text: Record<string, unknown> }[] };
    const report = (CONTENT_SOURCES.days[DAY2].data as Raw).documents.find((d) => d.kind === 'report');
    expect(typeof report?.text['versionNeutral']).toBe('string');
    expect(report?.text['versionNeutral']).not.toBe('');
  });

  it('缺少、空字串或放 placeholder 都會被指出', () => {
    const missing = issuesAfter((input) => removeAt(input.days[DAY2].data, ['documents', 0, 'text', 'versionNeutral']));
    expect(missing.length).toBe(1);
    expect(describeIssue(missing[0])).toBe(
      'data/days/day-02.json [doc.day2.summary] documents[0].text.versionNeutral：缺少必要欄位或型別錯誤：需要 string，得到 undefined',
    );
    const empty = issuesAfter((input) => setAt(input.days[DAY2].data, ['documents', 0, 'text', 'versionNeutral'], ''));
    expect(fields(empty)).toEqual(['documents[0].text.versionNeutral']);
    expect(empty[0].message).toBe('不得為空字串');
    const templated = issuesAfter((input) => setAt(input.days[DAY2].data, ['documents', 0, 'text', 'versionNeutral'], '版本 {revision}'));
    expect(fields(templated)).toEqual(['documents[0].text.versionNeutral']);
    expect(templated[0].message).toContain('只有 *Template 欄位可以使用');
  });
});

describe('validateContent 同日 archive → reconcile 順序（R9 §0）', () => {
  /** 把 Day 2 核對改成核對同日新件批次。 */
  const sameDay = (input: ContentInput) => setAt(input.days[DAY2].data, ['tasks', 0, 'sourceBatchId'], 'batch.day02.archive');

  it('正式資料：Day 2 核對的是 Day 1 批次（跨日），不受同日順序限制', () => {
    const issues = validateContent(CONTENT_SOURCES);
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('同日來源 archive 排在 reconcile 之後會被指出', () => {
    const issues = issuesAfter(sameDay);
    expect(issues.length).withContext(messages(issues)).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-02.json [task.day2.reconcile] tasks[0].sourceBatchId：批次 batch.day02.archive 由同日第 2 項 archive 任務建立，必須排在這項 reconcile（第 1 項）之前',
    );
  });

  it('同日來源 archive 排在 reconcile 之前則通過', () => {
    const issues = issuesAfter((input) => {
      sameDay(input);
      (input.days[DAY2].data as { tasks: unknown[] }).tasks.reverse();
    });
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });
});

/* ---------- R9：比對案件 ---------- */

/** Day 3 的 caseReview 與四份 case-source 文件（registry、supplement、received、pending）。 */
const CR = ['tasks', 0, 'caseReview'] as const;

describe('validateContent case-source 文件（R9）', () => {
  /** pending（documents[3]）不是任何決定的依據，改壞它不會連帶 archiveCode 檢查。 */
  const PENDING = ['documents', 3] as const;

  it('正式 Day 3 的四份文件都是 case-source、fields 值一律為字串', () => {
    type Raw = { documents: { id: string; kind: string; text: { fields: { value: unknown }[] } }[] };
    const docs = (CONTENT_SOURCES.days[DAY3].data as Raw).documents;
    expect(docs.map((d) => [d.id, d.kind])).toEqual([
      ['doc.day3.h204.registry', 'case-source'],
      ['doc.day3.h204.supplement', 'case-source'],
      ['doc.day3.h204.received', 'case-source'],
      ['doc.day3.h204.pending', 'case-source'],
    ]);
    expect(docs.every((d) => d.text.fields.every((f) => typeof f.value === 'string'))).toBeTrue();
  });

  it('fields 為空陣列或不是陣列', () => {
    const empty = issuesAfter((input) => setAt(input.days[DAY3].data, [...PENDING, 'text', 'fields'], []));
    expect(fields(empty)).toEqual(['documents[3].text.fields']);
    expect(empty[0].message).toContain('不得為空陣列');
    const notArray = issuesAfter((input) => setAt(input.days[DAY3].data, [...PENDING, 'text', 'fields'], { label: '窗口狀態' }));
    expect(fields(notArray)).toEqual(['documents[3].text.fields']);
    expect(notArray[0].message).toContain('需要欄位陣列，得到 object');
  });

  it('欄位值寫成數字（前導零會消失）、空字串、label 缺漏或重複', () => {
    const numeric = issuesAfter((input) => setAt(input.days[DAY3].data, [...PENDING, 'text', 'fields', 2, 'value'], 918));
    expect(fields(numeric)).toEqual(['documents[3].text.fields[2].value']);
    expect(numeric[0].message).toContain('前導零');
    const empty = issuesAfter((input) => setAt(input.days[DAY3].data, [...PENDING, 'text', 'fields', 2, 'value'], ''));
    expect(fields(empty)).toEqual(['documents[3].text.fields[2].value']);
    const noLabel = issuesAfter((input) => removeAt(input.days[DAY3].data, [...PENDING, 'text', 'fields', 1, 'label']));
    expect(fields(noLabel)).toEqual(['documents[3].text.fields[1].label']);
    const dupLabel = issuesAfter((input) => setAt(input.days[DAY3].data, [...PENDING, 'text', 'fields', 2, 'label'], '窗口狀態'));
    expect(fields(dupLabel)).toEqual(['documents[3].text.fields[2].label']);
    expect(dupLabel[0].message).toContain('label 窗口狀態 在同一文件內重複');
  });

  it('嚴格形狀：text 與欄位的多餘鍵、缺 heading、欄位不是物件', () => {
    const issues = issuesAfter((input) => {
      setAt(input.days[DAY3].data, [...PENDING, 'text', 'footer'], '頁尾');
      setAt(input.days[DAY3].data, [...PENDING, 'text', 'fields', 0, 'note'], '備註');
      removeAt(input.days[DAY3].data, [...PENDING, 'text', 'heading']);
      setAt(input.days[DAY3].data, [...PENDING, 'text', 'fields', 1], '窗口狀態');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'documents[3].text.footer',
        'documents[3].text.fields[0].note',
        'documents[3].text.heading',
        'documents[3].text.fields[1]',
      ]),
    );
    // text 本身允許 note（給內容編輯看）
    const note = issuesAfter((input) => setAt(input.days[DAY3].data, [...PENDING, 'text', 'note'], '內容備註'));
    expect(note.length).withContext(messages(note)).toBe(0);
  });

  it('未知的文件 kind 會列出 case-source', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY3].data, [...PENDING, 'kind'], 'memo'));
    expect(issues.some((i) => i.field === 'documents[3].kind' && i.message.includes('report／receipt／case-source'))).toBeTrue();
  });
});

describe('validateContent caseReview（R9）', () => {
  const set = (path: readonly (string | number)[], value: unknown) => (input: ContentInput) =>
    setAt(input.days[DAY3].data, [...CR, ...path], value);

  it('正式 Day 3 案件通過；caseReview 只在 task.day3.archive', () => {
    type Raw = { tasks: { id: string; caseReview?: { id: string } }[] };
    const withCase = CONTENT_SOURCES.days.flatMap((d) => (d.data as Raw).tasks).filter((t) => t.caseReview !== undefined);
    expect(withCase.map((t) => [t.id, t.caseReview?.id])).toEqual([['task.day3.archive', 'case.day3.h204']]);
  });

  it('找不到文件（變體文件不存在），未被引用的 pending 也會被指出', () => {
    const issues = issuesAfter(set(['receiptVariants', 1, 'documentId'], 'doc.day3.h204.missing'));
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents(['tasks[0].caseReview.receiptVariants[1].documentId', 'tasks[0].documentIds[3]']),
    );
    expect(messages(issues)).toContain('[case.day3.h204] tasks[0].caseReview.receiptVariants[1].documentId：找不到文件 doc.day3.h204.missing');
    expect(messages(issues)).toContain('case-source 文件 doc.day3.h204.pending 沒有被這項任務的 caseReview 引用');
  });

  it('引用的文件不是 case-source', () => {
    const issues = issuesAfter(set(['receiptVariants', 1, 'documentId'], 'doc.day2.receipt'));
    const own = issues.filter((i) => i.field === 'tasks[0].caseReview.receiptVariants[1].documentId');
    expect(own.length).toBe(1);
    expect(own[0].message).toContain('不是 case-source（是 receipt）');
  });

  it('引用的文件不在任務的 documentIds 內', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY3].data, ['tasks', 0, 'documentIds'], ['doc.day3.h204.registry', 'doc.day3.h204.supplement', 'doc.day3.h204.received']),
    );
    expect(issues.length).withContext(messages(issues)).toBe(1);
    expect(issues[0].field).toBe('tasks[0].caseReview.receiptVariants[1].documentId');
    expect(issues[0].message).toContain('必須列在同一任務的 documentIds 內');
  });

  it('引用的文件 recordIds 沒有包含案件紀錄', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY3].data, ['documents', 3, 'recordIds'], ['record.day3-h219']));
    expect(issues.length).withContext(messages(issues)).toBe(1);
    expect(issues[0].message).toContain('recordIds 必須包含案件紀錄 record.day3-h204');
  });

  it('recordId 不在任務的 recordIds 內', () => {
    const issues = issuesAfter((input) => {
      const task = (input.days[DAY3].data as { tasks: { recordIds: string[] }[] }).tasks[0];
      task.recordIds = task.recordIds.filter((id) => id !== 'record.day3-h204');
    });
    expect(issues.length).withContext(messages(issues)).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-03.json [case.day3.h204] tasks[0].caseReview.recordId：recordId record.day3-h204 必須列在同一任務的 recordIds 內',
    );
  });

  it('同一筆紀錄最多一個案件', () => {
    const issues = issuesAfter((input) => {
      const day = input.days[DAY3].data as { tasks: Record<string, unknown>[] };
      const copy = JSON.parse(JSON.stringify(day.tasks[0])) as Record<string, unknown> & { caseReview: { id: string } };
      copy['id'] = 'task.day3.archive-extra';
      copy['batchId'] = 'batch.day03.archive-extra';
      copy.caseReview.id = 'case.day3.h204-extra';
      day.tasks.push(copy);
    });
    expect(fields(issues)).toEqual(['tasks[1].caseReview.recordId']);
    expect(issues[0].message).toContain('已由案件 case.day3.h204 使用');
  });

  it('決定 ID 重複、含 .、空字串（Day 4 引用 review 的私訊也連帶找不到決定）', () => {
    /** 被改掉的 review 決定由 msg.day4.h204.review（messages[11]）引用。 */
    const both = ['tasks[0].caseReview.decisions[2].id', 'messages[11].unlock[0]'];
    const dup = issuesAfter(set(['decisions', 2, 'id'], 'registry'));
    expect(fields(dup)).toEqual(jasmine.arrayWithExactContents(both));
    expect(messages(dup)).toContain('決定 id registry 在同一案件內重複');
    expect(messages(dup)).toContain('案件 case.day3.h204 沒有決定 review');
    const dotted = issuesAfter(set(['decisions', 2, 'id'], 'send.review'));
    expect(fields(dotted)).toEqual(jasmine.arrayWithExactContents(both));
    expect(messages(dotted)).toContain('不得含');
    const empty = issuesAfter(set(['decisions', 2, 'id'], ''));
    expect(fields(empty)).toEqual(jasmine.arrayWithExactContents(both));
  });

  it('變體 ID 重複或含 .', () => {
    const dup = issuesAfter(set(['receiptVariants', 1, 'id'], 'received'));
    expect(fields(dup)).toEqual(['tasks[0].caseReview.receiptVariants[1].id']);
    expect(dup[0].message).toContain('變體 id received 在同一案件內重複');
    const dotted = issuesAfter(set(['receiptVariants', 1, 'id'], 'receipt.pending'));
    expect(fields(dotted)).toEqual(['tasks[0].caseReview.receiptVariants[1].id']);
  });

  it('依據文件不是兩份來源之一', () => {
    const issues = issuesAfter(set(['decisions', 0, 'basisDocumentId'], 'doc.day3.h204.received'));
    expect(fields(issues)).toEqual(['tasks[0].caseReview.decisions[0].basisDocumentId']);
    expect(issues[0].message).toContain('必須是 sourceDocumentIds 之一');
  });

  it('變體文件與來源重疊、或兩個變體共用文件', () => {
    const overlap = issuesAfter(set(['receiptVariants', 1, 'documentId'], 'doc.day3.h204.supplement'));
    expect(fields(overlap)).toEqual(
      jasmine.arrayWithExactContents(['tasks[0].caseReview.receiptVariants[1].documentId', 'tasks[0].documentIds[3]']),
    );
    expect(messages(overlap)).toContain('已是來源文件；變體只放佐證，不得與 sourceDocumentIds 重疊');
    const shared = issuesAfter(set(['receiptVariants', 1, 'documentId'], 'doc.day3.h204.received'));
    expect(fields(shared)).toEqual(
      jasmine.arrayWithExactContents(['tasks[0].caseReview.receiptVariants[1].documentId', 'tasks[0].documentIds[3]']),
    );
    expect(messages(shared)).toContain('變體文件 doc.day3.h204.received 重複');
  });

  it('變體少於兩個', () => {
    const issues = issuesAfter(set(['receiptVariants'], [{ id: 'received', documentId: 'doc.day3.h204.received' }]));
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['tasks[0].caseReview.receiptVariants', 'tasks[0].documentIds[3]']));
    expect(messages(issues)).toContain('收件狀態變體至少需要兩個，得到 1 個');
  });

  it('來源不是剛好兩份，或重複', () => {
    const one = issuesAfter(set(['sourceDocumentIds'], ['doc.day3.h204.registry']));
    expect(fields(one)).toEqual(
      jasmine.arrayWithExactContents([
        'tasks[0].caseReview.sourceDocumentIds',
        'tasks[0].caseReview.decisions[1].basisDocumentId',
        'tasks[0].documentIds[1]',
      ]),
    );
    expect(messages(one)).toContain('比對案件需要剛好兩份來源文件，得到 1 份');
    const dup = issuesAfter(set(['sourceDocumentIds'], ['doc.day3.h204.registry', 'doc.day3.h204.registry']));
    expect(fields(dup)).toContain('tasks[0].caseReview.sourceDocumentIds[1]');
    expect(messages(dup)).toContain('來源文件 doc.day3.h204.registry 重複');
  });

  it('archiveCode 不在依據文件的欄位值中，或寫成數字', () => {
    const outside = issuesAfter(set(['decisions', 1, 'archiveCode'], 'H-206'));
    expect(fields(outside)).toEqual(['tasks[0].caseReview.decisions[1].archiveCode']);
    expect(outside[0].message).toContain('archiveCode H-206 不在依據文件 doc.day3.h204.supplement 的欄位值中');
    // 另一份來源的值也不行：依據原表卻寫補件編號
    const crossed = issuesAfter(set(['decisions', 0, 'archiveCode'], 'H-205'));
    expect(fields(crossed)).toEqual(['tasks[0].caseReview.decisions[0].archiveCode']);
    const numeric = issuesAfter(set(['decisions', 0, 'archiveCode'], 204));
    expect(fields(numeric)).toEqual(['tasks[0].caseReview.decisions[0].archiveCode']);
    expect(numeric[0].message).toContain('前導零');
  });

  it('去向不在白名單、label／note 空白', () => {
    const issues = issuesAfter((input) => {
      set(['decisions', 0, 'destination'], 'queue')(input);
      set(['decisions', 1, 'label'], '')(input);
      removeAt(input.days[DAY3].data, [...CR, 'decisions', 2, 'note']);
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'tasks[0].caseReview.decisions[0].destination',
        'tasks[0].caseReview.decisions[1].label',
        'tasks[0].caseReview.decisions[2].note',
      ]),
    );
    expect(messages(issues)).toContain('destination 必須是 archive／review，得到 queue');
  });

  it('決定為空陣列、caseReview 不是物件（Day 4 三則私訊也連帶找不到決定／案件）', () => {
    const dms = ['messages[9].unlock[0]', 'messages[10].unlock[0]', 'messages[11].unlock[0]'];
    expect(fields(issuesAfter(set(['decisions'], [])))).toEqual(jasmine.arrayWithExactContents(['tasks[0].caseReview.decisions', ...dms]));
    const notObj = issuesAfter((input) => setAt(input.days[DAY3].data, [...CR], 'case.day3.h204'));
    expect(fields(notObj)).toEqual(
      jasmine.arrayWithExactContents([
        'tasks[0].caseReview',
        'tasks[0].documentIds[0]',
        'tasks[0].documentIds[1]',
        'tasks[0].documentIds[2]',
        'tasks[0].documentIds[3]',
        ...dms,
      ]),
    );
  });

  it('嚴格形狀：caseReview、變體與決定的多餘欄位', () => {
    const issues = issuesAfter((input) => {
      set(['note'], '內容備註')(input);
      set(['receiptVariants', 0, 'weight'], 1)(input);
      set(['decisions', 0, 'weight'], 1)(input);
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'tasks[0].caseReview.note',
        'tasks[0].caseReview.receiptVariants[0].weight',
        'tasks[0].caseReview.decisions[0].weight',
      ]),
    );
  });

  it('案件 ID 需要 case. 前綴與所屬日識別（改名後 Day 4 私訊的條件也找不到案件）', () => {
    const own = (issues: ContentIssue[]) => issues.filter((i) => i.field === 'tasks[0].caseReview.id');
    const others = (issues: ContentIssue[]) => issues.filter((i) => i.field !== 'tasks[0].caseReview.id');
    const noPrefix = issuesAfter(set(['id'], 'day3.h204'));
    expect(own(noPrefix).length).toBe(1);
    expect(own(noPrefix)[0].message).toContain('`case.` 開頭');
    const wrongDay = issuesAfter(set(['id'], 'case.day4.h204'));
    expect(own(wrongDay).length).toBe(1);
    expect(own(wrongDay)[0].message).toContain('day3');
    for (const issues of [noPrefix, wrongDay]) {
      expect(fields(others(issues))).toEqual(['messages[9].unlock[0]', 'messages[10].unlock[0]', 'messages[11].unlock[0]']);
      expect(others(issues).every((i) => i.message.startsWith('找不到案件 case.day3.h204'))).toBeTrue();
    }
  });

  it('只有 archive 任務可以有 caseReview', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['tasks', 0, 'caseReview'], { id: 'case.day2.x' }));
    expect(fields(issues)).toEqual(['tasks[0].caseReview']);
    expect(issues[0].message).toContain('只有 archive 任務可以有 caseReview（此任務是 reconcile）');
  });

  it('case-source 文件掛在沒有引用它的任務上', () => {
    const issues = issuesAfter((input) => pushAt(input.days[DAY4].data, ['tasks', 0, 'documentIds'], 'doc.day3.h204.registry'));
    expect(issues.length).withContext(messages(issues)).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-04.json [task.day4.archive] tasks[0].documentIds[0]：case-source 文件 doc.day3.h204.registry 沒有被這項任務的 caseReview 引用（需列在 sourceDocumentIds 或 receiptVariants）',
    );
  });
});

describe('validateContent 案件條件 cond.case.*（R9）', () => {
  /** Day 4 msg.day4.h204.registry。 */
  const H204_DM = ['messages', 9] as const;
  const unlockOf = (day: number, index: number, cond: string) => (input: ContentInput) =>
    setAt(input.days[day].data, ['messages', index, 'unlock'], [cond]);

  it('正式 Day 4 三則私訊各引用一個決定', () => {
    type Raw = { messages: { id: string; unlock: string[] }[] };
    const withCase = CONTENT_SOURCES.days
      .flatMap((d) => (d.data as Raw).messages)
      .filter((m) => m.unlock.some((c) => c.startsWith('cond.case.')))
      .map((m) => [m.id, m.unlock]);
    expect(withCase).toEqual([
      ['msg.day4.h204.registry', ['cond.case.day3.h204.registry']],
      ['msg.day4.h204.supplement', ['cond.case.day3.h204.supplement']],
      ['msg.day4.h204.review', ['cond.case.day3.h204.review']],
    ]);
  });

  it('找不到案件', () => {
    const issues = issuesAfter(unlockOf(DAY4, H204_DM[1], 'cond.case.day9.nope.registry'));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-04.json [msg.day4.h204.registry] messages[9].unlock[0]：找不到案件 case.day9.nope（案件條件只能引用 archive 任務 caseReview 的 id）',
    );
  });

  it('案件沒有這個決定', () => {
    const issues = issuesAfter(unlockOf(DAY4, H204_DM[1], 'cond.case.day3.h204.accept'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toBe('案件 case.day3.h204 沒有決定 accept（可用：registry、supplement、review）');
  });

  it('案件不早於訊息的 visibleFrom（同日或更早的訊息）', () => {
    const sameDay = issuesAfter(unlockOf(DAY3, 1, 'cond.case.day3.h204.registry'));
    expect(sameDay.length).toBe(1);
    expect(sameDay[0].id).toBe('msg.day3.dm-drafts');
    expect(sameDay[0].message).toContain('案件 case.day3.h204 屬於第 3 天，必須早於訊息的 visibleFrom（第 3 天）');
    const earlier = issuesAfter(unlockOf(DAY2, 0, 'cond.case.day3.h204.review'));
    expect(earlier.length).toBe(1);
    expect(earlier[0].message).toContain('（第 2 天）');
  });

  it('格式錯誤視為未知條件並提示格式', () => {
    const issues = issuesAfter(unlockOf(DAY4, H204_DM[1], 'cond.case.day3'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('未知的條件 ID cond.case.day3');
    expect(issues[0].message).toContain('cond.case.<case ID 去掉 case.>.<decision ID>');
  });
});

describe('validateContent ui 的 R9 區塊（caseReview／windowShell／executionLog）', () => {
  it('缺欄位、空字串、多餘欄位與巢狀型別錯誤', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['caseReview', 'instruction']);
      setAt(input.ui.data, ['caseReview', 'destination'], '窗口待查');
      setAt(input.ui.data, ['caseReview', 'recommended'], '建議');
      removeAt(input.ui.data, ['windowShell', 'history', 'hide']);
      setAt(input.ui.data, ['windowShell', 'history', 'show'], '');
      setAt(input.ui.data, ['windowShell', 'close'], '關閉');
      removeAt(input.ui.data, ['executionLog', 'key', 'basis']);
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'caseReview.instruction',
        'caseReview.destination',
        'caseReview.recommended',
        'windowShell.history.hide',
        'windowShell.history.show',
        'windowShell.close',
        'executionLog.key.basis',
      ]),
    );
    expect(issues.every((i) => i.file === 'data/ui.zh-Hant.json')).toBeTrue();
  });

  it('整個區塊缺少', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['caseReview']);
      removeAt(input.ui.data, ['windowShell']);
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['caseReview', 'windowShell']));
  });

  it('markedCountTemplate 需要 {count}', () => {
    const issues = issuesAfter((input) => setAt(input.ui.data, ['caseReview', 'markedCountTemplate'], '已標記差異'));
    expect(fields(issues)).toEqual(['caseReview.markedCountTemplate']);
    expect(issues[0].message).toContain('缺少必要的 placeholder {count}');
  });
});

describe('validateContent 下游稽核 returnAudit 與錯誤文件處理 return-review（R10／R11）', () => {
  /** Day 2 task.day2.reconcile 的 returnAudit、Day 4 task.day4.return-review。 */
  const AUDIT = ['tasks', 0, 'returnAudit'] as const;
  const REVIEW = ['tasks', 1] as const;
  const DAY5 = 4;
  const setAudit = (key: string, value: unknown) => (input: ContentInput) => setAt(input.days[DAY2].data, [...AUDIT, key], value);
  const setReview = (key: string, value: unknown) => (input: ContentInput) => setAt(input.days[DAY4].data, [...REVIEW, key], value);
  /** 把 Day 4 的複審任務搬到另一天（改 ID），稽核的 reviewTaskId 跟著指過去。 */
  const moveReview = (dayIndex: number, n: number) => (input: ContentInput) => {
    const review = containerAt(input.days[DAY4].data, ['tasks']) as unknown as unknown[];
    const [task] = review.splice(1, 1) as Record<string, unknown>[];
    task['id'] = `task.day${n}.return-review`;
    pushAt(input.days[dayIndex].data, ['tasks'], task);
    setAudit('reviewTaskId', `task.day${n}.return-review`)(input);
  };

  it('正式資料：Day 2 核對定義 day1-code-audit（通知 Day 3、案號 RT-{key}、參照 Day 4 複審），Day 4 複審任務在原歸檔之後', () => {
    type Raw = { tasks: { id: string; kind: string; returnAudit?: unknown; auditId?: unknown; recordIds: unknown[]; documentIds: unknown[] }[] };
    const day2 = CONTENT_SOURCES.days[DAY2].data as Raw;
    const day4 = CONTENT_SOURCES.days[DAY4].data as Raw;
    expect(day2.tasks[0].returnAudit).toEqual({
      id: 'day1-code-audit',
      notifyDayId: 'day.03',
      reviewTaskId: 'task.day4.return-review',
      caseNumberTemplate: 'RT-{key}',
    });
    expect(day4.tasks.map((t) => `${t.kind}:${t.id}`)).toEqual(['archive:task.day4.archive', 'return-review:task.day4.return-review']);
    expect([day4.tasks[1].auditId, day4.tasks[1].recordIds, day4.tasks[1].documentIds]).toEqual(['day1-code-audit', [], []]);
    expect(validateContent(CONTENT_SOURCES).length).toBe(0);
  });

  it('一天不能只有退件複審（沒有到期案件時當天會沒有工作）', () => {
    const issues = issuesAfter((input) => {
      const day4 = input.days[DAY4].data as { tasks: unknown[] };
      day4.tasks = day4.tasks.slice(1);
    });
    expect(messages(issues)).toContain('非 return-review');
  });

  it('通知日不晚於核對日（同日或更早）；通知日本身有錯時不再連帶判斷 reviewTaskId 的日序', () => {
    for (const [dayId, n] of [['day.02', 2], ['day.01', 1]] as const) {
      const issues = issuesAfter(setAudit('notifyDayId', dayId));
      expect(issues.length).withContext(messages(issues)).toBe(1);
      expect(describeIssue(issues[0])).toBe(
        `data/days/day-02.json [task.day2.reconcile] tasks[0].returnAudit.notifyDayId：通知日 ${dayId}（第 ${n} 天）必須晚於核對任務所屬日（第 2 天）；退件在第二輪放行後才延後通知`,
      );
    }
  });

  it('通知日指向不存在的日、缺少或型別錯誤', () => {
    const unknown = issuesAfter(setAudit('notifyDayId', 'day.09'));
    expect(fields(unknown)).toEqual(['tasks[0].returnAudit.notifyDayId']);
    expect(unknown[0].message).toContain('找不到日別 day.09');
    const missing = issuesAfter((input) => removeAt(input.days[DAY2].data, [...AUDIT, 'notifyDayId']));
    expect(fields(missing)).toEqual(['tasks[0].returnAudit.notifyDayId']);
    expect(missing[0].message).toContain('缺少必要欄位 notifyDayId');
  });

  it('R11：reviewTaskId 與 return-review 的 auditId 都可省略（兩者皆省略、或只省略 auditId）', () => {
    const both = issuesAfter((input) => {
      removeAt(input.days[DAY2].data, [...AUDIT, 'reviewTaskId']);
      removeAt(input.days[DAY4].data, [...REVIEW, 'auditId']);
    });
    expect(both.length).withContext(messages(both)).toBe(0);
    const auditIdOnly = issuesAfter((input) => removeAt(input.days[DAY4].data, [...REVIEW, 'auditId']));
    expect(auditIdOnly.length).withContext(messages(auditIdOnly)).toBe(0);
  });

  it('R11：只省略 reviewTaskId 時，仍帶 auditId 的複審任務會被指出（有填時必須互相指回）', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY2].data, [...AUDIT, 'reviewTaskId']));
    expect(issues.map(describeIssue)).toEqual([
      'data/days/day-04.json [task.day4.return-review] tasks[1].auditId：稽核 day1-code-audit 沒有 reviewTaskId 指回這項任務；請在稽核補上 reviewTaskId，或省略這裡的 auditId',
    ]);
  });

  it('複審任務的 kind 不對（指向 Day 4 歸檔）；Day 4 複審任務也因稽核不指回它而被指出', () => {
    const issues = issuesAfter(setAudit('reviewTaskId', 'task.day4.archive'));
    expect(issues.map(describeIssue)).toEqual(
      jasmine.arrayWithExactContents([
        'data/days/day-02.json [task.day2.reconcile] tasks[0].returnAudit.reviewTaskId：複審任務 task.day4.archive 必須是 return-review（是 archive）',
        'data/days/day-04.json [task.day4.return-review] tasks[1].auditId：稽核 day1-code-audit 的 reviewTaskId 是 task.day4.archive，不是這項任務；每個稽核最多對應一項複審任務',
      ]),
    );
  });

  it('複審任務不存在', () => {
    const issues = issuesAfter(setAudit('reviewTaskId', 'task.day4.nope'));
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['tasks[0].returnAudit.reviewTaskId', 'tasks[1].auditId']));
    expect(issues.find((i) => i.file === 'data/days/day-02.json')?.message).toBe('找不到複審任務 task.day4.nope');
  });

  it('複審任務的 auditId 與稽核不一致', () => {
    const issues = issuesAfter(setReview('auditId', 'other-audit'));
    expect(issues.map(describeIssue)).toEqual(
      jasmine.arrayWithExactContents([
        'data/days/day-02.json [task.day2.reconcile] tasks[0].returnAudit.reviewTaskId：複審任務 task.day4.return-review 的 auditId 是 other-audit，與稽核 day1-code-audit 不一致',
        'data/days/day-04.json [task.day4.return-review] tasks[1].auditId：找不到退件稽核 other-audit（需在 reconcile 任務的 returnAudit 定義）',
      ]),
    );
  });

  it('R11：reviewTaskId 必須位於通知日的下一工作日（通知改到 Day 5 → 應為 Day 6）；Day 3 的退件訊息也早於通知日', () => {
    const issues = issuesAfter(setAudit('notifyDayId', 'day.05'));
    expect(issues.map(describeIssue)).toEqual(
      jasmine.arrayWithExactContents([
        'data/days/day-02.json [task.day2.reconcile] tasks[0].returnAudit.reviewTaskId：複審任務 task.day4.return-review 屬於第 4 天；案件在通知日 day.05 的下一工作日 day.06（第 6 天）排入錯誤文件處理，reviewTaskId 只能指向那一天的 return-review 任務（或省略）',
        'data/days/day-03.json [msg.day3.return-code-audit] messages[6].unlock[0]：稽核 day1-code-audit 的通知日是 day.05（第 5 天），晚於訊息的 visibleFrom（第 3 天）；請把訊息放在通知日或之後',
      ]),
    );
  });

  it('R11：複審任務與通知同日（Day 3）或晚於下一工作日（Day 5）都不合法：案件在 Day 4 才排入', () => {
    for (const [dayIndex, n] of [[DAY3, 3], [DAY5, 5]] as const) {
      const issues = issuesAfter(moveReview(dayIndex, n));
      expect(issues.map(describeIssue)).withContext(String(n)).toEqual([
        `data/days/day-02.json [task.day2.reconcile] tasks[0].returnAudit.reviewTaskId：複審任務 task.day${n}.return-review 屬於第 ${n} 天；案件在通知日 day.03 的下一工作日 day.04（第 4 天）排入錯誤文件處理，reviewTaskId 只能指向那一天的 return-review 任務（或省略）`,
      ]);
    }
  });

  it('R11：通知日是最後一日時不得有 reviewTaskId（沒有下一工作日；案件留在文件問題清單）', () => {
    const issues = issuesAfter(setAudit('notifyDayId', 'day.06'));
    expect(issues.map(describeIssue)).toEqual(
      jasmine.arrayWithExactContents([
        'data/days/day-02.json [task.day2.reconcile] tasks[0].returnAudit.reviewTaskId：通知日 day.06 是最後一日，沒有下一工作日可以排入錯誤文件處理；請省略 reviewTaskId',
        'data/days/day-03.json [msg.day3.return-code-audit] messages[6].unlock[0]：稽核 day1-code-audit 的通知日是 day.06（第 6 天），晚於訊息的 visibleFrom（第 3 天）；請把訊息放在通知日或之後',
      ]),
    );
    const omitted = issuesAfter((input) => {
      setAudit('notifyDayId', 'day.06')(input);
      removeAt(input.days[DAY2].data, [...AUDIT, 'reviewTaskId']);
      removeAt(input.days[DAY4].data, [...REVIEW, 'auditId']);
    });
    expect(fields(omitted)).toEqual(['messages[6].unlock[0]']);
  });

  it('稽核 id 格式、重複與多餘欄位（重複的稽核連案號樣板也重複）', () => {
    const dotted = issuesAfter(setAudit('id', 'day1.code-audit'));
    expect(fields(dotted)).toContain('tasks[0].returnAudit.id');
    expect(messages(dotted)).toContain('不得含 `.`');
    const extra = issuesAfter(setAudit('reviewDayId', 'day.04'));
    expect(fields(extra)).toEqual(['tasks[0].returnAudit.reviewDayId']);
    expect(extra[0].message).toContain('只允許 id、notifyDayId、reviewTaskId、caseNumberTemplate');
    const notObj = issuesAfter((input) => setAt(input.days[DAY2].data, [...AUDIT], 'day1-code-audit'));
    expect(fields(notObj)).toEqual(jasmine.arrayWithExactContents(['tasks[0].returnAudit', 'tasks[1].auditId', 'messages[6].unlock[0]']));
    const duplicated = issuesAfter((input) => {
      const t = JSON.parse(JSON.stringify(containerAt(input.days[DAY2].data, ['tasks', 0]))) as Record<string, unknown>;
      t['id'] = 'task.day2.reconcile-again';
      pushAt(input.days[DAY2].data, ['tasks'], t);
    });
    expect(fields(duplicated)).toEqual(['tasks[2].returnAudit.id', 'tasks[2].returnAudit.caseNumberTemplate']);
    expect(duplicated[0].message).toContain('稽核 id day1-code-audit 重複，已由 task.day2.reconcile 定義');
  });

  it('reviewTaskId 型別錯誤或不是 task. 前綴（格式錯誤只報一次，不連帶判斷指回）', () => {
    const noPrefix = issuesAfter(setAudit('reviewTaskId', 'day4.return-review'));
    expect(fields(noPrefix)).toEqual(['tasks[0].returnAudit.reviewTaskId']);
    expect(messages(noPrefix)).toContain('ID 必須以 `task.` 開頭');
    for (const bad of ['', 4, null]) {
      const issues = issuesAfter(setAudit('reviewTaskId', bad));
      expect(fields(issues)).withContext(String(bad)).toEqual(['tasks[0].returnAudit.reviewTaskId']);
      expect(issues[0].message).withContext(String(bad)).toContain('reviewTaskId 可省略；有填時必須是任務 ID 字串');
    }
  });

  it('R11：caseNumberTemplate 必填、只能且必須用 {key}', () => {
    const missing = issuesAfter((input) => removeAt(input.days[DAY2].data, [...AUDIT, 'caseNumberTemplate']));
    expect(missing.map(describeIssue)).toEqual([
      'data/days/day-02.json [task.day2.reconcile] tasks[0].returnAudit.caseNumberTemplate：缺少必要欄位 caseNumberTemplate（案號樣板，例如 RT-{key}），得到 undefined',
    ]);
    const notString = issuesAfter(setAudit('caseNumberTemplate', 7));
    expect(fields(notString)).toEqual(['tasks[0].returnAudit.caseNumberTemplate']);
    const empty = issuesAfter(setAudit('caseNumberTemplate', ''));
    expect(fields(empty)).toEqual(['tasks[0].returnAudit.caseNumberTemplate', 'tasks[0].returnAudit.caseNumberTemplate']);
    expect(messages(empty)).toContain('得到 空字串');
    const noKey = issuesAfter(setAudit('caseNumberTemplate', 'RT-B102'));
    expect(fields(noKey)).toEqual(['tasks[0].returnAudit.caseNumberTemplate']);
    expect(noKey[0].message).toBe('缺少必要的 placeholder {key}');
    const unknown = issuesAfter(setAudit('caseNumberTemplate', 'RT-{key}-{day}'));
    expect(fields(unknown)).toEqual(['tasks[0].returnAudit.caseNumberTemplate']);
    expect(unknown[0].message).toContain('未知的 placeholder {day}');
  });

  it('R11：不同稽核不得共用案號樣板（另一個稽核用自己的樣板則合法）', () => {
    const addAudit = (template: string) => (input: ContentInput) => {
      const t = JSON.parse(JSON.stringify(containerAt(input.days[DAY2].data, ['tasks', 0]))) as Record<string, unknown>;
      t['id'] = 'task.day2.reconcile-again';
      t['returnAudit'] = { id: 'day1-code-audit-2', notifyDayId: 'day.04', caseNumberTemplate: template };
      pushAt(input.days[DAY2].data, ['tasks'], t);
    };
    const same = issuesAfter(addAudit('RT-{key}'));
    expect(same.map(describeIssue)).toEqual([
      'data/days/day-02.json [task.day2.reconcile-again] tasks[2].returnAudit.caseNumberTemplate：案號樣板 RT-{key} 已由稽核 day1-code-audit 使用；同一筆紀錄在不同稽核會撞號',
    ]);
    const own = issuesAfter(addAudit('RT2-{key}'));
    expect(own.length).withContext(messages(own)).toBe(0);
  });

  it('只有 reconcile 任務可以有 returnAudit；只有 return-review 任務使用 auditId', () => {
    const onArchive = issuesAfter((input) =>
      setAt(input.days[DAY1].data, ['tasks', 0, 'returnAudit'], { id: 'x-audit', notifyDayId: 'day.03', caseNumberTemplate: 'X-{key}' }),
    );
    expect(fields(onArchive)).toEqual(['tasks[0].returnAudit']);
    expect(onArchive[0].message).toContain('只有 reconcile 任務可以有 returnAudit（此任務是 archive）');
    const auditOnArchive = issuesAfter((input) => setAt(input.days[DAY4].data, ['tasks', 0, 'auditId'], 'day1-code-audit'));
    expect(fields(auditOnArchive)).toEqual(['tasks[0].auditId']);
    expect(auditOnArchive[0].message).toContain('只有 return-review 任務使用 auditId（此任務是 archive）');
  });

  it('return-review 的 recordIds／documentIds 必須是空陣列', () => {
    const records = issuesAfter(setReview('recordIds', ['record.b102']));
    expect(records.length).withContext(messages(records)).toBe(1);
    expect(describeIssue(records[0])).toBe(
      'data/days/day-04.json [task.day4.return-review] tasks[1].recordIds：return-review 任務的 recordIds 必須是空陣列：處理對象是存檔排入當日的文件問題案件（得到 1 項）',
    );
    const documents = issuesAfter(setReview('documentIds', ['doc.day2.receipt']));
    expect(fields(documents)).toEqual(['tasks[1].documentIds']);
    const notArray = issuesAfter(setReview('recordIds', 'record.b102'));
    expect(fields(notArray)).toEqual(['tasks[1].recordIds']);
    expect(notArray[0].message).toContain('需要紀錄 ID 陣列（空陣列）');
  });

  it('return-review 引用不存在的稽核（另一天多一項複審任務）', () => {
    const issues = issuesAfter((input) =>
      pushAt(input.days[DAY5].data, ['tasks'], {
        id: 'task.day5.return-review',
        kind: 'return-review',
        auditId: 'nope-audit',
        recordIds: [],
        documentIds: [],
        text: { eyebrow: 'RETURN / REVIEW 05' },
      }),
    );
    expect(issues.length).withContext(messages(issues)).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-05.json [task.day5.return-review] tasks[1].auditId：找不到退件稽核 nope-audit（需在 reconcile 任務的 returnAudit 定義）',
    );
  });

  it('R11：其他日可以再定義不帶 auditId 的 return-review（當日的錯誤文件處理位置）', () => {
    const issues = issuesAfter((input) =>
      pushAt(input.days[DAY5].data, ['tasks'], {
        id: 'task.day5.return-review',
        kind: 'return-review',
        recordIds: [],
        documentIds: [],
        text: { eyebrow: 'RETURN / REVIEW 05' },
      }),
    );
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('同一稽核的第二項複審任務會被指出（每個稽核最多對應一項）', () => {
    const issues = issuesAfter((input) => {
      const t = JSON.parse(JSON.stringify(containerAt(input.days[DAY4].data, [...REVIEW]))) as Record<string, unknown>;
      t['id'] = 'task.day5.return-review';
      pushAt(input.days[DAY5].data, ['tasks'], t);
    });
    expect(fields(issues)).toEqual(['tasks[1].auditId']);
    expect(issues[0].file).toBe('data/days/day-05.json');
    expect(issues[0].message).toContain('reviewTaskId 是 task.day4.return-review，不是這項任務');
  });

  it('R11：每日最多一項 return-review（錯誤文件處理每天只有一個位置）', () => {
    const issues = issuesAfter((input) =>
      pushAt(input.days[DAY4].data, ['tasks'], {
        id: 'task.day4.return-review-again',
        kind: 'return-review',
        recordIds: [],
        documentIds: [],
        text: { eyebrow: 'RETURN / REVIEW 04B' },
      }),
    );
    expect(issues.map(describeIssue)).toEqual([
      'data/days/day-04.json [task.day4.return-review-again] tasks[2].kind：每日最多一項 return-review 任務（錯誤文件處理每天只有一個位置，已有 tasks[1]）',
    ]);
  });

  it('R11：task.day<N>.return-review 保留給當日的 return-review，其他 kind 不得使用', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY5].data, ['tasks', 0, 'id'], 'task.day5.return-review'));
    expect(issues.map(describeIssue)).toEqual([
      'data/days/day-05.json [task.day5.return-review] tasks[0].id：任務 ID task.day5.return-review 保留給當日的錯誤文件處理（return-review；沒有內容定義時由狀態層以此 ID 插入），archive 任務請改用別的 ID',
    ]);
    // 別日的保留 ID 不受限（ID 仍須含所屬日識別，由既有規則擋下）
    expect(issueTaskId(4)).toBe('task.day4.return-review');
  });

  it('return-review 的 auditId 型別錯誤、帶批次欄位、text 放 heading（共用 ui.documentIssues）', () => {
    for (const bad of ['', 3]) {
      const issues = issuesAfter(setReview('auditId', bad));
      expect(fields(issues)).withContext(String(bad)).toEqual(['tasks[1].auditId']);
      expect(issues[0].message).withContext(String(bad)).toContain('auditId 可省略；有填時必須是稽核 ID 字串');
    }
    const batch = issuesAfter(setReview('batchId', 'batch.day04.return'));
    expect(fields(batch)).toEqual(['tasks[1].batchId']);
    const heading = issuesAfter((input) => setAt(input.days[DAY4].data, [...REVIEW, 'text', 'heading'], '錯誤文件處理'));
    expect(fields(heading)).toEqual(['tasks[1].text.heading']);
    expect(heading[0].message).toContain('共用 ui.zh-Hant.json 的 documentIssues（taskHeading／taskInstruction）');
    const noEyebrow = issuesAfter((input) => removeAt(input.days[DAY4].data, [...REVIEW, 'text', 'eyebrow']));
    expect(fields(noEyebrow)).toEqual(['tasks[1].text.eyebrow']);
  });

  it('return-review 任務 ID 也要含所屬日識別', () => {
    const issues = issuesAfter((input) => {
      setReview('id', 'task.day5.return-review')(input);
      setAudit('reviewTaskId', 'task.day5.return-review')(input);
    });
    expect(fields(issues)).toEqual(['tasks[1].id']);
    expect(issues[0].message).toContain('day4');
  });
});

describe('validateContent 退件條件 cond.return.notified.*（R10）', () => {
  /** Day 3 msg.day3.return-code-audit（附加在 messages 最後）。 */
  const RETURN_MSG = ['messages', 6] as const;
  const unlockOf = (cond: string) => (input: ContentInput) => setAt(input.days[DAY3].data, [...RETURN_MSG, 'unlock'], [cond]);

  it('正式資料：只有 Day 3 的退件訊息引用 day1-code-audit', () => {
    type Raw = { messages: { id: string; unlock: string[] }[] };
    const withReturn = CONTENT_SOURCES.days
      .flatMap((d) => (d.data as Raw).messages)
      .filter((m) => m.unlock.some((c) => c.startsWith('cond.return.')))
      .map((m) => [m.id, m.unlock]);
    expect(withReturn).toEqual([['msg.day3.return-code-audit', ['cond.return.notified.day1-code-audit']]]);
    expect(containerAt(CONTENT_SOURCES.days[DAY3].data, [...RETURN_MSG])['id']).toBe('msg.day3.return-code-audit');
  });

  it('引用不存在的稽核', () => {
    const issues = issuesAfter(unlockOf('cond.return.notified.day9-audit'));
    expect(issues.length).toBe(1);
    expect(describeIssue(issues[0])).toBe(
      'data/days/day-03.json [msg.day3.return-code-audit] messages[6].unlock[0]：找不到退件稽核 day9-audit（退件條件只能引用 reconcile 任務 returnAudit 的 id）',
    );
  });

  it('訊息的 visibleFrom 早於通知日（Day 2 的訊息引用 Day 3 才通知的稽核）', () => {
    const issues = issuesAfter((input) =>
      pushAt(input.days[DAY2].data, ['messages'], {
        id: 'msg.day2.return-early',
        channelId: 'channel.dm.lin-yuan',
        actorId: 'actor.lin-yuan',
        time: '09:00',
        visibleFrom: 'day.02',
        unlock: ['cond.return.notified.day1-code-audit'],
        lines: ['範例：通知日前不該出現。'],
      }),
    );
    expect(issues.length).withContext(messages(issues)).toBe(1);
    expect(issues[0].id).toBe('msg.day2.return-early');
    expect(issues[0].message).toContain('稽核 day1-code-audit 的通知日是 day.03（第 3 天），晚於訊息的 visibleFrom（第 2 天）');
  });

  it('通知日之後的訊息也可以引用（跨日仍依已保存的退件成立）', () => {
    const issues = issuesAfter((input) =>
      pushAt(input.days[4].data, ['messages'], {
        id: 'msg.day5.return-later',
        channelId: 'channel.dm.lin-yuan',
        actorId: 'actor.lin-yuan',
        time: '09:00',
        visibleFrom: 'day.05',
        unlock: ['cond.return.notified.day1-code-audit'],
        lines: ['範例：通知後的後續。'],
      }),
    );
    expect(issues.length).withContext(messages(issues)).toBe(0);
  });

  it('格式錯誤視為未知條件並提示格式', () => {
    for (const bad of ['cond.return.notified.', 'cond.return.notified.Day1-audit', 'cond.return.day1-code-audit']) {
      const issues = issuesAfter(unlockOf(bad));
      expect(issues.length).withContext(bad).toBe(1);
      expect(issues[0].message).toContain(`未知的條件 ID ${bad}`);
      expect(issues[0].message).toContain('退件條件格式為 cond.return.notified.<audit ID>');
    }
  });
});

describe('validateContent ui 的 R10 區塊（operation／windows／recordReview／returnedReview 與新增欄位）', () => {
  it('缺欄位、空字串、多餘欄位', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['operation', 'validated']);
      setAt(input.ui.data, ['windows', 'openLog'], '');
      setAt(input.ui.data, ['windows', 'resetLayout'], '重設視窗位置');
      setAt(input.ui.data, ['recordReview', 'approve'], '核准');
      removeAt(input.ui.data, ['returnedReview', 'codeMismatch']);
      removeAt(input.ui.data, ['fieldMap', 'convertError']);
      removeAt(input.ui.data, ['caseReview', 'codeInputLabel']);
      removeAt(input.ui.data, ['tasks', 'kind', 'return-review']);
      removeAt(input.ui.data, ['executionLog', 'command', 'returnReview']);
      removeAt(input.ui.data, ['executionLog', 'command', 'recordReview']);
      setAt(input.ui.data, ['executionLog', 'key', 'source'], '');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'operation.validated',
        'windows.openLog',
        'windows.resetLayout',
        'recordReview.approve',
        'returnedReview.codeMismatch',
        'fieldMap.convertError',
        'caseReview.codeInputLabel',
        'tasks.kind.return-review',
        'executionLog.command.returnReview',
        'executionLog.command.recordReview',
        'executionLog.key.source',
      ]),
    );
    expect(issues.every((i) => i.file === 'data/ui.zh-Hant.json')).toBeTrue();
  });

  it('整個區塊缺少', () => {
    const issues = issuesAfter((input) => {
      for (const key of ['operation', 'windows', 'recordReview', 'returnedReview']) removeAt(input.ui.data, [key]);
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['operation', 'windows', 'recordReview', 'returnedReview']));
  });

  it('R11：來源編號帶入已移除——archive.useCode／caseReview.useDocumentTemplate 殘留會被指出並提示', () => {
    const issues = issuesAfter((input) => {
      setAt(input.ui.data, ['archive', 'useCode'], '使用來源編號');
      setAt(input.ui.data, ['caseReview', 'useDocumentTemplate'], '帶入{heading}');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents(['archive.useCode', 'caseReview.useDocumentTemplate', 'caseReview.useDocumentTemplate']),
    );
    expect(issues.find((i) => i.field === 'archive.useCode')?.message).toBe(
      '不在此區塊 shape 內的欄位：useCode 已移除（R11）：編號由玩家自行輸入，不提供來源編號帶入',
    );
    expect(messages(issues)).toContain('未知的樣板欄位 useDocumentTemplate');
  });
});

describe('validateContent ui 的 R11 區塊（documentIssues）', () => {
  it('正式資料：documentIssues 區塊通過嚴格 shape（R12 起沒有 workbench.nav.issues）', () => {
    const ui = CONTENT_SOURCES.ui.data as { workbench: { nav: Record<string, string> }; documentIssues: Record<string, unknown> };
    expect(ui.workbench.nav['issues']).toBeUndefined();
    expect(ui.documentIssues['taskHeading']).toBe('錯誤文件處理');
    expect(validateContent(CONTENT_SOURCES).length).toBe(0);
  });

  it('documentIssues 缺欄位、空字串、巢狀型別錯誤、多餘欄位（含巢狀層與 R12 移除的「文件問題」頁字串）', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['documentIssues', 'close']);
      setAt(input.ui.data, ['documentIssues', 'sections', 'versions'], '');
      setAt(input.ui.data, ['documentIssues', 'status'], '待修正');
      removeAt(input.ui.data, ['documentIssues', 'outcome', 'returned']);
      removeAt(input.ui.data, ['documentIssues', 'receipts', 'resolvedNote']);
      setAt(input.ui.data, ['documentIssues', 'heading'], '文件問題');
      setAt(input.ui.data, ['documentIssues', 'receipts', 'unreadLabel'], '未讀');
      setAt(input.ui.data, ['documentIssues', 'next', 'correct'], '改成來源編號');
      setAt(input.ui.data, ['documentIssues', 'reason'], '編號不一致');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'documentIssues.close',
        'documentIssues.sections.versions',
        'documentIssues.status',
        'documentIssues.outcome.returned',
        'documentIssues.receipts.resolvedNote',
        'documentIssues.heading',
        'documentIssues.receipts.unreadLabel',
        'documentIssues.next.correct',
        'documentIssues.reason',
      ]),
    );
    expect(issues.every((i) => i.file === 'data/ui.zh-Hant.json')).toBeTrue();
  });

  it('整個 documentIssues 區塊缺少', () => {
    const issues = issuesAfter((input) => removeAt(input.ui.data, ['documentIssues']));
    expect(fields(issues)).toEqual(['documentIssues']);
  });

  it('樣板 placeholder：第幾次送件、案號與來源工作都只接受登記的名稱', () => {
    const cases: [readonly (string | number)[], string, string][] = [
      [['submissionTemplate'], '第 {number}／{index} 次送件', '未知的 placeholder {index}'],
      [['submissionTemplate'], '再次送件', '缺少必要的 placeholder {number}'],
      [['sourceTaskTemplate'], '第{dayName}日', '缺少必要的 placeholder {task}'],
      [['receipts', 'returnedTemplate'], '退件回條：{caseNumber}（{key}）', '未知的 placeholder {key}'],
      [['receipts', 'resolvedTemplate'], '收件回條', '缺少必要的 placeholder {caseNumber}'],
    ];
    for (const [path, value, message] of cases) {
      const issues = issuesAfter((input) => setAt(input.ui.data, ['documentIssues', ...path], value));
      const field = ['documentIssues', ...path].join('.');
      expect(fields(issues)).withContext(field).toEqual([field]);
      expect(issues[0].message).withContext(field).toContain(message);
    }
  });

  it('非樣板欄位不得出現 {…}', () => {
    const issues = issuesAfter((input) => setAt(input.ui.data, ['documentIssues', 'next', 'windowWaiting'], '等待{window}'));
    expect(fields(issues)).toEqual(['documentIssues.next.windowWaiting']);
    expect(issues[0].message).toContain('只有 *Template 欄位可以使用');
  });
});

/* ---------- R12：桌面、郵件、入職與詢問說明 ---------- */

describe('validateContent ui 的 R12 區塊（desktop／workbench／messages／documentIssues.task）', () => {
  it('正式資料：desktop 與新增欄位通過；workbench 只剩單組導航與身分區', () => {
    const ui = CONTENT_SOURCES.ui.data as {
      workbench: Record<string, unknown> & { nav: Record<string, string> };
      desktop: Record<string, unknown>;
    };
    expect(Object.keys(ui.workbench.nav).sort()).toEqual(['mail', 'messages', 'news', 'work']);
    expect(ui.workbench['navGroupPersonal']).toBeUndefined();
    expect(ui.workbench['navGroupTeam']).toBeUndefined();
    expect(ui.workbench['team']).toBe('資料作業組');
    expect(ui.workbench['role']).toBeUndefined();
    expect(ui.workbench['backToCover']).toBeUndefined();
    expect(ui.desktop['docTitle']).toBe('桌面');
    expect(validateContent(CONTENT_SOURCES).length).toBe(0);
  });

  it('workbench 殘留 R12 移除的欄位會被指出並提示改法', () => {
    const issues = issuesAfter((input) => {
      setAt(input.ui.data, ['workbench', 'navGroupPersonal'], '個人工作區');
      setAt(input.ui.data, ['workbench', 'navGroupTeam'], '資料作業組');
      setAt(input.ui.data, ['workbench', 'nav', 'issues'], '文件問題');
      setAt(input.ui.data, ['workbench', 'role'], '新進同仁 · E 級');
      setAt(input.ui.data, ['workbench', 'backToCover'], '返回開始頁');
      setAt(input.ui.data, ['workbench', 'heading', 'messages'], '同事訊息');
    });
    expect(fields(issues)).toEqual([
      'workbench.navGroupPersonal',
      'workbench.navGroupTeam',
      'workbench.nav.issues',
      'workbench.role',
      'workbench.backToCover',
      'workbench.heading.messages',
    ]);
    expect(issues[0].message).toContain('workbench.team');
    expect(issues[2].message).toContain('workbench.nav.mail');
    expect(issues[3].message).toContain('workbench.team');
    expect(issues[4].message).toContain('desktop.menu.backToCover');
    expect(issues[5].message).toContain('heading.news');
  });

  it('缺 workbench.nav.mail／team／identityLabel、messages.newBelow／newBelowAria、documentIssues.task.openMail', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['workbench', 'nav', 'mail']);
      removeAt(input.ui.data, ['workbench', 'team']);
      removeAt(input.ui.data, ['workbench', 'identityLabel']);
      removeAt(input.ui.data, ['messages', 'newBelow']);
      setAt(input.ui.data, ['messages', 'newBelowAria'], '');
      removeAt(input.ui.data, ['documentIssues', 'task', 'openMail']);
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'workbench.nav.mail',
        'workbench.team',
        'workbench.identityLabel',
        'messages.newBelow',
        'messages.newBelowAria',
        'documentIssues.task.openMail',
      ]),
    );
  });

  it('desktop 為嚴格 shape：缺欄位、巢狀型別錯誤、多餘欄位、整塊缺少', () => {
    const issues = issuesAfter((input) => {
      removeAt(input.ui.data, ['desktop', 'statusLabel']);
      setAt(input.ui.data, ['desktop', 'apps'], '工作平台');
      removeAt(input.ui.data, ['desktop', 'menu', 'resetLayout']);
      setAt(input.ui.data, ['desktop', 'menu', 'settings'], '設定');
      setAt(input.ui.data, ['desktop', 'wallpaper'], '桌布');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'desktop.statusLabel',
        'desktop.apps',
        'desktop.menu.resetLayout',
        'desktop.menu.settings',
        'desktop.wallpaper',
      ]),
    );
    expect(fields(issuesAfter((input) => removeAt(input.ui.data, ['desktop'])))).toEqual(['desktop']);
  });

  it('desktop 樣板：openAppTemplate 只用 {app}、mailUnreadTemplate 只用 {count}', () => {
    const cases: [string, string, string][] = [
      ['openAppTemplate', '開啟應用', '缺少必要的 placeholder {app}'],
      ['openAppTemplate', '開啟{app}（{count}）', '未知的 placeholder {count}'],
      ['mailUnreadTemplate', '有未讀郵件', '缺少必要的 placeholder {count}'],
    ];
    for (const [key, value, message] of cases) {
      const issues = issuesAfter((input) => setAt(input.ui.data, ['desktop', key], value));
      expect(fields(issues)).withContext(value).toEqual([`desktop.${key}`]);
      expect(issues[0].message).withContext(value).toContain(message);
    }
  });
});

describe('validateContent 郵件包（data/mail，R12）', () => {
  const FILE = 'data/mail/return-receipts.json';
  const mail = (input: ContentInput) => input.mail[0].data;

  it('正式資料：退件回條包存在，寄件者與兩個模板齊全', () => {
    const data = CONTENT_SOURCES.mail[0].data as {
      id: string;
      sender: { name: string };
      templates: Record<string, unknown>;
    };
    expect(CONTENT_SOURCES.mail.map((m) => m.file)).toEqual([FILE]);
    expect(data.id).toBe('mail.return-receipts');
    expect(data.sender.name).toBe('資料作業窗口');
    expect(Object.keys(data.templates)).toEqual(['returned', 'resolved']);
  });

  it('模板只可用 {caseNumber}／{versionLabel}／{reason}；不合法的大括號也會被指出', () => {
    const issues = issuesAfter((input) => {
      setAt(mail(input), ['templates', 'returned', 'subject'], '文件退回｜{caseNumber}｜{key}');
      setAt(mail(input), ['templates', 'resolved', 'lines', 1], '案件：{ caseNumber }');
      setAt(mail(input), ['templates', 'resolved', 'attachmentLabel'], '{caseNumber}｜{playerName}');
    });
    expect(issues.map(describeIssue)).toEqual([
      `${FILE} [mail.return-receipts] templates.returned.subject：未知的 placeholder {key}，可用：{caseNumber}、{versionLabel}、{reason}`,
      `${FILE} [mail.return-receipts] templates.resolved.lines[1]：不合法的 placeholder { caseNumber }`,
      `${FILE} [mail.return-receipts] templates.resolved.attachmentLabel：未知的 placeholder {playerName}，可用：{caseNumber}、{versionLabel}、{reason}`,
    ]);
  });

  it('模板不要求每個 placeholder 都出現（收件模板沒有 {reason}）', () => {
    expect(issuesAfter((input) => setAt(mail(input), ['templates', 'returned', 'subject'], '文件退回'))).toEqual([]);
  });

  it('ui.revisionTemplate 必須含 {revision}；非樣板的 ui 欄位不得有 {…}', () => {
    const issues = issuesAfter((input) => {
      setAt(mail(input), ['ui', 'revisionTemplate'], '修訂版');
      setAt(mail(input), ['ui', 'stale'], '請從{mail}開啟');
    });
    expect(fields(issues)).toEqual(['ui.stale', 'ui.revisionTemplate']);
    expect(issues[0].message).toContain('只有 *Template 欄位可以使用');
    expect(issues[1].message).toContain('缺少必要的 placeholder {revision}');
  });

  it('模板剛好 returned／resolved：缺少、多出、欄位錯誤', () => {
    const issues = issuesAfter((input) => {
      removeAt(mail(input), ['templates', 'resolved']);
      setAt(mail(input), ['templates', 'reminder'], { subject: '提醒', lines: ['提醒'], attachmentLabel: '附件' });
      setAt(mail(input), ['templates', 'returned', 'lines'], []);
      setAt(mail(input), ['templates', 'returned', 'html'], '<b>退回</b>');
      removeAt(mail(input), ['templates', 'returned', 'attachmentLabel']);
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'templates.resolved',
        'templates.reminder',
        'templates.returned.lines',
        'templates.returned.html',
        'templates.returned.attachmentLabel',
      ]),
    );
    expect(issues.every((i) => i.file === FILE && i.id === 'mail.return-receipts')).toBeTrue();
  });

  it('ui 為嚴格 shape', () => {
    const issues = issuesAfter((input) => {
      removeAt(mail(input), ['ui', 'openAttachment']);
      setAt(mail(input), ['ui', 'trash'], '垃圾桶');
    });
    expect(fields(issues)).toEqual(['ui.trash', 'ui.openAttachment']);
  });

  it('頂層欄位白名單、schemaVersion、寄件者、integration', () => {
    const issues = issuesAfter((input) => {
      setAt(mail(input), ['schemaVersion'], 2);
      setAt(mail(input), ['address'], 'desk@example.com');
      setAt(mail(input), ['sender', 'id'], 'actor.data-desk');
      setAt(mail(input), ['sender', 'email'], 'desk@example.com');
      setAt(mail(input), ['integration', 'idPolicy'], 1);
      setAt(mail(input), ['integration', 'attachmentFields'], []);
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'schemaVersion',
        'address',
        'sender.id',
        'sender.email',
        'integration.idPolicy',
        'integration.attachmentFields',
      ]),
    );
    expect(issues.find((i) => i.field === 'schemaVersion')?.message).toBe('schemaVersion 必須是 1，得到 2');
    expect(issues.find((i) => i.field === 'sender.id')?.message).toContain('`sender.`');
  });

  it('integration 可省略，note 可加（兩者都不顯示給玩家）', () => {
    const issues = issuesAfter((input) => {
      removeAt(mail(input), ['integration']);
      setAt(mail(input), ['note'], '給內容編輯的備註');
    });
    expect(issues).toEqual([]);
  });

  it('改掉退件回條包的 ID：前綴錯誤與缺少退件回條包都會被指出', () => {
    const issues = issuesAfter((input) => setAt(mail(input), ['id'], 'pack.return-receipts'));
    expect(issues.map(describeIssue)).toEqual([
      `${FILE} [pack.return-receipts] id：ID 必須以 \`mail.\` 開頭`,
      `${FILE} [檔案層級] id：缺少退件回條郵件包 mail.return-receipts（退件／收件回條的郵件以此 packId 引用）`,
    ]);
  });

  it('郵件包 ID 與其他內容共用全域 ID 空間', () => {
    const issues = issuesAfter((input) => {
      const copy = JSON.parse(JSON.stringify(input.mail[0])) as ContentInput['mail'][number];
      input.mail.push({ file: 'data/mail/copy.json', data: copy.data });
    });
    expect(issues.map(describeIssue)).toEqual([
      `data/mail/copy.json [mail.return-receipts] id：ID 重複，已在 ${FILE} 使用`,
    ]);
  });

  it('同一寄件者在不同包的名稱必須一致', () => {
    const issues = issuesAfter((input) => {
      const copy = JSON.parse(JSON.stringify(input.mail[0].data)) as Record<string, unknown>;
      copy['id'] = 'mail.notices';
      (copy['sender'] as Record<string, unknown>)['name'] = '人資窗口';
      input.mail.push({ file: 'data/mail/notices.json', data: copy });
    });
    expect(issues.map(describeIssue)).toEqual([
      `data/mail/notices.json [mail.notices] sender.name：寄件者 sender.data-desk 在 ${FILE} 的名稱是 資料作業窗口；同一寄件者名稱必須一致`,
    ]);
  });

  it('模板夾帶程式碼會被擋下', () => {
    const issues = issuesAfter((input) => setAt(mail(input), ['templates', 'returned', 'lines', 0], '你好 ${caseNumber}'));
    expect(messages(issues)).toContain('資料檔不得包含樣板字面值或運算式');
  });
});

describe('validateContent 入職前情包（data/onboarding，R12）', () => {
  const FILE = 'data/onboarding/first-arrival.json';
  const ob = (input: ContentInput) => input.onboarding.data;
  const CONTRACT = 5;

  it('正式資料：八段、第六段是合約，簽名上限 24', () => {
    const data = CONTENT_SOURCES.onboarding.data as {
      id: string;
      steps: { id: string; kind: string; signature?: { maxGraphemes: number } }[];
    };
    expect(CONTENT_SOURCES.onboarding.file).toBe(FILE);
    expect(data.id).toBe('onboarding.first-arrival');
    expect(data.steps.map((s) => s.id)).toEqual(['offer', 'letter', 'company', 'arrival', 'welcome', 'contract', 'signed', 'workday']);
    expect(data.steps[CONTRACT].kind).toBe('contract');
    expect(data.steps[CONTRACT].signature?.maxGraphemes).toBe(24);
  });

  it('presentation：色碼、逐字間隔、推進方式', () => {
    const issues = issuesAfter((input) => {
      setAt(ob(input), ['presentation', 'background'], 'black');
      setAt(ob(input), ['presentation', 'foreground'], '#fff');
      setAt(ob(input), ['presentation', 'characterIntervalMs'], 0);
      setAt(ob(input), ['presentation', 'advance'], 'auto');
      setAt(ob(input), ['presentation', 'reducedMotion'], 'skip');
      setAt(ob(input), ['presentation', 'glitch'], true);
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'presentation.background',
        'presentation.foreground',
        'presentation.characterIntervalMs',
        'presentation.advance',
        'presentation.reducedMotion',
        'presentation.glitch',
      ]),
    );
    expect(issues.find((i) => i.field === 'presentation.foreground')?.message).toBe('色碼必須是 #rrggbb，得到 #fff');
  });

  it('逐字間隔必須是整數', () => {
    const issues = issuesAfter((input) => setAt(ob(input), ['presentation', 'characterIntervalMs'], 40.5));
    expect(issues.map(describeIssue)).toEqual([
      `${FILE} [onboarding.first-arrival] presentation.characterIntervalMs：characterIntervalMs 必須是正整數（毫秒），得到 40.5`,
    ]);
  });

  it('段落 ID：重複、含 `.`、空白；未知 kind', () => {
    const issues = issuesAfter((input) => {
      setAt(ob(input), ['steps', 1, 'id'], 'offer');
      setAt(ob(input), ['steps', 2, 'id'], 'company.name');
      setAt(ob(input), ['steps', 3, 'id'], '');
      setAt(ob(input), ['steps', 4, 'kind'], 'video');
    });
    expect(fields(issues)).toEqual(['steps[1].id', 'steps[2].id', 'steps[3].id', 'steps[4].kind']);
    expect(issues[0].message).toContain('重複');
  });

  it('剛好一個合約：沒有、兩個、在第一段、在最後一段都會被指出', () => {
    const line = { id: 'extra', kind: 'line', text: '範例：旁白。' };
    const none = issuesAfter((input) => setAt(ob(input), ['steps', CONTRACT], line));
    expect(none.map(describeIssue)).toEqual([`${FILE} [onboarding.first-arrival] steps：入職前情需要剛好一個 contract 段落，得到 0 個`]);

    const two = issuesAfter((input) => {
      const copy = JSON.parse(JSON.stringify(containerAt(ob(input), ['steps', CONTRACT]))) as Record<string, unknown>;
      copy['id'] = 'contract-2';
      setAt(ob(input), ['steps', 6], copy);
    });
    expect(two.map((i) => i.message)).toEqual(['入職前情需要剛好一個 contract 段落，得到 2 個']);

    const first = issuesAfter((input) => {
      const steps = containerAt(ob(input), ['steps']) as unknown as unknown[];
      steps.unshift(...steps.splice(CONTRACT, 1));
    });
    expect(fields(first)).toEqual(['steps[0].kind']);
    expect(first[0].message).toContain('不得是第一段或最後一段');

    const last = issuesAfter((input) => {
      const steps = containerAt(ob(input), ['steps']) as unknown as unknown[];
      steps.push(...steps.splice(CONTRACT, 1));
    });
    expect(fields(last)).toEqual(['steps[7].kind']);
  });

  it('旁白與合約的欄位白名單、必要欄位', () => {
    const issues = issuesAfter((input) => {
      setAt(ob(input), ['steps', 0, 'speaker'], '人資');
      removeAt(ob(input), ['steps', 1, 'text']);
      setAt(ob(input), ['steps', CONTRACT, 'clauses'], []);
      removeAt(ob(input), ['steps', CONTRACT, 'footer']);
      setAt(ob(input), ['steps', CONTRACT, 'text'], '合約全文');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'steps[0].speaker',
        'steps[1].text',
        `steps[${CONTRACT}].clauses`,
        `steps[${CONTRACT}].footer`,
        `steps[${CONTRACT}].text`,
      ]),
    );
    expect(issues.find((i) => i.field === 'steps[0].speaker')?.id).toBe('offer');
  });

  it('簽名欄：上限必須等於 PLAYER_NAME_MAX、欄位齊全、沒有多餘欄位', () => {
    const issues = issuesAfter((input) => {
      setAt(ob(input), ['steps', CONTRACT, 'signature', 'maxGraphemes'], 20);
      removeAt(ob(input), ['steps', CONTRACT, 'signature', 'submit']);
      setAt(ob(input), ['steps', CONTRACT, 'signature', 'pattern'], '^[A-Z]+$');
    });
    expect(issues.map(describeIssue)).toEqual(
      jasmine.arrayWithExactContents([
        `${FILE} [contract] steps[${CONTRACT}].signature.pattern：不在簽名欄內的欄位（只允許 label、placeholder、submit、required、tooLong、maxGraphemes）`,
        `${FILE} [contract] steps[${CONTRACT}].signature.submit：缺少必要欄位或型別錯誤：需要 string，得到 undefined`,
        `${FILE} [contract] steps[${CONTRACT}].signature.maxGraphemes：maxGraphemes 必須等於角色名上限 24（core 的 PLAYER_NAME_MAX），得到 20`,
      ]),
    );
  });

  it('ui.loggingIn 必須且只能用 {playerName}；其他段落不得有 {…}', () => {
    const issues = issuesAfter((input) => {
      setAt(ob(input), ['ui', 'loggingIn'], '正在登入。');
      setAt(ob(input), ['steps', 0, 'text'], '「恭喜你，{playerName}。」');
    });
    expect(fields(issues)).toEqual(['steps[0].text', 'ui.loggingIn']);
    expect(issues[0].message).toContain('只有 *Template 欄位可以使用');
    expect(issues[1].message).toBe('缺少必要的 placeholder {playerName}');
    const other = issuesAfter((input) => setAt(ob(input), ['ui', 'loggingIn'], '正在登入，{playerName}（{role}）。'));
    expect(other.map((i) => i.message)).toEqual(['未知的 placeholder {role}，可用：{playerName}']);
  });

  it('ui 為嚴格 shape；頂層欄位白名單與 schemaVersion', () => {
    const issues = issuesAfter((input) => {
      removeAt(ob(input), ['ui', 'legacyPlayerName']);
      setAt(ob(input), ['ui', 'skip'], '跳過');
      setAt(ob(input), ['schemaVersion'], '1');
      setAt(ob(input), ['music'], 'intro.mp3');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents(['ui.legacyPlayerName', 'ui.skip', 'schemaVersion', 'music']),
    );
  });
});

describe('validateContent 詢問說明包（data/help，R12）', () => {
  const FILE = 'data/help/refusal-record.json';
  const REQUEST = 'request.refusal-record';
  const COND = 'cond.help.refusal-record.requested';
  const help = (input: ContentInput) => input.help[0].data;
  const PROMPT = ['messages', 1, 'replyPrompt'] as const;

  it('正式資料：提問在林予安私訊，兩則說明都由提問條件解鎖', () => {
    const data = CONTENT_SOURCES.help[0].data as {
      request: { id: string; channelId: string; unlockCondition: string };
      messages: { id: string; channelId: string; unlock: string[] }[];
    };
    expect(CONTENT_SOURCES.help.map((h) => h.file)).toEqual([FILE]);
    expect(data.request.id).toBe(REQUEST);
    expect(data.request.unlockCondition).toBe(COND);
    for (const m of data.messages) {
      expect(m.channelId).withContext(m.id).toBe(data.request.channelId);
      expect(m.unlock).withContext(m.id).toContain(COND);
    }
  });

  it('提問：頻道必須是既有 direct、條件必須是自己的、oncePerSave 為 true、欄位白名單', () => {
    const issues = issuesAfter((input) => {
      setAt(help(input), ['request', 'channelId'], 'channel.group.lunch-chat');
      setAt(help(input), ['request', 'unlockCondition'], 'cond.help.other.requested');
      setAt(help(input), ['request', 'oncePerSave'], false);
      setAt(help(input), ['request', 'cooldownDays'], 1);
      // 說明訊息也改到群組，讓頻道一致，只剩提問本身的錯誤
      setAt(help(input), ['messages', 0, 'channelId'], 'channel.group.lunch-chat');
      setAt(help(input), ['messages', 1, 'channelId'], 'channel.group.lunch-chat');
    });
    expect(issues.map(describeIssue)).toEqual(
      jasmine.arrayWithExactContents([
        `${FILE} [help.refusal-record] request.cooldownDays：不在提問內的欄位（只允許 id、channelId、unlockCondition、playerText、oncePerSave）`,
        `${FILE} [${REQUEST}] request.channelId：提問頻道必須是既有的 direct（私訊）頻道，channel.group.lunch-chat 是 group`,
        `${FILE} [${REQUEST}] request.unlockCondition：unlockCondition 必須是這個提問自己的詢問條件 ${COND}，得到 cond.help.other.requested`,
        `${FILE} [${REQUEST}] request.oncePerSave：oncePerSave 必須是 true（每份存檔只問一次），得到 false`,
      ]),
    );
  });

  it('提問：頻道不存在、ID 前綴錯誤、缺 playerText', () => {
    const issues = issuesAfter((input) => {
      setAt(help(input), ['request', 'channelId'], 'channel.dm.nobody');
      removeAt(help(input), ['request', 'playerText']);
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents(['request.playerText', 'messages[0].channelId', 'messages[1].channelId', 'request.channelId']),
    );
    expect(issues.find((i) => i.field === 'request.channelId')?.message).toBe('找不到頻道 channel.dm.nobody');
    const prefix = issuesAfter((input) => setAt(help(input), ['request', 'id'], 'help.refusal-record-request'));
    expect(prefix.find((i) => i.field === 'request.id')?.message).toBe('ID 必須以 `request.` 開頭');
  });

  it('說明訊息：必須在提問頻道、作者是頻道成員、unlock 含提問條件', () => {
    const issues = issuesAfter((input) => {
      setAt(help(input), ['messages', 0, 'channelId'], 'channel.dm.wu-wan-ting');
      setAt(help(input), ['messages', 1, 'actorId'], 'actor.wu-wan-ting');
      setAt(help(input), ['messages', 1, 'unlock'], []);
    });
    expect(issues.map(describeIssue)).toEqual(
      jasmine.arrayWithExactContents([
        `${FILE} [msg.help.refusal.meaning] messages[0].channelId：說明訊息必須在提問頻道 channel.dm.lin-yuan，得到 channel.dm.wu-wan-ting`,
        `${FILE} [msg.help.refusal.meaning] messages[0].actorId：作者 actor.lin-yuan 不是頻道 channel.dm.wu-wan-ting 的成員（見 channels.json 的 actorIds）`,
        `${FILE} [msg.help.refusal.paths] messages[1].actorId：作者 actor.wu-wan-ting 不是頻道 channel.dm.lin-yuan 的成員（見 channels.json 的 actorIds）`,
        `${FILE} [msg.help.refusal.paths] messages[1].unlock：說明訊息的 unlock 必須包含提問條件 ${COND}（提問送出後才解鎖）`,
      ]),
    );
  });

  it('說明訊息、prompt 與回應的 ID 必須含 help 識別；與每日訊息共用全域 ID 空間', () => {
    const issues = issuesAfter((input) => {
      setAt(help(input), ['messages', 0, 'id'], 'msg.day1.refusal-meaning');
      setAt(help(input), [...PROMPT, 'id'], 'prompt.refusal');
      setAt(help(input), [...PROMPT, 'choices', 1, 'responses', 0, 'id'], 'msg.day1.welcome');
    });
    expect(issues.map(describeIssue)).toEqual(
      jasmine.arrayWithExactContents([
        `${FILE} [msg.day1.refusal-meaning] messages[0].id：ID 必須包含詢問說明包的識別 \`help\`（例如 msg.help.*、prompt.help.*）`,
        `${FILE} [prompt.refusal] messages[1].replyPrompt.id：ID 必須包含詢問說明包的識別 \`help\`（例如 msg.help.*、prompt.help.*）`,
        `${FILE} [msg.day1.welcome] messages[1].replyPrompt.choices[1].responses[0].id：ID 重複，已在 data/days/day-01.json 使用`,
        `${FILE} [msg.day1.welcome] messages[1].replyPrompt.choices[1].responses[0].id：ID 必須包含詢問說明包的識別 \`help\`（例如 msg.help.*、prompt.help.*）`,
      ]),
    );
  });

  it('replyPrompt 沿用既有檢查：availableThrough 必須是存在的日、回應者是頻道成員、choice ID 不含 `.`', () => {
    const issues = issuesAfter((input) => {
      setAt(help(input), [...PROMPT, 'availableThrough'], 'day.09');
      setAt(help(input), [...PROMPT, 'choices', 0, 'responses', 0, 'actorId'], 'actor.yang-zi-qian');
      setAt(help(input), [...PROMPT, 'choices', 1, 'id'], 'a.b');
    });
    expect(fields(issues)).toEqual(
      jasmine.arrayWithExactContents([
        'messages[1].replyPrompt.choices[1].id',
        'messages[1].replyPrompt.choices[0].responses[0].actorId',
        'messages[1].replyPrompt.availableThrough',
      ]),
    );
    expect(issues.find((i) => i.field === 'messages[1].replyPrompt.availableThrough')?.message).toBe('找不到日別 day.09');
  });

  it('說明訊息的欄位白名單、非空 messages、visibleFrom 必須是存在的日', () => {
    const extra = issuesAfter((input) => {
      setAt(help(input), ['messages', 0, 'actions'], ['action.reply.submit']);
      setAt(help(input), ['messages', 1, 'visibleFrom'], 'day.00');
    });
    expect(fields(extra)).toEqual(jasmine.arrayWithExactContents(['messages[0].actions', 'messages[1].visibleFrom']));
    const empty = issuesAfter((input) => setAt(help(input), ['messages'], []));
    expect(empty.map(describeIssue)).toEqual([`${FILE} [help.refusal-record] messages：不得為空陣列，至少需要一則說明訊息`]);
  });

  it('ui 為嚴格 shape；頂層欄位白名單與 integration', () => {
    const issues = issuesAfter((input) => {
      removeAt(help(input), ['ui', 'revisit']);
      setAt(help(input), ['ui', 'tooltip'], '說明');
      setAt(help(input), ['answer'], '正解');
      setAt(help(input), ['integration', 'timePolicy'], { at: 'now' });
    });
    expect(fields(issues)).toEqual(jasmine.arrayWithExactContents(['ui.revisit', 'ui.tooltip', 'answer', 'integration.timePolicy']));
  });

  it('cond.help.* 只能用在該提問自己的說明訊息：每日訊息引用會被指出', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['messages', 0, 'unlock'], [COND]));
    expect(issues.map(describeIssue)).toEqual([
      `data/days/day-01.json [msg.day1.welcome] messages[0].unlock[0]：詢問條件 ${COND} 只能用在提問 ${REQUEST} 自己的說明訊息（data/help 包的 messages）`,
    ]);
  });

  it('cond.help.* 指向不存在的提問；格式錯誤視為未知條件並提示格式', () => {
    const unknown = issuesAfter((input) => {
      const unlock = containerAt(help(input), ['messages', 0, 'unlock']) as unknown as string[];
      unlock.push('cond.help.nobody.requested');
    });
    expect(unknown.map(describeIssue)).toEqual([
      `${FILE} [msg.help.refusal.meaning] messages[0].unlock[1]：找不到提問 request.nobody（詢問條件只能引用 data/help 包 request 的 id）`,
    ]);
    const malformed = issuesAfter((input) => setAt(input.days[DAY1].data, ['messages', 0, 'unlock'], ['cond.help.refusal-record']));
    expect(malformed[0].message).toContain('詢問條件格式為 cond.help.<request ID 去掉 request.>.requested');
  });

  it('另一份說明包不得引用別的提問的條件', () => {
    const issues = issuesAfter((input) => {
      const copy = JSON.parse(JSON.stringify(help(input))) as {
        id: string;
        request: Record<string, unknown>;
        messages: Record<string, unknown>[];
      };
      copy.id = 'help.other';
      copy.request['id'] = 'request.other';
      copy.request['unlockCondition'] = 'cond.help.other.requested';
      copy.messages = [
        {
          id: 'msg.help.other.note',
          channelId: 'channel.dm.lin-yuan',
          actorId: 'actor.lin-yuan',
          time: '09:00',
          visibleFrom: 'day.01',
          unlock: ['cond.help.other.requested', COND],
          lines: ['範例：說明。'],
        },
      ];
      input.help.push({ file: 'data/help/other.json', data: copy });
    });
    expect(issues.map(describeIssue)).toEqual([
      `data/help/other.json [msg.help.other.note] messages[0].unlock[1]：詢問條件 ${COND} 只能用在提問 ${REQUEST} 自己的說明訊息（data/help 包的 messages）`,
    ]);
  });

  it('每日訊息可以用 cond.chat.* 引用說明包的 prompt（同一套 prompt 註冊）', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['messages', 0, 'unlock'], ['cond.chat.help.refusal.ack']));
    expect(issues).toEqual([]);
  });
});
