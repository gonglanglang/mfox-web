import { get, post } from './request'

export interface RechargeOrderResult {
  /** 商户订单号 */
  orderNo: string
  /** 微信 Native 收款码内容（用于渲染二维码） */
  codeUrl: string
  /** 实付金额（分） */
  amount: number
  /** 到账积分 */
  points: number
  /** 支付截止时间（ISO，下单后 1 小时内有效） */
  expireAt: string
}

export interface RechargeOrderStatus {
  orderNo: string
  planId: number
  /** pending 待支付 / paid 已到账 / closed 已关闭 */
  status: 'pending' | 'paid' | 'closed'
  amount: number
  points: number
  paidAt: string | null
  transactionId: string
  /** 支付截止时间（ISO，pending 时用于展示/倒计时） */
  expireAt: string
}

/** 充值订单（列表项） */
export interface RechargeOrder extends RechargeOrderStatus {
  createdAt: string
}

/** 订单查询参数（分页 + 状态过滤） */
export interface OrderListQuery {
  page?: number
  pageSize?: number
  status?: RechargeOrder['status'] | 'all'
}

/** 分页订单列表结果 */
export interface OrderListResult {
  list: RechargeOrder[]
  total: number
  page: number
  pageSize: number
}

export const payApi = {
  /** 创建充值订单（微信 Native 扫码支付） */
  createOrder(planId: number) {
    return post<RechargeOrderResult>('/pay/orders', { planId })
  },

  /** 我的充值订单列表（分页，最新在前，默认 10 条/页） */
  orderList(params?: OrderListQuery) {
    return get<OrderListResult>('/pay/orders', { ...params })
  },

  /** 查询订单支付状态（前端轮询用） */
  orderStatus(orderNo: string) {
    return get<RechargeOrderStatus>(`/pay/orders/${orderNo}`)
  },

  /** 继续支付：关闭原待支付单并新建同套餐订单，返回新收款码 */
  continuePay(orderNo: string) {
    return post<RechargeOrderResult>(`/pay/orders/${orderNo}/pay`)
  },

  /** 取消待支付订单 */
  cancelOrder(orderNo: string) {
    return post<{ canceled: boolean }>(`/pay/orders/${orderNo}/cancel`)
  },
}
