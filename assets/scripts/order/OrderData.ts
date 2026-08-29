import { OrderItem } from './OrderItem';

/**
 * 订单数据
 */
export class OrderData {
    public id: string = '';
    public items: OrderItem[] = [];
    public reward: number = 0;

    constructor(config?: Partial<OrderData>) {
        if (config) {
            Object.assign(this, config);
        }
    }
}
