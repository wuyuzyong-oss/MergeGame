import { Node, Label, UITransform, Color } from 'cc';

/**
 * 单项资源显示辅助类
 * 创建一个 Label 节点，绑定刷新函数，用于显示单项资源（等级/体力/金币/钻石）
 * 不继承 Component，纯逻辑辅助
 */
export class ResourceUI {
    public node: Node;
    public label: Label;
    private _refreshFn: () => string;

    /**
     * @param name      节点名称
     * @param refreshFn 返回最新显示文本的函数
     */
    constructor(name: string, refreshFn: () => string) {
        this._refreshFn = refreshFn;

        this.node = new Node(name);

        const transform = this.node.addComponent(UITransform);
        transform.setContentSize(220, 50);
        transform.setAnchorPoint(0.5, 0.5);

        this.label = this.node.addComponent(Label);
        this.label.fontSize = 30;
        this.label.lineHeight = 32;
        this.label.color = new Color(255, 255, 255, 255);
        this.label.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.label.verticalAlign = Label.VerticalAlign.CENTER;
        this.label.overflow = Label.Overflow.SHRINK;

        this.refresh();
    }

    /** 刷新显示文本 */
    public refresh(): void {
        this.label.string = this._refreshFn();
    }
}
