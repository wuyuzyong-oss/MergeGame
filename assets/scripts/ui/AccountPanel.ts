import { _decorator, Component, Node, UITransform, Graphics, Color, Sprite, SpriteFrame, Texture2D, resources, Label, Mask, Vec3, Font } from 'cc';
import { EventManager } from '../core/EventManager';
import { PlayerData } from '../PlayerData';
import { MultiplierButton } from '../MultiplierButton';

const { ccclass, property } = _decorator;

/**
 * 顶部账号面板
 * 包含：头像（随机）+ 等级角标、体力、金币、钻石、倍率按钮
 *
 * 资源路径：
 *   头像：assets/resources/textures/avatar/ （多张，启动随机获取一张）
 *   体力icon：assets/resources/textures/ui/energy_icon.png
 *   金币icon：assets/resources/textures/ui/coin_icon.png
 *   钻石icon：assets/resources/textures/ui/diamond_icon.png
 *
 * 数据流：ResourceManager → EventManager → AccountPanel 监听 → 刷新 Label
 */
@ccclass('AccountPanel')
export class AccountPanel extends Component {
    // ==================== 常量（方便调整） ====================

    /** 面板宽度 */
    private static readonly PANEL_WIDTH = 1080;
    /** 面板高度 */
    private static readonly PANEL_HEIGHT = 120;

    /** 头像尺寸（宽=高，圆形） */
    private static readonly AVATAR_SIZE = 100;
    /** 头像X位置（相对于面板中心） */
    private static readonly AVATAR_X = -440;
    /** 头像Y位置 */
    private static readonly AVATAR_Y = 0;
    /** 头像包边宽度 */
    private static readonly AVATAR_BORDER_WIDTH = 8;
    /** 头像包边颜色 */
    private static readonly AVATAR_BORDER_COLOR = new Color(255, 255, 255, 255);

    /** 等级角标尺寸（宽=高，正方形icon） */
    private static readonly LEVEL_BADGE_SIZE = 50;
    /** 等级角标X位置（相对于面板中心，直接微调） */
    private static readonly LEVEL_BADGE_X = -480;
    /** 等级角标Y位置（相对于面板中心，直接微调） */
    private static readonly LEVEL_BADGE_Y = 30;

    /** 资源icon尺寸（体力/金币/钻石） */
    private static readonly ICON_SIZE = 60;
    /** icon与数字背景之间的间距 */
    private static readonly ICON_NUMBER_GAP = -30;

    /** 数字背景宽度 */
    private static readonly NUMBER_BG_WIDTH = 140;
    /** 数字背景高度 */
    private static readonly NUMBER_BG_HEIGHT = 46;
    /** 数字背景圆角半径 */
    private static readonly NUMBER_BG_RADIUS = 20;
    /** 数字背景填充色（白底） */
    private static readonly NUMBER_BG_FILL_COLOR = new Color(255, 255, 255, 235);
    /** 数字背景边框色（灰边） */
    private static readonly NUMBER_BG_BORDER_COLOR = new Color(180, 180, 180, 255);
    /** 数字背景边框宽度 */
    private static readonly NUMBER_BG_BORDER_WIDTH = 2;
    /** 数字字体大小 */
    private static readonly NUMBER_FONT_SIZE = 30;
    /** 数字在底色中的X偏移（正数=向右，因为左边被icon压住，数字需要右移） */
    private static readonly NUMBER_LABEL_OFFSET_X = 10;
    /** 数字字体颜色 */
    private static readonly NUMBER_FONT_COLOR = new Color(120, 70, 20, 255);
    /** 自定义字体路径（resources 下，放入 .ttf/.otf 后改这里） */
    private static readonly CUSTOM_FONT_PATH = 'fonts/cute_font';

    /** 第一个资源项（体力）的X位置 */
    private static readonly FIRST_ITEM_X = -250;
    /** 每个资源项之间的间距 */
    private static readonly ITEM_SPACING = 180;

    /** 倍率按钮X位置 */
    private static readonly MULTIPLIER_X = 430;
    /** 倍率按钮Y位置 */
    private static readonly MULTIPLIER_Y = 0;

    // ==================== 成员变量 ====================

