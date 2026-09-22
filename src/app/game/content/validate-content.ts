import { isActionId, isConditionId } from './conditions';
import { ANY_BRACE_PATTERN, placeholders } from './format';
import {
  CHANNEL_KINDS,
  ContentInput,
  ContentSource,
  DOCUMENT_KINDS,
  ID_PATTERN,
  ID_PREFIX,
  TASK_KINDS,
  TEMPLATE_FIELDS,
  VARIANT_KEYS,
} from './schema';

/**
 * game/content/validate-content：內容資料檔的驗證。
 *
 * 檢查重複 ID、不存在的人物／頻道／文件／紀錄引用、未知條件與動作 ID、
 * 缺少必要欄位、錯誤型別，以及資料檔夾帶可執行內容。
 * 每個錯誤都會指出來源檔與內容 ID，讓編輯者直接找到位置。
 * 由 content/validate-content.spec.ts 在測試階段對正式資料執行。
 */

export interface ContentIssue {
  /** 來源檔，例如 `data/days/day-01.json`。 */
  file: string;
  /** 出錯的內容 ID；檔案層級的問題為 null。 */
  id: string | null;
  /** 欄位路徑，例如 `messages[0].unlock[1]`。 */
  field: string;
  message: string;
}

export function describeIssue(issue: ContentIssue): string {
  return `${issue.file} [${issue.id ?? '檔案層級'}] ${issue.field}：${issue.message}`;
}

export function formatIssues(issues: readonly ContentIssue[]): string {
  return issues.map(describeIssue).join('\n');
}

/** 內容不合法時丟出例外；訊息含全部問題。 */
export function assertContentValid(input: ContentInput): void {
  const issues = validateContent(input);
  if (issues.length > 0) throw new Error(`內容驗證失敗：\n${formatIssues(issues)}`);
}

/* ---------- 不得出現在資料檔的內容 ---------- */

const FORBIDDEN_FRAGMENTS: readonly { fragment: string; message: string }[] = [
  { fragment: '${', message: '資料檔不得包含樣板字面值或運算式' },
  { fragment: '=>', message: '資料檔不得包含函式字串' },
  { fragment: 'function(', message: '資料檔不得包含函式字串' },
  { fragment: 'function (', message: '資料檔不得包含函式字串' },
  { fragment: 'new Function', message: '資料檔不得包含函式字串' },
  { fragment: 'eval(', message: '資料檔不得包含 eval' },
  { fragment: 'javascript:', message: '資料檔不得包含 javascript: URI' },
];

/* ---------- ui.zh-Hant.json 的必要字串欄位 ---------- */

const UI_STRING_FIELDS: readonly string[] = [
  'id',
  'locale',
  'appTitleSuffix',
  'cover.eyebrow',
  'cover.title',
  'cover.subtitle',
  'cover.start',
  'cover.continue',
  'cover.settings',
  'cover.noSave',
  'cover.savePrefix',
  'cover.footerLeft',
  'cover.footerRight',
  'cover.artAlt',
  'cover.artSrc',
  'cover.docTitle',
  'phaseLabel.day1',
  'phaseLabel.overnight',
  'phaseLabel.day2',
  'phaseLabel.end',
  'dialogs.newGame.heading',
  'dialogs.newGame.body',
  'dialogs.newGame.keep',
  'dialogs.newGame.start',
  'dialogs.settings.heading',
  'dialogs.settings.motionLabel',
  'dialogs.settings.note',
  'dialogs.settings.back',
  'storage.readIssue',
  'storage.writeIssue',
  'storage.saved',
  'workbench.brandLead',
  'workbench.brandRest',
  'workbench.brandSuffix',
  'workbench.role',
  'workbench.backToCover',
  'workbench.navGroupPersonal',
  'workbench.navGroupTeam',
  'workbench.navLabel',
  'workbench.nav.work',
  'workbench.nav.messages',
  'workbench.nav.news',
  'workbench.heading.messages',
  'workbench.heading.news',
  'workbench.dayTagTemplate',
  'workbench.docTitleTemplate',
  'workbench.dayName.1',
  'workbench.dayName.2',
  'aside.eyebrow',
  'aside.colleagueActorId',
  'aside.quote',
  'aside.slogan',
  'sourceCard.eyebrowTemplate',
  'sourceCard.name',
  'sourceCard.code',
  'sourceCard.refusal',
  'sourceCard.refusalNA',
  'sourceCard.refusalNull',
  'sourceCard.refusalTrue',
  'records.nameUnregistered',
  'messages.eyebrow',
  'messages.back',
  'messages.listLabel',
  'messages.backToList',
  'messages.sectionTitle.department',
  'messages.sectionTitle.group',
  'messages.sectionTitle.direct',
  'messages.sectionEmpty',
  'messages.selectHeading',
  'messages.selectPrompt',
  'messages.emptyChannel',
  'messages.unreadTemplate',
  'messages.unreadChannelTemplate',
  'news.eyebrow',
  'news.back',
];

