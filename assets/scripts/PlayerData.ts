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
    public energy: number = 8888;
    public maxEnergy: number = 9999;
    public gold: number = 0;
    public diamond: number = 5;
}