    private _avatarSprite: Sprite | null = null;
    private _levelBadgeSprite: Sprite | null = null;
    private _energyLabel: Label | null = null;
    private _goldLabel: Label | null = null;
    private _goldIconNode: Node | null = null;
    private _diamondLabel: Label | null = null;
    private _multiplierButton: MultiplierButton | null = null;

    /** 图片缓存（静态，跨实例共享） */
    private static _spriteCache: Map<string, SpriteFrame> = new Map();
    /** 自定义字体缓存（静态，跨实例共享） */
    private static _customFont: Font | null = null;

    // ==================== 生命周期 ====================

    onLoad() {
        this.buildUI();
        this.bindEvents();
        this.loadCustomFont();
        this.loadRandomAvatar();
        this.loadRandomLevelBadge();
        this.refreshAll();
    }

    onDestroy(): void {
        EventManager.instance.offAll(this.onGoldChanged);
        EventManager.instance.offAll(this.onEnergyChanged);
        EventManager.instance.offAll(this.onDiamondChanged);
    }

    // ==================== 对外接口 ====================

    /** 获取倍率按钮组件（供 GameManager 初始化倍数） */
    public getMultiplierButton(): MultiplierButton | null {
        return this._multiplierButton;
    }

    /** 获取金币icon的世界坐标（供金币飞行动画使用） */
    public getGoldWorldPosition(): Vec3 | null {
        if (this._goldIconNode && this._goldIconNode.isValid) {
            return this._goldIconNode.getWorldPosition();
        }
        return null;
    }

    // ==================== UI 构建 ====================

    private buildUI(): void {
        // 面板容器
        const transform = this.node.addComponent(UITransform);
        transform.setContentSize(AccountPanel.PANEL_WIDTH, AccountPanel.PANEL_HEIGHT);
        transform.setAnchorPoint(0.5, 0.5);

        // 头像 + 等级角标
        this.buildAvatar();

        // 三个资源项：体力、金币、钻石
        this._energyLabel = this.createResourceItem(
            'EnergyItem',
            'textures/ui/energy_icon',
            AccountPanel.FIRST_ITEM_X,
            () => this.formatNumber(PlayerData.instance.energy)
        );
        this._goldLabel = this.createResourceItem(
            'GoldItem',
            'textures/ui/gold_icon',
            AccountPanel.FIRST_ITEM_X + AccountPanel.ITEM_SPACING,
            () => this.formatNumber(PlayerData.instance.gold)
        );
        this._diamondLabel = this.createResourceItem(
            'DiamondItem',
            'textures/ui/diamond_icon',
            AccountPanel.FIRST_ITEM_X + AccountPanel.ITEM_SPACING * 2,
            () => this.formatNumber(PlayerData.instance.diamond)
        );

        // 倍率按钮（最右边）
        this.buildMultiplierButton();
    }

    /**
     * 构建头像 + 等级角标
     */
    private buildAvatar(): void {
        // 头像白色包边（圆形背景，比头像稍大，在头像下层）
        const borderNode = new Node('AvatarBorder');
        const borderTransform = borderNode.addComponent(UITransform);
        const borderSize = AccountPanel.AVATAR_SIZE + AccountPanel.AVATAR_BORDER_WIDTH * 2;
        borderTransform.setContentSize(borderSize, borderSize);
        const borderGraphics = borderNode.addComponent(Graphics);
        borderGraphics.fillColor = AccountPanel.AVATAR_BORDER_COLOR;
        borderGraphics.circle(0, 0, borderSize / 2);
        borderGraphics.fill();
        borderNode.setParent(this.node);
        borderNode.setPosition(AccountPanel.AVATAR_X, AccountPanel.AVATAR_Y, 0);

        // 头像容器（带 Mask 圆形裁剪）
        const avatarContainer = new Node('AvatarContainer');
        const avatarTransform = avatarContainer.addComponent(UITransform);
        avatarTransform.setContentSize(AccountPanel.AVATAR_SIZE, AccountPanel.AVATAR_SIZE);
        const mask = avatarContainer.addComponent(Mask);
        mask.type = Mask.Type.ELLIPSE;
        avatarContainer.setParent(this.node);
        avatarContainer.setPosition(AccountPanel.AVATAR_X, AccountPanel.AVATAR_Y, 0);

        // 头像图片
        const avatarSpriteNode = new Node('AvatarSprite');
        const avatarSpriteTransform = avatarSpriteNode.addComponent(UITransform);
        avatarSpriteTransform.setContentSize(AccountPanel.AVATAR_SIZE, AccountPanel.AVATAR_SIZE);
        this._avatarSprite = avatarSpriteNode.addComponent(Sprite);
        this._avatarSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        avatarSpriteNode.setParent(avatarContainer);
        avatarSpriteNode.setPosition(0, 0, 0);

        // 等级角标（头像左上角，icon图片，从 level_badge 文件夹随机获取）
        // 注意：不能放在 avatarContainer 下，因为 Mask 圆形裁剪会把角标裁掉
        const badgeNode = new Node('LevelBadge');
        const badgeTransform = badgeNode.addComponent(UITransform);
        badgeTransform.setContentSize(AccountPanel.LEVEL_BADGE_SIZE, AccountPanel.LEVEL_BADGE_SIZE);
        this._levelBadgeSprite = badgeNode.addComponent(Sprite);
        this._levelBadgeSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        badgeNode.setParent(this.node);
        badgeNode.setPosition(
            AccountPanel.LEVEL_BADGE_X,
            AccountPanel.LEVEL_BADGE_Y,
            0
        );
    }