/** 每日檔的必要文字欄位（任務與文件的 text 內容由各自的 kind 決定，不在這裡逐欄列出）。 */
const DAY_STRING_FIELDS: readonly string[] = [
  'workbench.greeting',
  'workbench.workHeading',
  'aside.heading',
  'aside.body',
];

/* ---------- 小工具 ---------- */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function at(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split('.')) {
    if (!isObj(node)) return undefined;
    node = node[part];
  }
  return node;
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

interface Reference {
  file: string;
  id: string | null;
  field: string;
  kind: 'actor' | 'channel' | 'record' | 'document';
  target: string;
}

const REF_LABEL: Readonly<Record<Reference['kind'], string>> = {
  actor: '人物',
  channel: '頻道',
  record: '紀錄',
  document: '文件',
};

/* ---------- 主驗證 ---------- */

export function validateContent(input: ContentInput): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const seenIds = new Map<string, string>();
  const seenRecordKeys = new Map<string, string>();
  const registry: Record<Reference['kind'], Set<string>> = {
    actor: new Set(),
    channel: new Set(),
    record: new Set(),
    document: new Set(),
  };
  const references: Reference[] = [];

  const add = (file: string, id: string | null, field: string, message: string): void => {
    issues.push({ file, id, field, message });
  };

  /** 註冊 ID：檢查前綴、字元與全域唯一。 */
  const takeId = (
    source: ContentSource,
    value: unknown,
    field: string,
    prefix: string,
    kind?: Reference['kind'],
  ): string | null => {
    if (typeof value !== 'string' || value === '') {
      add(source.file, null, field, `缺少 id 或型別錯誤（得到 ${typeName(value)}）`);
      return null;
    }
    if (!value.startsWith(prefix)) add(source.file, value, field, `ID 必須以 \`${prefix}\` 開頭`);
    if (!ID_PATTERN.test(value)) add(source.file, value, field, 'ID 只能使用小寫英數、`-` 與 `.`');
    const previous = seenIds.get(value);
    if (previous !== undefined) add(source.file, value, field, `ID 重複，已在 ${previous} 使用`);
    else seenIds.set(value, source.file);
    if (kind !== undefined) registry[kind].add(value);
    return value;
  };

  const requireString = (source: ContentSource, id: string | null, root: unknown, path: string): string | null => {
    const value = at(root, path);
    if (typeof value !== 'string') {
      add(source.file, id, path, `缺少必要欄位或型別錯誤：需要 string，得到 ${typeName(value)}`);
      return null;
    }
    if (value === '') {
      add(source.file, id, path, '不得為空字串');
      return null;
    }
    return value;
  };

  const ref = (
    source: ContentSource,
    id: string | null,
    field: string,
    kind: Reference['kind'],
    target: unknown,
  ): void => {
    if (typeof target !== 'string' || target === '') {
      add(source.file, id, field, `${REF_LABEL[kind]}引用必須是非空字串，得到 ${typeName(target)}`);
      return;
    }
    references.push({ file: source.file, id, field, kind, target });
  };

  const refList = (
    source: ContentSource,
    id: string | null,
    field: string,
    kind: Reference['kind'],
    list: unknown,
  ): void => {
    if (!Array.isArray(list)) {
      add(source.file, id, field, `需要陣列，得到 ${typeName(list)}`);
      return;
    }
    list.forEach((target, i) => ref(source, id, `${field}[${i}]`, kind, target));
  };

  /* ---- 字串掃描：可執行內容與樣板 placeholder ---- */
  const scanStrings = (source: ContentSource, node: unknown, path: string, id: string | null): void => {
    if (typeof node === 'string') {
      for (const f of FORBIDDEN_FRAGMENTS) {
        if (node.includes(f.fragment)) add(source.file, id, path, `${f.message}（發現 \`${f.fragment}\`）`);
      }
      const key = path.split('.').pop() ?? path;
      if (key.endsWith('Template')) checkTemplate(source, id, path, key, node, add);
      else if (node.includes('{')) add(source.file, id, path, '只有 *Template 欄位可以使用 {…} placeholder');
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => scanStrings(source, v, `${path}[${i}]`, id));
      return;
    }
    if (isObj(node)) {
      const own = node['id'];
      const nextId = typeof own === 'string' ? own : id;
      for (const key of Object.keys(node)) {
        scanStrings(source, node[key], path === '' ? key : `${path}.${key}`, nextId);
      }
    }
  };

  /* ---- ui ---- */
  const ui = input.ui;
  if (!isObj(ui.data)) {
    add(ui.file, null, '(root)', `內容必須是物件，得到 ${typeName(ui.data)}`);
  } else {
    scanStrings(ui, ui.data, '', null);
    for (const path of UI_STRING_FIELDS) requireString(ui, 'ui', ui.data, path);
    ref(ui, 'ui', 'aside.colleagueActorId', 'actor', at(ui.data, 'aside.colleagueActorId'));
  }

  /* ---- actors ---- */
  const actors = input.actors;
  const actorList = isObj(actors.data) ? actors.data['actors'] : undefined;
  if (!Array.isArray(actorList)) {
    add(actors.file, null, 'actors', `需要陣列，得到 ${typeName(actorList)}`);
  } else {
    scanStrings(actors, actors.data, '', null);
    actorList.forEach((raw, i) => {
      const field = `actors[${i}]`;
      if (!isObj(raw)) {
        add(actors.file, null, field, `需要物件，得到 ${typeName(raw)}`);
        return;
      }
      const id = takeId(actors, raw['id'], `${field}.id`, ID_PREFIX.actor, 'actor');
      requireString(actors, id, raw, 'displayName');
    });
  }

  /* ---- channels ---- */
  const channels = input.channels;
  const channelList = isObj(channels.data) ? channels.data['channels'] : undefined;
  if (!Array.isArray(channelList)) {
    add(channels.file, null, 'channels', `需要陣列，得到 ${typeName(channelList)}`);
  } else {
    scanStrings(channels, channels.data, '', null);
    channelList.forEach((raw, i) => {
      const field = `channels[${i}]`;
      if (!isObj(raw)) {
        add(channels.file, null, field, `需要物件，得到 ${typeName(raw)}`);
        return;
      }
      const id = takeId(channels, raw['id'], `${field}.id`, ID_PREFIX.channel, 'channel');
      const kind = raw['kind'];
      if (typeof kind !== 'string' || !(CHANNEL_KINDS as readonly string[]).includes(kind)) {
        add(channels.file, id, `${field}.kind`, `kind 必須是 ${CHANNEL_KINDS.join('／')}，得到 ${String(kind)}`);
      }
      const actorIds = raw['actorIds'];
      refList(channels, id, `${field}.actorIds`, 'actor', actorIds);
      if (kind === 'direct') {
        if (Array.isArray(actorIds) && actorIds.length !== 1) {
          add(channels.file, id, `${field}.actorIds`, 'direct 頻道必須剛好一位對象');
        }
        if (raw['title'] !== undefined) {
          add(channels.file, id, `${field}.title`, 'direct 頻道不填 title，標題取自對方的 displayName');
        }
      } else if (raw['title'] === undefined || raw['title'] === '') {
        add(channels.file, id, `${field}.title`, `${String(kind)} 頻道必須有 title`);
      }
    });
  }

  /* ---- bulletins ---- */
  const bulletins = input.bulletins;
  const bulletinList = isObj(bulletins.data) ? bulletins.data['bulletins'] : undefined;
  if (!Array.isArray(bulletinList)) {
    add(bulletins.file, null, 'bulletins', `需要陣列，得到 ${typeName(bulletinList)}`);
  } else {
    scanStrings(bulletins, bulletins.data, '', null);
    bulletinList.forEach((raw, i) => {
      const field = `bulletins[${i}]`;
      if (!isObj(raw)) {
        add(bulletins.file, null, field, `需要物件，得到 ${typeName(raw)}`);
        return;
      }
      const id = takeId(bulletins, raw['id'], `${field}.id`, ID_PREFIX.bulletin);
      requireString(bulletins, id, raw, 'title');
      requireStringArray(bulletins, id, `${field}.body`, raw['body'], add);
    });
  }

  /* ---- days ---- */
  const seenDayNumbers = new Map<number, string>();
  for (const source of input.days) {
    const data = source.data;
    if (!isObj(data)) {
      add(source.file, null, '(root)', `內容必須是物件，得到 ${typeName(data)}`);
      continue;
    }
    scanStrings(source, data, '', null);
    const dayId = takeId(source, data['id'], 'id', ID_PREFIX.day);
    const dayNumber = data['day'];
    if (typeof dayNumber !== 'number' || !Number.isInteger(dayNumber) || dayNumber < 1) {
      add(source.file, dayId, 'day', `day 必須是 1 以上的整數，得到 ${typeName(dayNumber)}`);
    } else {
      const previous = seenDayNumbers.get(dayNumber);
      if (previous !== undefined) add(source.file, dayId, 'day', `第 ${dayNumber} 天已在 ${previous} 定義`);
      else seenDayNumbers.set(dayNumber, source.file);
    }
    for (const path of DAY_STRING_FIELDS) requireString(source, dayId, data, path);

    /* records */
    const records = data['records'];
    if (!Array.isArray(records)) {
      add(source.file, dayId, 'records', `需要陣列，得到 ${typeName(records)}`);
    } else {
      records.forEach((raw, i) => {
        const field = `records[${i}]`;
        if (!isObj(raw)) {
          add(source.file, dayId, field, `需要物件，得到 ${typeName(raw)}`);
          return;
        }
        const id = takeId(source, raw['id'], `${field}.id`, ID_PREFIX.record, 'record');
        const key = raw['key'];
        if (typeof key !== 'string' || key === '') {
          add(source.file, id, `${field}.key`, `存檔 key 必須是非空字串，得到 ${typeName(key)}`);
        } else {
          const previous = seenRecordKeys.get(key);
          if (previous !== undefined) add(source.file, id, `${field}.key`, `存檔 key ${key} 已在 ${previous} 使用`);
          else seenRecordKeys.set(key, source.file);
        }
        const code = raw['code'];
        if (typeof code !== 'string' || code === '') {
          add(
            source.file,
            id,
            `${field}.code`,
            `人員編號必須是字串（0102 等前導零不得寫成數字），得到 ${typeName(code)}`,
          );
        }
        const name = raw['name'];
        if (name !== null && typeof name !== 'string') {
          add(source.file, id, `${field}.name`, `name 必須是字串或 null，得到 ${typeName(name)}`);
        }
        const refusal = raw['refusal'];
        if (refusal !== null && typeof refusal !== 'boolean') {
          add(source.file, id, `${field}.refusal`, `refusal 必須是 boolean 或 null，得到 ${typeName(refusal)}`);
        }
        const applies = raw['refusalApplies'];
        if (typeof applies !== 'boolean') {
          add(source.file, id, `${field}.refusalApplies`, `refusalApplies 必須是 boolean，得到 ${typeName(applies)}`);
        } else if (!applies && refusal !== null) {
          add(source.file, id, `${field}.refusal`, '不適用拒絕紀錄時 refusal 必須是 null');
        }
      });
    }

    /* documents */
    const documents = data['documents'];
    if (!Array.isArray(documents)) {
      add(source.file, dayId, 'documents', `需要陣列，得到 ${typeName(documents)}`);
    } else {
      documents.forEach((raw, i) => {
        const field = `documents[${i}]`;
        if (!isObj(raw)) {
          add(source.file, dayId, field, `需要物件，得到 ${typeName(raw)}`);
          return;
        }
        const id = takeId(source, raw['id'], `${field}.id`, ID_PREFIX.document, 'document');
        const kind = raw['kind'];
        if (typeof kind !== 'string' || !(DOCUMENT_KINDS as readonly string[]).includes(kind)) {
          add(source.file, id, `${field}.kind`, `kind 必須是 ${DOCUMENT_KINDS.join('／')}，得到 ${String(kind)}`);
        }
        refList(source, id, `${field}.recordIds`, 'record', raw['recordIds']);
        if (!isObj(raw['text'])) add(source.file, id, `${field}.text`, `需要 text 物件，得到 ${typeName(raw['text'])}`);
      });
    }

    /* tasks */
    const tasks = data['tasks'];
    if (!Array.isArray(tasks)) {
      add(source.file, dayId, 'tasks', `需要陣列，得到 ${typeName(tasks)}`);
    } else {
      tasks.forEach((raw, i) => {
        const field = `tasks[${i}]`;
        if (!isObj(raw)) {
          add(source.file, dayId, field, `需要物件，得到 ${typeName(raw)}`);
          return;
        }
        const id = takeId(source, raw['id'], `${field}.id`, ID_PREFIX.task);
        const kind = raw['kind'];
        if (typeof kind !== 'string' || !(TASK_KINDS as readonly string[]).includes(kind)) {
          add(source.file, id, `${field}.kind`, `kind 必須是 ${TASK_KINDS.join('／')}，得到 ${String(kind)}`);
        }
        refList(source, id, `${field}.recordIds`, 'record', raw['recordIds']);
        refList(source, id, `${field}.documentIds`, 'document', raw['documentIds']);
        checkActions(source, id, `${field}.actions`, raw['actions'], add);
        if (!isObj(raw['text'])) add(source.file, id, `${field}.text`, `需要 text 物件，得到 ${typeName(raw['text'])}`);
      });
    }

    /* messages */
    const messages = data['messages'];
    if (!Array.isArray(messages)) {
      add(source.file, dayId, 'messages', `需要陣列，得到 ${typeName(messages)}`);
    } else {
      const variantSeen = new Map<string, string>();
      messages.forEach((raw, i) => {
        const field = `messages[${i}]`;
        if (!isObj(raw)) {
          add(source.file, dayId, field, `需要物件，得到 ${typeName(raw)}`);
          return;
        }
        const id = takeId(source, raw['id'], `${field}.id`, ID_PREFIX.message);
        ref(source, id, `${field}.channelId`, 'channel', raw['channelId']);
        ref(source, id, `${field}.actorId`, 'actor', raw['actorId']);
        requireString(source, id, raw, 'time');
        const unlock = raw['unlock'];
        if (!Array.isArray(unlock)) {
          add(source.file, id, `${field}.unlock`, `需要條件 ID 陣列，得到 ${typeName(unlock)}`);
        } else {
          unlock.forEach((cond, n) => {
            if (!isConditionId(cond)) {
              add(source.file, id, `${field}.unlock[${n}]`, `未知的條件 ID ${String(cond)}（白名單見 content/conditions.ts）`);
            }
          });
        }
        requireStringArray(source, id, `${field}.lines`, raw['lines'], add);
        checkActions(source, id, `${field}.actions`, raw['actions'], add);
        const variant = raw['variant'];
        if (variant !== undefined) {
          if (!isObj(variant)) {
            add(source.file, id, `${field}.variant`, `需要物件，得到 ${typeName(variant)}`);
          } else {
            const key = variant['key'];
            const value = variant['value'];
            if (typeof key !== 'string' || !(VARIANT_KEYS as readonly string[]).includes(key)) {
              add(source.file, id, `${field}.variant.key`, `未知的變體來源 ${String(key)}`);
            }
            if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
              add(source.file, id, `${field}.variant.value`, `需要 0 以上的整數，得到 ${typeName(value)}`);
            }
            if (typeof key === 'string' && typeof value === 'number') {
              const slot = `${String(raw['channelId'])}|${key}|${value}`;
              const previous = variantSeen.get(slot);
              if (previous !== undefined) {
                add(source.file, id, `${field}.variant`, `同一頻道的 ${key}=${value} 已由 ${previous} 使用`);
              } else variantSeen.set(slot, id ?? field);
            }
          }
        }
      });
    }

    /* transition */
    const transition = data['transition'];
    if (!isObj(transition)) {
      add(source.file, dayId, 'transition', `需要物件，得到 ${typeName(transition)}`);
    } else {
      const id = takeId(source, transition['id'], 'transition.id', ID_PREFIX.transition);
      if (!isObj(transition['text'])) {
        add(source.file, id, 'transition.text', `需要 text 物件，得到 ${typeName(transition['text'])}`);
      }
    }
  }

  /* ---- 引用檢查 ---- */
  for (const r of references) {
    if (!registry[r.kind].has(r.target)) {
      add(r.file, r.id, r.field, `找不到${REF_LABEL[r.kind]} ${r.target}`);
    }
  }

  return issues;
}

