import { _decorator, Component, Node, Vec3, Graphics, Color, Label, UITransform, EventTouch, resources, Font } from 'cc';
import { EventManager } from './core/EventManager';
import { AudioManager } from './AudioManager';
// 注意：不直接 import GameManager，避免循环依赖
// MultiplierButton 通过事件通知 GameManager 切换倍数

const { ccclass, property } = _decorator;

/**
 * 倍数按钮
 * 点击循环切换 x1 → x2 → x4 → x8 → x1
 * 不同倍数显示不同颜色
 */
@ccclass('MultiplierButton')
export class MultiplierButton extends Component {
    /** 按钮宽度 */
    private static readonly BTN_WIDTH = 60;
    /** 按钮高度 */
    private static readonly BTN_HEIGHT = 60;
    /** 圆角半径 */
    private static readonly CORNER_RADIUS = 20;
    /** 背景透明度 (0-255) */
    private static readonly BG_ALPHA = 255;
    /** 白色边框宽度 */
    private static readonly BORDER_WIDTH = 4;
    /** 字体大小 */
    private static readonly FONT_SIZE = 25;
    /** 自定义字体路径（resources 下，和账号区域共用同一个字体） */
    private static readonly CUSTOM_FONT_PATH = 'fonts/cute_font';

    /** 倍数档位对应的底色（文字统一白色加粗） */
    private static readonly MULTIPLIER_COLORS: Record<number, Color> = {
        1: new Color(38, 208, 243, 255),      // 天蓝色
        2: new Color(223, 121, 255, 255),      // 紫色
        4: new Color(255, 100, 172, 255),      // 玫红
    };

    private _graphics: Graphics | null = null;
    private _label: Label | null = null;
    private _currentMultiplier: number = 1;
    private _boundOnClick: ((event: EventTouch) => void) | null = null;
    private _boundOnMultiplierChanged: ((multiplier: number) => void) | null = null;

    /** 自定义字体缓存（静态，所有实例共享） */
    private static _customFont: Font | null = null;

    onLoad() {
        this.createVisual();
        this.registerEvents();
        this.loadCustomFont();
        this.refreshDisplay();
    }

    onDestroy() {
        this.unregisterEvents();
    }

    /**
     * 创建按钮视觉：背景圆角矩形 + 文字标签
     */
    private createVisual(): void {
        const transform = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        transform.setContentSize(MultiplierButton.BTN_WIDTH, MultiplierButton.BTN_HEIGHT);
        transform.setAnchorPoint(0.5, 0.5);

        this._graphics = this.node.addComponent(Graphics);
        this.drawBackground();

        const labelNode = new Node('Label');
        labelNode.setParent(this.node);
        labelNode.setPosition(new Vec3(0, 0, 0));
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(MultiplierButton.BTN_WIDTH - 20, MultiplierButton.BTN_HEIGHT - 10);
        this._label = labelNode.addComponent(Label);
        this._label.fontSize = MultiplierButton.FONT_SIZE;
        this._label.lineHeight = MultiplierButton.FONT_SIZE + 4;
        this._label.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._label.verticalAlign = Label.VerticalAlign.CENTER;
    }

    /**
     * 绘制按钮背景（当前倍数对应的底色，圆角矩形）
     */
    private drawBackground(): void {
        if (!this._graphics) return;
        this._graphics.clear();

        const w = MultiplierButton.BTN_WIDTH;
        const h = MultiplierButton.BTN_HEIGHT;
        const r = MultiplierButton.CORNER_RADIUS;

        const bgColor = MultiplierButton.MULTIPLIER_COLORS[this._currentMultiplier] || new Color(40, 40, 40, 255);
        this._graphics.fillColor = new Color(bgColor.r, bgColor.g, bgColor.b, MultiplierButton.BG_ALPHA);
        this._graphics.roundRect(-w / 2, -h / 2, w, h, r);
        this._graphics.fill();

        // 白色边框
        this._graphics.strokeColor = Color.WHITE;
        this._graphics.lineWidth = MultiplierButton.BORDER_WIDTH;
        this._graphics.roundRect(-w / 2, -h / 2, w, h, r);
        this._graphics.stroke();
    }

    /**
     * 加载自定义字体（.ttf/.otf），加载完成后应用到倍率文字
     */
    private loadCustomFont(): void {
        if (MultiplierButton._customFont) {
            if (this._label && this._label.node && this._label.node.isValid) {
                this._label.font = MultiplierButton._customFont;
            }
            return;
        }
        resources.load(MultiplierButton.CUSTOM_FONT_PATH, Font, (err, font) => {
            if (err || !font) {
                console.warn(`[MultiplierButton] 自定义字体加载失败: ${MultiplierButton.CUSTOM_FONT_PATH}，使用默认字体`);
                return;
            }
            MultiplierButton._customFont = font;
            if (this._label && this._label.node && this._label.node.isValid) {
                this._label.font = font;
            }
            console.log(`[MultiplierButton] 自定义字体加载成功: ${MultiplierButton.CUSTOM_FONT_PATH}`);
        });
    }

    /**
     * 注册触摸事件和倍数变化事件
     */
    private registerEvents(): void {
        this._boundOnClick = (event: EventTouch) => this.onClick(event);
        this._boundOnMultiplierChanged = (multiplier: number) => this.onMultiplierChanged(multiplier);
        this.node.on(Node.EventType.TOUCH_END, this._boundOnClick);
        EventManager.instance.on(EventManager.MULTIPLIER_CHANGED, this._boundOnMultiplierChanged);
    }

    private unregisterEvents(): void {
        if (this._boundOnClick) {
            this.node.off(Node.EventType.TOUCH_END, this._boundOnClick);
        }
        if (this._boundOnMultiplierChanged) {
            EventManager.instance.off(EventManager.MULTIPLIER_CHANGED, this._boundOnMultiplierChanged);
        }
    }

    /**
     * 点击切换倍数
     */
    private onClick(event: EventTouch): void {
        // 播放切换倍率音效
        AudioManager.instance.playSFX(AudioManager.SFX_MULTIPLIER_SWITCH);
        // 通过事件通知 GameManager 切换倍数，避免循环依赖
        EventManager.instance.emit(EventManager.MULTIPLIER_TOGGLE);
    }

    /**
     * 倍数变化回调
     */
    private onMultiplierChanged(multiplier: number): void {
        this._currentMultiplier = multiplier;
        this.refreshDisplay();
    }

    /**
     * 刷新显示（文字白色加粗 + 底色按倍数变化）
     */
    private refreshDisplay(): void {
        if (this._label) {
            this._label.string = `x${this._currentMultiplier}`;
            this._label.color = Color.WHITE;
            this._label.bold = true;
        }
        this.drawBackground();
    }

    /**
     * 设置当前倍数（由外部初始化时调用）
     */
    public setMultiplier(multiplier: number): void {
        this._currentMultiplier = multiplier;
        this.refreshDisplay();
    }
}