    /**
     * 创建一个资源项（icon + 白底圆角数字）
     * @param name 节点名称
     * @param iconPath icon图片路径（resources下）
     * @param x X位置
     * @param refreshFn 返回数字文本的函数
     * @returns Label引用，用于刷新
     */
    private createResourceItem(name: string, iconPath: string, x: number, refreshFn: () => string): Label {
        // 容器节点
        const container = new Node(name);
        const containerTransform = container.addComponent(UITransform);
        containerTransform.setContentSize(
            AccountPanel.ICON_SIZE + AccountPanel.ICON_NUMBER_GAP + AccountPanel.NUMBER_BG_WIDTH,
            Math.max(AccountPanel.ICON_SIZE, AccountPanel.NUMBER_BG_HEIGHT)
        );
        container.setParent(this.node);
        container.setPosition(x, 0, 0);

        // icon
        const iconNode = new Node('Icon');
        const iconTransform = iconNode.addComponent(UITransform);
        iconTransform.setContentSize(AccountPanel.ICON_SIZE, AccountPanel.ICON_SIZE);
        const iconSprite = iconNode.addComponent(Sprite);
        iconSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        iconNode.setParent(container);
        iconNode.setPosition(
            -(AccountPanel.NUMBER_BG_WIDTH + AccountPanel.ICON_NUMBER_GAP) / 2,
            0,
            0
        );
        this.loadSprite(iconPath, iconSprite);
        // 保存金币icon节点引用（用于金币飞行动画的终点）
        if (name === 'GoldItem') {
            this._goldIconNode = iconNode;
        }

        // 数字背景（白底灰边圆角矩形）
        const numberBgNode = new Node('NumberBg');
        const numberBgTransform = numberBgNode.addComponent(UITransform);
        numberBgTransform.setContentSize(AccountPanel.NUMBER_BG_WIDTH, AccountPanel.NUMBER_BG_HEIGHT);
        const numberBgGraphics = numberBgNode.addComponent(Graphics);
        // 填充
        numberBgGraphics.fillColor = AccountPanel.NUMBER_BG_FILL_COLOR;
        numberBgGraphics.roundRect(
            -AccountPanel.NUMBER_BG_WIDTH / 2,
            -AccountPanel.NUMBER_BG_HEIGHT / 2,
            AccountPanel.NUMBER_BG_WIDTH,
            AccountPanel.NUMBER_BG_HEIGHT,
            AccountPanel.NUMBER_BG_RADIUS
        );
        numberBgGraphics.fill();
        // 边框
        numberBgGraphics.strokeColor = AccountPanel.NUMBER_BG_BORDER_COLOR;
        numberBgGraphics.lineWidth = AccountPanel.NUMBER_BG_BORDER_WIDTH;
        numberBgGraphics.roundRect(
            -AccountPanel.NUMBER_BG_WIDTH / 2,
            -AccountPanel.NUMBER_BG_HEIGHT / 2,
            AccountPanel.NUMBER_BG_WIDTH,
            AccountPanel.NUMBER_BG_HEIGHT,
            AccountPanel.NUMBER_BG_RADIUS
        );
        numberBgGraphics.stroke();
        numberBgNode.setParent(container);
        numberBgNode.setPosition(
            (AccountPanel.ICON_SIZE + AccountPanel.ICON_NUMBER_GAP) / 2,
            0,
            0
        );
        // 底色移到最下层，让 icon 压住底色左边
        numberBgNode.setSiblingIndex(0);

        // 数字文字
        const numberLabelNode = new Node('Label');
        const numberLabelTransform = numberLabelNode.addComponent(UITransform);
        numberLabelTransform.setContentSize(AccountPanel.NUMBER_BG_WIDTH, AccountPanel.NUMBER_BG_HEIGHT);
        const numberLabel = numberLabelNode.addComponent(Label);
        numberLabel.fontSize = AccountPanel.NUMBER_FONT_SIZE;
        numberLabel.lineHeight = AccountPanel.NUMBER_BG_HEIGHT;
        numberLabel.color = AccountPanel.NUMBER_FONT_COLOR;
        numberLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        numberLabel.verticalAlign = Label.VerticalAlign.CENTER;
        numberLabel.overflow = Label.Overflow.SHRINK;
        numberLabel.bold = true;
        numberLabelNode.setParent(numberBgNode);
        numberLabelNode.setPosition(AccountPanel.NUMBER_LABEL_OFFSET_X, 0, 0);

        // 初始化显示
        numberLabel.string = refreshFn();
        // 保存刷新函数到节点上（通过闭包）
        (numberLabel as any)._refreshFn = refreshFn;

        return numberLabel;
    }

