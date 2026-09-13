/**
 * 玩家数据
 * 纯数据结构，由 ResourceManager 统一维护
 * 其他模块禁止直接修改字段
 */
export class PlayerData {
    private static _instance: PlayerData = new PlayerData();
    public static get instance(): PlayerData {
        return PlayerData._instance;
    }

    public level: number = 1;
    public energy: number = 0;
    public maxEnergy: number = 9999;
    public gold: number = 0;
    public diamond: number = 0;

    constructor() {
        // 初始资源随机范围
        this.energy = this.randomRange(600, 3200);
        this.gold = this.randomRange(32, 250);
        this.diamond = this.randomRange(16, 600);
    }

    /**
     * 生成 [min, max] 范围内的随机整数（包含两端）
     */
    private randomRange(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}