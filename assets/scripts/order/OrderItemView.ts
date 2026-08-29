import { Node, Label, UITransform, Graphics, Color } from 'cc';
import { OrderData } from './OrderData';
import { OrderStatus } from './OrderManager';

/**
 * 单个订单显示视图
 * 不继承 Component，纯节点构建类
 *
 * 显示：需求物品文本 + 奖励金币 + 完成按钮（仅当可完成时显示）
 */
export class OrderItemView {
    public node: Node;

    private _orderId: string = '';
    private _reqLabel: Label;
    private _rewardLabel: Label;
    private _completeBtnNode: Node;
    private _btnLabel: Label;
    private _onComplete: (() => void) | null = null;

    constructor() {
        // 根节点
        this.node = new Node('OrderItem');
        const transform = this.node.addComponent(UITransform);
        transform.setContentSize(1020, 80);
        transform.setAnchorPoint(0.5, 0.5);

        // 背景
        const bg = this.node.addComponent(Graphics);
        bg.fillColor = new Color(40, 40, 55, 200);
        bg.roundRect(-510, -40, 1020, 80, 8);
        bg.fill();
        bg.strokeColor = new Color(80, 80, 100, 150);
        bg.lineWidth = 1;
        bg.roundRect(-510, -40, 1020, 80, 8);
        bg.stroke();

        // 需求文本（左侧）
        const reqNode = new Node('Requirement');
        const reqTransform = reqNode.addComponent(UITransform);
        reqTransform.setContentSize(500, 60);
        reqTransform.setAnchorPoint(0, 0.5);
        reqNode.setPosition(-480, 0, 0);

        this._reqLabel = reqNode.addComponent(Label);
        this._reqLabel.fontSize = 24;
        this._reqLabel.lineHeight = 26;
        this._reqLabel.color = new Color(230, 230, 230, 255);
        this._reqLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this._reqLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this._reqLabel.overflow = Label.Overflow.SHRINK;
        reqNode.setParent(this.node);

        // 奖励文本（中间偏右）
        const rewardNode = new Node('Reward');
        const rewardTransform = rewardNode.addComponent(UITransform);
        rewardTransform.setContentSize(180, 60);
        rewardTransform.setAnchorPoint(0.5, 0.5);
        rewardNode.setPosition(260, 0, 0);

        this._rewardLabel = rewardNode.addComponent(Label);
        this._rewardLabel.fontSize = 26;
        this._rewardLabel.lineHeight = 28;
        this._rewardLabel.color = new Color(255, 215, 0, 255);
        this._rewardLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._rewardLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this._rewardLabel.overflow = Label.Overflow.SHRINK;
        rewardNode.setParent(this.node);

        // 完成按钮（右侧）
        this._completeBtnNode = new Node('CompleteBtn');
        const btnTransform = this._completeBtnNode.addComponent(UITransform);
        btnTransform.setContentSize(120, 50);
        btnTransform.setAnchorPoint(0.5, 0.5);
        this._completeBtnNode.setPosition(430, 0, 0);

        // 按钮背景
        const btnGraphics = this._completeBtnNode.addComponent(Graphics);
        btnGraphics.fillColor = new Color(50, 160, 50, 255);
        btnGraphics.roundRect(-60, -25, 120, 50, 6);
        btnGraphics.fill();

        // 按钮文字
        const btnLabelNode = new Node('BtnLabel');
        const btnLabelTransform = btnLabelNode.addComponent(UITransform);
        btnLabelTransform.setContentSize(120, 50);
        btnLabelTransform.setAnchorPoint(0.5, 0.5);

        this._btnLabel = btnLabelNode.addComponent(Label);
        this._btnLabel.string = '完成';
        this._btnLabel.fontSize = 24;
        this._btnLabel.lineHeight = 26;
        this._btnLabel.color = new Color(255, 255, 255, 255);
        this._btnLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._btnLabel.verticalAlign = Label.VerticalAlign.CENTER;
        btnLabelNode.setParent(this._completeBtnNode);

        this._completeBtnNode.setParent(this.node);
        this._completeBtnNode.active = false;

        // 按钮点击事件
        this._completeBtnNode.on(Node.EventType.TOUCH_END, this.onCompleteClick, this);
    }

    /**
     * 设置订单数据并刷新显示
     * @param order    订单数据
     * @param status   订单状态
     * @param onComplete 完成按钮回调
     */
    public setup(order: OrderData, status: OrderStatus, onComplete: () => void): void {
        this._orderId = order.id;
        this._onComplete = onComplete;

        // 需求文本
        const reqParts = order.items.map(
            item => `${OrderItemView.formatItemName(item.itemId)} ×${item.count}`
        );
        this._reqLabel.string = reqParts.join('  ');

        // 奖励
        this._rewardLabel.string = `💰${order.reward}`;

        // 完成按钮可见性
        this._completeBtnNode.active = (status === OrderStatus.COMPLETE);
    }

    /** 销毁节点 */
    public dispose(): void {
        if (this.node && this.node.isValid) {
            this.node.destroy();
        }
    }

    // ==================== 内部方法 ====================

    private onCompleteClick(): void {
        if (this._onComplete) {
            this._completeBtnNode.active = false; // 防止重复点击
            this._onComplete();
        }
    }

    /**
     * 将 itemId 转换为可读名称
     * 例：towel_lv3 → 毛巾 LV3
     */
    public static formatItemName(itemId: string): string {
        const nameMap: Record<string, string> = {
            'towel': '毛巾',
            'pocket_mirror': '镜子',
            'glasses': '眼镜',
            'socks': '袜子',
            'onion': '洋葱',
            'mushroom': '蘑菇',
            'bacon': '培根',
            'eye_mask': '眼罩',
            'sleeping_bag': '睡袋',
            'blueberry': '蓝莓',
            'jam': '果酱',
        };

        const match = itemId.match(/^(.+)_lv(\d+)$/);
        if (match) {
            const baseName = nameMap[match[1]] || match[1];
            return `${baseName} LV${match[2]}`;
        }
        return itemId;
    }
}
