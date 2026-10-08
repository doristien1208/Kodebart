import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
  CONTENT,
  channel,
  chatDateLabel,
  dayOrder,
  helpRequestOf,
  helpRequestOfMessage,
  promptOf,
  promptsOfChannel,
} from '../../../content/bundle';
import { CHANNEL_KINDS, ChannelKind, ContentMessage } from '../../../content/schema';
import { MESSAGES } from '../../../content/text';
import { SettingsService } from '../../../platform/settings.service';
import { GameStateService } from '../../../state/game-state.service';
import { DesktopService } from '../../desktop/services/desktop.service';
import { ChannelListComponent, ChannelListItem, ChannelSection } from '../channel-list/channel-list.component';
import { MessageThreadComponent, ThreadHeader, ThreadReveal } from '../message-thread/message-thread.component';
import { ChatPacingService } from '../services/chat-pacing.service';
import { MessageUnreadService } from '../services/message-unread.service';
import { MessagesNavigationService } from '../services/messages-navigation.service';
import { QuickReplyChoice, QuickReplyComponent } from '../quick-reply/quick-reply.component';
import { TimelineEntry, TimelineRequest, buildTimeline, initialOf, lastMessageOf } from '../presenters/timeline';
import { displayReply } from '../presenters/reply-display';

interface ThreadView {
  header: ThreadHeader;
  entries: readonly TimelineEntry[];
  /** 這個對話目前未讀的列（開啟時捲到第一則）。 */
  unreadIds: ReadonlySet<string>;
  /** 尚未執行的定位要求；不是這個對話的為 null。 */
  reveal: ThreadReveal | null;
}

/** 目前頻道可回答的 prompt。 */
interface OpenPrompt {
  promptId: string;
  choices: readonly QuickReplyChoice[];
}

/**
 * 顯示用的人物稱呼；舊存檔的回應快照可能引用內容日後移除的人物，此時顯示空字串而不讓整頁失敗。
 */
function safeActorName(actorId: string): string {
  return CONTENT.actors.find((a) => a.id === actorId)?.displayName ?? '';
}

/**
 * 通訊應用（KB-R4-04／R7 §2；R12 §2／§4）：頻道欄＋對話區＋固定回覆區，放在桌面的通訊主視窗內。
 *
 * 這一層是協調者：取狀態、用 timeline.ts 組呈現資料、決定何時標記已讀，
 * 並把固定回覆的選擇轉成 GameStateService 呼叫。列表、對話與回覆區各自是子元件，都只吃 input、吐 output。
 * - 選取與定位要求在 MessagesNavigationService（root）：視窗最小化、關閉或切換應用都保留。
 * - 已讀時機（R12 §2）：通訊視窗顯示中且作用中（DesktopService.isAppActive，含頁籤可見、有焦點），
 *   而且該列實際在對話捲動區內可見（對話串回報）才寫入；不看 selectedId、不看路由，開其他頻道也不影響。
 *   條件稍後才成立（切回頁籤、還原視窗）時，標記當下看得到的列。
 * - 回覆與說明依保存的送達時間出現（ChatPacingService），未送達前顯示「正在輸入」。
 * - 玩家列的署名是玩家的角色名（舊存檔「員工」）。
 * - 拒絕紀錄說明的追問：已回答的舊快照在顯示時改用目前核准的內容文字（presenters/reply-display.ts），
 *   對話串與頻道列表摘要都經過這裡；存檔、送達時間與已讀不變。
 * 窄版面（容器寬度不足兩欄）一次只顯示列表或對話。
 */
