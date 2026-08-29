type EventCallback = (...args: any[]) => void;

/**
 * 事件管理器
 * 负责全局事件的订阅与派发
 */
export class EventManager {
    // ========== 资源变化 ==========
    public static readonly GOLD_CHANGED = 'GOLD_CHANGED';
    public static readonly ENERGY_CHANGED = 'ENERGY_CHANGED';
    public static readonly DIAMOND_CHANGED = 'DIAMOND_CHANGED';

    // ========== 棋盘变化 ==========
    public static readonly BOARD_CHANGED = 'BOARD_CHANGED';

    // ========== 物品事件 ==========
    public static readonly ITEM_SPAWNED = 'ITEM_SPAWNED';
    public static readonly ITEM_MERGED = 'ITEM_MERGED';

    // ========== 订单事件 ==========
    public static readonly ORDER_CHANGED = 'ORDER_CHANGED';
    public static readonly ORDER_STATUS_CHANGED = 'ORDER_STATUS_CHANGED';

    private static _instance: EventManager = new EventManager();
    public static get instance(): EventManager {
        return EventManager._instance;
    }

    private _listeners: Map<string, EventCallback[]> = new Map();

    /**
     * 订阅事件
     * @param event 事件名
     * @param callback 回调函数
     */
    public on(event: string, callback: EventCallback): void {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event)?.push(callback);
    }

    /**
     * 取消订阅事件
     * @param event 事件名
     * @param callback 回调函数
     */
    public off(event: string, callback: EventCallback): void {
        const callbacks = this._listeners.get(event);
        if (!callbacks) {
            return;
        }
        const index = callbacks.indexOf(callback);
        if (index >= 0) {
            callbacks.splice(index, 1);
        }
    }

    /**
     * 移除指定回调的所有事件监听
     * 用于组件销毁时一次性清理所有订阅
     * @param callback 要移除的回调函数
     */
    public offAll(callback: EventCallback): void {
        for (const [event, callbacks] of this._listeners) {
            const index = callbacks.indexOf(callback);
            if (index >= 0) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * 派发事件
     * @param event 事件名
     * @param args 参数
     */
    public emit(event: string, ...args: any[]): void {
        const callbacks = this._listeners.get(event);
        if (!callbacks) {
            return;
        }
        for (const callback of callbacks) {
            try {
                callback(...args);
            } catch (error) {
                console.error(`[EventManager] error in event ${event}:`, error);
            }
        }
    }
}