/* ---------- 抽出的檢查 ---------- */

type AddIssue = (file: string, id: string | null, field: string, message: string) => void;

function requireStringArray(
  source: ContentSource,
  id: string | null,
  field: string,
  value: unknown,
  add: AddIssue,
): void {
  if (!Array.isArray(value)) {
    add(source.file, id, field, `需要字串陣列，得到 ${typeName(value)}`);
    return;
  }
  if (value.length === 0) {
    add(source.file, id, field, '不得為空陣列');
    return;
  }
  value.forEach((line, i) => {
    if (typeof line !== 'string' || line === '') {
      add(source.file, id, `${field}[${i}]`, `需要非空字串，得到 ${typeName(line)}`);
    }
  });
}

function checkActions(source: ContentSource, id: string | null, field: string, value: unknown, add: AddIssue): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    add(source.file, id, field, `需要動作 ID 陣列，得到 ${typeName(value)}`);
    return;
  }
  value.forEach((action, i) => {
    if (!isActionId(action)) {
      add(source.file, id, `${field}[${i}]`, `未知的動作 ID ${String(action)}（白名單見 content/conditions.ts）`);
    }
  });
}

function checkTemplate(
  source: ContentSource,
  id: string | null,
  field: string,
  key: string,
  value: string,
  add: AddIssue,
): void {
  const allowed: readonly string[] | undefined = Object.prototype.hasOwnProperty.call(TEMPLATE_FIELDS, key)
    ? TEMPLATE_FIELDS[key]
    : undefined;
  if (allowed === undefined) {
    add(source.file, id, field, `未知的樣板欄位 ${key}（可用欄位見 schema.ts 的 TEMPLATE_FIELDS）`);
    return;
  }
  for (const brace of value.match(ANY_BRACE_PATTERN) ?? []) {
    if (!/^\{[A-Za-z0-9_]+\}$/.test(brace)) add(source.file, id, field, `不合法的 placeholder ${brace}`);
  }
  for (const name of placeholders(value)) {
    if (!allowed.includes(name)) {
      add(source.file, id, field, `未知的 placeholder {${name}}，可用：${allowed.map((a) => `{${a}}`).join('、')}`);
    }
  }
  for (const name of allowed) {
    if (!value.includes(`{${name}}`)) add(source.file, id, field, `缺少必要的 placeholder {${name}}`);
  }
}
