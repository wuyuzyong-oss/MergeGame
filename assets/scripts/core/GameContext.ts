import { Node } from 'cc';
import type { BoardManager } from '../BoardManager';

/**
 * GameManager 组件的公共接口形状
 * 用于避免其他模块直接 import GameManager 导致的循环依赖
 *
 * 使用方式：
 *   const gm = getGameContext();
 *   gm?.boardManager.getCell(...)
 */
export interface GameContextShape {
    readonly boardManager: BoardManager | null;
    readonly boardPanel: Node | null;
    readonly orderPanel: Node | null;
    readonly accountPanel: Node | null;
}

/** 全局游戏上下文引用，由 GameManager 在 onLoad 时注册 */
let _gameContext: GameContextShape | null = null;

/**
 * 注册游戏上下文
 * 由 GameManager.onLoad() 调用，将自身注册为全局可访问的上下文
 */
export function setGameContext(ctx: GameContextShape): void {
    _gameContext = ctx;
}

/**
 * 运行时获取 GameManager 组件引用
 * 所有需要访问 GameManager 的模块统一使用此方法，避免静态 import 产生循环依赖
 */
export function getGameContext(): GameContextShape | null {
    return _gameContext;
}