@Component({
  selector: 'app-messages',
  imports: [ChannelListComponent, MessageThreadComponent, QuickReplyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './messages.component.css',
  templateUrl: './messages.component.html',
})
export class MessagesComponent {
  private readonly unread = inject(MessageUnreadService);
  private readonly game = inject(GameStateService);
  private readonly settings = inject(SettingsService);
  private readonly pacing = inject(ChatPacingService);
  private readonly nav = inject(MessagesNavigationService);
  private readonly desktop = inject(DesktopService);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  private readonly threadRef = viewChild(MessageThreadComponent);

  protected readonly t = MESSAGES;

  /** 目前開啟的頻道（跨視窗關閉保留）；預設不選。選取本身不代表已讀。 */
  protected readonly selectedId = this.nav.selectedId;

  /** 本次開啟頻道後才回答的 prompt：它們產生的列播放淡入；換頻道即清空。 */
  private readonly freshPromptIds = signal<ReadonlySet<string>>(new Set());

  /** 對話串回報目前可見的訊息列。 */
  private readonly visibleRows = signal<ReadonlySet<string>>(new Set());

  /** 已執行過的定位要求 seq（避免重建對話區時重複捲動）。 */
  private readonly revealedSeq = signal(0);

  /** 已送出的提問（存檔＋內容提問文字）；尚未送出或內容已移除為 undefined。 */
  private requestOf(requestId: string): TimelineRequest | undefined {
    const state = this.game.helpRequest(requestId);
    const request = helpRequestOf(requestId);
    if (!state || !request) return undefined;
    return { id: requestId, dayId: state.dayId, askedAt: state.askedAt, playerText: request.playerText, deliveries: state.deliveries };
  }

  /** 某頻道已解鎖內容訊息＋回覆快照＋提問合成的 timeline；讀 save() 與送達時鐘，回答或送達後立即更新。 */
  private timelineOf(messages: readonly ContentMessage[], fresh?: ReadonlySet<string>): readonly TimelineEntry[] {
    return buildTimeline({
      messages,
      replyOf: (id) => displayReply(id, this.game.chatReply(id), (promptId) => promptOf(promptId)?.prompt),
      actorName: safeActorName,
      dateLabel: chatDateLabel,
      you: this.game.displayName(),
      freshPromptIds: fresh,
      now: this.pacing.now(),
      requestOfMessage: helpRequestOfMessage,
      requestOf: (id) => this.requestOf(id),
      dayOrder,
    });
  }

  /**
   * 三種分類固定都列出；沒有可見頻道的分類顯示中性空狀態，不虛構頻道。
   * 頻道要等到第一則訊息解鎖（visibleFrom 到了、條件成立）才出現在列表。
   */
  protected readonly sections = computed<readonly ChannelSection[]>(() => {
    const channels = this.unread.unread().filter((c) => c.unlocked.length > 0);
    return CHANNEL_KINDS.map((kind: ChannelKind) => ({
      kind,
      title: MESSAGES.sectionTitle[kind],
      items: channels
        .filter((c) => c.kind === kind)
        .map((c): ChannelListItem => {
          const last = lastMessageOf(this.timelineOf(c.unlocked));
          return {
            id: c.id,
            kind: c.kind,
            title: c.title,
            initial: initialOf(c.title),
            preview: last?.lines[last.lines.length - 1]?.text ?? '',
            time: last?.time ?? '',
            unread: c.unreadIds.length,
            unreadLabel: MESSAGES.unreadChannel(c.title, c.unreadIds.length),
          };
        }),
    }));
  });

  protected readonly thread = computed<ThreadView | null>(() => {
    const c = this.unread.channel(this.selectedId());
    if (c === null || c.unlocked.length === 0) return null;
    const group = c.kind !== 'direct';
    const content = channel(c.id);
    const fresh = this.settings.animationsEnabled() ? this.freshPromptIds() : undefined;
    const r = this.nav.reveal();
    return {
      header: {
        channelId: c.id,
        kind: c.kind,
        title: c.title,
        initial: initialOf(c.title),
        topic: group ? (content.topic ?? '') : '',
        // actorIds 是主角以外的參與者，成員數再加上玩家自己。
        members: group ? MESSAGES.memberCount(content.actorIds.length + 1) : '',
        status: group ? '' : MESSAGES.online,
      },
      entries: this.timelineOf(c.unlocked, fresh),
      unreadIds: new Set(c.unreadIds),
      reveal: r && r.channelId === c.id && r.seq > this.revealedSeq() ? { entryId: r.entryId, seq: r.seq } : null,
    };
  });

  /**
   * 目前頻道第一個可回答的 prompt（依內容順序）；沒有就不顯示回覆區。
   * 說明訊息的 prompt 要等 anchor 實際送達（isPromptOpen 以實際時間判斷），因此也讀送達時鐘重算。
   */
  protected readonly openPrompt = computed<OpenPrompt | null>(() => {
    const id = this.selectedId();
    this.pacing.now();
    if (id === null) return null;
    const entry = promptsOfChannel(id).find((e) => this.game.isPromptOpen(e.prompt.id));
    if (!entry) return null;
    return {
      promptId: entry.prompt.id,
      choices: entry.prompt.choices.map((c) => ({ id: c.id, text: c.text })),
    };
  });

  constructor() {
    /*
     * 已讀寫入點：通訊視窗作用中，且對話串回報的可見列裡有未讀時才寫入（一次批次）。
     * 視窗最小化／關閉、其他應用在前、頁籤在背景時不寫；條件恢復時依當下可見的列補記。
     * 寫入後該頻道的未讀減少，effect 重跑時沒有可記的就不再寫入。
     */
    effect(() => {
      const active = this.desktop.isAppActive('messages');
      const visible = this.visibleRows();
      const c = this.unread.channel(this.selectedId());
      if (!active || c === null || visible.size === 0) return;
      const seen = c.unreadIds.filter((id) => visible.has(id));
      if (seen.length > 0) untracked(() => this.unread.markRead(c.id, seen));
    });
  }

  protected open(channelId: string): void {
    if (this.selectedId() !== channelId) {
      this.freshPromptIds.set(new Set());
      this.visibleRows.set(new Set());
    }
    this.nav.select(channelId);
  }

  /** 窄版面從對話返回列表；不影響已讀狀態。 */
  protected closeThread(): void {
    this.freshPromptIds.set(new Set());
    this.visibleRows.set(new Set());
    this.nav.select(null);
  }

  protected onVisible(ids: ReadonlySet<string>): void {
    this.visibleRows.set(ids);
  }

  protected onRevealed(seq: number): void {
    if (seq > this.revealedSeq()) this.revealedSeq.set(seq);
  }

  /** 選擇固定回覆：保存後玩家列立即出現，對方回應依保存的送達時間逐則出現；重複點擊或過期時不做事。 */
  protected answer(choiceId: string): void {
    const p = this.openPrompt();
    if (!p || !this.game.answerPrompt(p.promptId, choiceId)) return;
    this.freshPromptIds.update((s) => new Set([...s, p.promptId]));
    this.restoreFocus();
  }

  /** 不回覆：只保存 skipped，對話串不顯示任何東西。 */
  protected skip(): void {
    const p = this.openPrompt();
    if (!p || !this.game.skipPrompt(p.promptId)) return;
    this.restoreFocus();
  }

  /** 回覆區隨之消失：焦點若因此遺失（落到 body），放回對話捲動區；其他情況不動焦點。 */
  private restoreFocus(): void {
    afterNextRender(
      () => {
        const active = this.document.activeElement;
        if (active === null || active === this.document.body) this.threadRef()?.focusLog();
      },
      { injector: this.injector },
    );
  }
}