    /**
     * 构建倍率按钮
     */
    private buildMultiplierButton(): void {
        const btnNode = new Node('MultiplierButton');
        btnNode.addComponent(MultiplierButton);
        btnNode.setParent(this.node);
        btnNode.setPosition(AccountPanel.MULTIPLIER_X, AccountPanel.MULTIPLIER_Y, 0);
        this._multiplierButton = btnNode.getComponent(MultiplierButton);
    }

    // ==================== 图片加载 ====================

    /**
     * 随机加载一张头像
     */
    private loadRandomAvatar(): void {
        resources.loadDir('textures/avatar', Texture2D, (err, textures) => {
            if (err || !textures || textures.length === 0) {
                console.warn('[AccountPanel] 头像加载失败，请将图片放入 assets/resources/textures/avatar/');
                if (this._avatarSprite) {
                    const defaultFrame = this.createDefaultSpriteFrame(new Color(100, 100, 120, 255));
                    if (defaultFrame) {
                        this._avatarSprite.spriteFrame = defaultFrame;
                    }
                }
                return;
            }
            // 随机选一张，Texture2D 转 SpriteFrame
            const randomIndex = Math.floor(Math.random() * textures.length);
            const sf = new SpriteFrame();
            sf.texture = textures[randomIndex];
            if (this._avatarSprite && this._avatarSprite.node && this._avatarSprite.node.isValid) {
                this._avatarSprite.spriteFrame = sf;
            }
            console.log(`[AccountPanel] 随机头像: ${randomIndex + 1}/${textures.length}`);
        });
    }

    /**
     * 加载自定义字体（.ttf/.otf），加载完成后应用到所有数字 Label
     */
    private loadCustomFont(): void {
        if (AccountPanel._customFont) {
            this.applyFontToLabels();
            return;
        }
        resources.load(AccountPanel.CUSTOM_FONT_PATH, Font, (err, font) => {
            if (err || !font) {
                console.warn(`[AccountPanel] 自定义字体加载失败: ${AccountPanel.CUSTOM_FONT_PATH}，使用默认字体`);
                return;
            }
            AccountPanel._customFont = font;
            this.applyFontToLabels();
            console.log(`[AccountPanel] 自定义字体加载成功: ${AccountPanel.CUSTOM_FONT_PATH}`);
        });
    }

    /**
     * 把自定义字体应用到所有数字 Label
     */
    private applyFontToLabels(): void {
        if (!AccountPanel._customFont) return;
        const labels = [this._energyLabel, this._goldLabel, this._diamondLabel];
        for (const label of labels) {
            if (label && label.node && label.node.isValid) {
                label.font = AccountPanel._customFont;
            }
        }
    }

