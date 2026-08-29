import { PlayerData } from '../PlayerData';
import { EventManager } from '../core/EventManager';

/**
 * 资源管理器
 * 统一负责金币、体力、钻石等资源的增减
 * 所有模块都应通过 ResourceManager 操作资源，禁止直接修改 PlayerData
 */
export class ResourceManager {
    private static _instance: ResourceManager = new ResourceManager();
    public static get instance(): ResourceManager {
        return ResourceManager._instance;
    }

    // ========== 金币 ==========

    public addGold(amount: number): void {
        PlayerData.instance.gold += amount;
        console.log(`[Resource] Gold +${amount}, total: ${PlayerData.instance.gold}`);
        EventManager.instance.emit(EventManager.GOLD_CHANGED, PlayerData.instance.gold);
    }

    public consumeGold(amount: number): boolean {
        if (PlayerData.instance.gold < amount) {
            console.log('[Resource] consumeGold failed: not enough gold');
            return false;
        }
        PlayerData.instance.gold -= amount;
        console.log(`[Resource] Gold -${amount}, total: ${PlayerData.instance.gold}`);
        EventManager.instance.emit(EventManager.GOLD_CHANGED, PlayerData.instance.gold);
        return true;
    }

    // ========== 体力 ==========

    public addEnergy(amount: number): void {
        PlayerData.instance.energy = Math.min(PlayerData.instance.energy + amount, PlayerData.instance.maxEnergy);
        console.log(`[Resource] Energy +${amount}, total: ${PlayerData.instance.energy}`);
        EventManager.instance.emit(EventManager.ENERGY_CHANGED, PlayerData.instance.energy);
    }

    public consumeEnergy(amount: number): boolean {
        if (PlayerData.instance.energy < amount) {
            console.log('[Resource] consumeEnergy failed: not enough energy');
            return false;
        }
        PlayerData.instance.energy -= amount;
        console.log(`[Resource] Energy -${amount}, total: ${PlayerData.instance.energy}`);
        EventManager.instance.emit(EventManager.ENERGY_CHANGED, PlayerData.instance.energy);
        return true;
    }

    // ========== 钻石 ==========

    public addDiamond(amount: number): void {
        PlayerData.instance.diamond += amount;
        console.log(`[Resource] Diamond +${amount}, total: ${PlayerData.instance.diamond}`);
        EventManager.instance.emit(EventManager.DIAMOND_CHANGED, PlayerData.instance.diamond);
    }

    public consumeDiamond(amount: number): boolean {
        if (PlayerData.instance.diamond < amount) {
            console.log('[Resource] consumeDiamond failed: not enough diamond');
            return false;
        }
        PlayerData.instance.diamond -= amount;
        console.log(`[Resource] Diamond -${amount}, total: ${PlayerData.instance.diamond}`);
        EventManager.instance.emit(EventManager.DIAMOND_CHANGED, PlayerData.instance.diamond);
        return true;
    }

    // ========== 测试接口 ==========

    public addTestResources(): void {
        console.log('[Resource] addTestResources');
        this.addGold(1000);
        this.addEnergy(50);
        this.addDiamond(10);
    }
}
