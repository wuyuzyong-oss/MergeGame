/**
 * 纯物品数据结构
 * 不继承任何 Component，也不依赖 Cocos Node
 * 负责描述物品的配置属性与运行时状态
 */
export class ItemData {
    /**
     * 物品配置 ID，例如 "towel_lv1"
     */
    public itemId: string = '';

    /**
     * 所属合成链 ID，例如 "towel"
     */
    public chainId: string = '';

    /**
     * 物品等级
     */
    public level: number = 1;

    /**
     * 当前所在棋盘列
     */
    public col: number = -1;

    /**
     * 当前所在棋盘行
     */
    public row: number = -1;

    /**
     * 是否为发射器
     */
    public isGenerator: boolean = false;

    /**
     * 发射器剩余寿命，普通物品为 0
     */
    public generatorLife: number = 0;

    /**
     * 最大等级，0 表示未知或未配置（默认可合成）
     * 后续应由配置表填充
     */
    public maxLevel: number = 0;

    constructor(config?: Partial<ItemData>) {
        if (config) {
            Object.assign(this, config);
        }
    }

    /**
     * 判断当前等级是否已达最大等级
     */
    public isMaxLevel(): boolean {
        return this.maxLevel > 0 && this.level >= this.maxLevel;
    }
}
