import { CONTENT_SOURCES } from './bundle';
import { ContentInput } from './schema';
import { ContentIssue, assertContentValid, describeIssue, formatIssues, validateContent } from './validate-content';

/**
 * KB-R4-03：內容驗證。
 * 正式資料必須通過；每一種錯誤都要被指出，且訊息要能指向來源檔與內容 ID。
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

const DAY1 = 0;
const DAY2 = 1;

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

describe('validateContent 重複 ID', () => {
  it('跨檔重複的內容 ID 會被指出，並說明先前出現的檔案', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['messages', 0, 'id'], 'msg.day1.welcome'));
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe('msg.day1.welcome');
    expect(issues[0].file).toBe('data/days/day-02.json');
    expect(issues[0].message).toContain('day-01.json');
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

describe('validateContent 條件與動作', () => {
  it('未知條件 ID', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['messages', 0, 'unlock', 0], 'cond.day.99'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('未知的條件 ID');
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

describe('validateContent 必要欄位與型別', () => {
  it('缺少必要欄位', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY1].data, ['workbench', 'greeting']));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toBe('workbench.greeting');
    expect(issues[0].id).toBe('day.01');
  });

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

  it('day 必須是整數且不重複', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY2].data, ['day'], 1));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('已在');
  });

  it('整個檔案型別錯誤時不會炸掉，只回報問題', () => {
    const issues = issuesAfter((input) => {
      input.ui.data = [];
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].field).toBe('(root)');
  });
});

describe('validateContent ID 命名規則', () => {
  it('前綴錯誤', () => {
    const issues = issuesAfter((input) => setAt(input.actors.data, ['actors', 0, 'id'], 'person.lin-yuan'));
    expect(issues.some((i) => i.message.includes('必須以 `actor.` 開頭'))).toBeTrue();
  });

  it('大寫或空白', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['tasks', 0, 'id'], 'task.Day1 Archive'));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('小寫');
  });

  it('缺少 id', () => {
    const issues = issuesAfter((input) => removeAt(input.days[DAY1].data, ['messages', 1, 'id']));
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('缺少 id');
  });
});

describe('validateContent 頻道結構（KB-R4-04 預留）', () => {
  it('kind 必須是 department／group／direct', () => {
    const issues = issuesAfter((input) => setAt(input.channels.data, ['channels', 0, 'kind'], 'broadcast'));
    expect(issues.some((i) => i.field.endsWith('kind'))).toBeTrue();
  });

  it('direct 頻道不自帶標題（取自對方稱呼）', () => {
    const issues = issuesAfter((input) => setAt(input.channels.data, ['channels', 0, 'title'], '某某'));
    expect(issues.length).toBe(1);
    expect(issues[0].field).toContain('title');
  });

  it('群組頻道必須有標題', () => {
    const issues = issuesAfter((input) =>
      pushAt(input.channels.data, ['channels'], { id: 'channel.group.example', kind: 'group', actorIds: [] }),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('title');
  });
});

describe('validateContent 樣板與可執行內容', () => {
  it('未知的 placeholder', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY1].data, ['tasks', 0, 'text', 'progressTemplate'], '{count} / {totals} 已處理'),
    );
    expect(issues.some((i) => i.message.includes('未知的 placeholder {totals}'))).toBeTrue();
  });

  it('缺少必要的 placeholder', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY1].data, ['tasks', 0, 'text', 'footerPendingTemplate'], '完成後即可交接。'),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('缺少必要的 placeholder');
  });

  it('未登記的樣板欄位', () => {
    const issues = issuesAfter((input) =>
      setAt(input.days[DAY1].data, ['tasks', 0, 'text', 'mysteryTemplate'], '{count}'),
    );
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
  it('同時列出來源檔、內容 ID 與欄位', () => {
    const issues = issuesAfter((input) => setAt(input.days[DAY1].data, ['messages', 0, 'unlock', 0], 'cond.nope'));
    const line = describeIssue(issues[0]);
    expect(line).toContain('data/days/day-01.json');
    expect(line).toContain('msg.day1.welcome');
    expect(line).toContain('unlock[0]');
  });
});