    /**
     * 数字格式化：>=1000 显示 k 格式（保留1位小数），否则显示原始数字
     * 例：999 -> "999"，1000 -> "1.0k"，8900 -> "8.9k"
     */
    private formatNumber(value: number): string {
        if (value >= 1000) {
            return (value / 1000).toFixed(1) + 'k';
        }
        return `${value}`;
    }

    /**
     * 随机加载一张等级角标icon
     */
    private loadRandomLevelBadge(): void {
        resources.loadDir('textures/level_badge', Texture2D, (err, textures) => {
            if (err || !textures || textures.length === 0) {
                console.warn('[AccountPanel] 等级角标加载失败，请将图片放入 assets/resources/textures/level_badge/');
                return;
            }
            // 随机选一张，Texture2D 转 SpriteFrame
            const randomIndex = Math.floor(Math.random() * textures.length);
            const sf = new SpriteFrame();
            sf.texture = textures[randomIndex];
            if (this._levelBadgeSprite && this._levelBadgeSprite.node && this._levelBadgeSprite.node.isValid) {
                this._levelBadgeSprite.spriteFrame = sf;
            }
            console.log(`[AccountPanel] 随机等级角标: ${randomIndex + 1}/${textures.length}`);
        });
    }

    /**
     * 加载单张图片（带缓存和容错）
     */
    private loadSprite(path: string, sprite: Sprite): void {
        // 检查缓存
        const cached = AccountPanel._spriteCache.get(path);
        if (cached) {
            sprite.spriteFrame = cached;
            return;
        }

        // 用 Texture2D 加载（图片导入类型为 texture 时，SpriteFrame 直接加载会失败）
        const tryLoad = (loadPath: string, onFail: () => void) => {
            resources.load(loadPath, Texture2D, (err, texture) => {
                if (err) { onFail(); return; }
                if (texture) {
                    const sf = new SpriteFrame();
                    sf.texture = texture;
                    AccountPanel._spriteCache.set(path, sf);
                    if (sprite && sprite.node && sprite.node.isValid) {
                        sprite.spriteFrame = sf;
                    }
                }
            });
        };

        // 主路径失败后尝试子路径 /texture
        tryLoad(path, () => {
            tryLoad(`${path}/texture`, () => {
                console.warn(`[AccountPanel] 图片加载失败: ${path}，请确认文件存在`);
                const defaultFrame = this.createDefaultSpriteFrame(new Color(150, 150, 150, 200));
                if (defaultFrame && sprite.node && sprite.node.isValid) {
                    sprite.spriteFrame = defaultFrame;
                }
            });
        });
    }

    /**
     * 创建默认色块 SpriteFrame（图片加载失败时用）
     */
    private createDefaultSpriteFrame(color: Color): SpriteFrame | null {
        try {
            const texture = new Texture2D();
            texture.reset({ width: 4, height: 4, format: Texture2D.PixelFormat.RGBA8888 });
            const data = new Uint8Array([
                color.r, color.g, color.b, color.a,
                color.r, color.g, color.b, color.a,
                color.r, color.g, color.b, color.a,
                color.r, color.g, color.b, color.a,
            ]);
            texture.uploadData(data);
            return new SpriteFrame(texture);
        } catch (e) {
            return null;
        }
    }

    // ==================== 事件绑定 ====================

    private onGoldChanged = (): void => this.refreshLabel(this._goldLabel);
    private onEnergyChanged = (): void => this.refreshLabel(this._energyLabel);
    private onDiamondChanged = (): void => this.refreshLabel(this._diamondLabel);

    private bindEvents(): void {
        EventManager.instance.on(EventManager.GOLD_CHANGED, this.onGoldChanged);
        EventManager.instance.on(EventManager.ENERGY_CHANGED, this.onEnergyChanged);
        EventManager.instance.on(EventManager.DIAMOND_CHANGED, this.onDiamondChanged);
    }

    // ==================== 刷新 ====================

    private refreshAll(): void {
        this.refreshLabel(this._energyLabel);
        this.refreshLabel(this._goldLabel);
        this.refreshLabel(this._diamondLabel);
    }

    private refreshLabel(label: Label | null): void {
        if (!label || !label.node || !label.node.isValid) return;
        const refreshFn = (label as any)._refreshFn;
        if (refreshFn) {
            label.string = refreshFn();
        }
    }
}
