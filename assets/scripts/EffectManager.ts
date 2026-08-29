import { Vec2 } from 'cc';

/**
 * 特效管理器
 * 负责合成特效、订单完成动画、金币飞行等视觉反馈
 */
export class EffectManager {
    /**
     * 播放合成成功特效
     */
    public playMergeEffect(position: Vec2): void {
        // TODO
    }

    /**
     * 播放金币飞向顶部动画
     */
    public playCoinFly(start: Vec2, end: Vec2, amount: number): void {
        // TODO
    }

    /**
     * 播放订单完成动画
     */
    public playOrderCompleteEffect(orderId: string): void {
        // TODO
    }
}
