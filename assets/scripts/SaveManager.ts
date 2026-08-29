/**
 * 存档管理器
 * 负责本地持久化玩家进度、棋盘状态、金币体力等数据
 */
export class SaveManager {
    private static readonly SAVE_KEY = 'MergeGame_SaveData';

    /**
     * 保存数据到本地存储
     */
    public save(data: any): void {
        try {
            localStorage.setItem(SaveManager.SAVE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('Save failed:', e);
        }
    }

    /**
     * 从本地存储读取数据
     */
    public load(): any {
        try {
            const raw = localStorage.getItem(SaveManager.SAVE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.error('Load failed:', e);
            return null;
        }
    }

    /**
     * 清空存档
     */
    public clear(): void {
        localStorage.removeItem(SaveManager.SAVE_KEY);
    }
}
