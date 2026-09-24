import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NEWS } from '../../../content/text';
import { WorkbenchViewService } from '../../workbench/services/workbench-view.service';

/**
 * 公司公告（對應原型 news()）：工作平台內的「公告」視圖（R12：不再是子路由）。靜態文案，各日相同。
 * 「返回工作」切回工作平台的工作視圖。
 */
@Component({
  selector: 'app-news',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './news.component.html',
})
export class NewsComponent {
  private readonly views = inject(WorkbenchViewService);

  protected readonly NEWS = NEWS;

  protected back(): void {
    this.views.show('work');
  }
}
