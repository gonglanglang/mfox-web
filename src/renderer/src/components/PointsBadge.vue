<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import QRCode from 'qrcode'
/* 工具函数 */
import { formatNumber } from '@/utils/index'

import { useAuth, SKIP_AUTH_MODE } from '@/composables/useAuth'
import { useToast } from '@/composables/useToast'
import AppModal from '@/components/AppModal.vue'
import { payApi, type RechargeOrderResult } from '@/api/pay'

const { user, refreshUser, openLogin } = useAuth()
const { show: showToast } = useToast()

const open = ref(false) // 充值弹窗
const paying = ref(false) // 正在创建订单
const order = ref<RechargeOrderResult | null>(null) // 当前支付订单
const qrDataUrl = ref('') // 二维码 dataURL
let pollTimer: ReturnType<typeof setInterval> | null = null

interface RechargePlan {
  id: number
  price: number
  points: number
  tag?: string
  /** 单价（元/积分），动态计算 */
  unitPrice: number
}

// 积分充值套餐（6 档：金额越大，单积分单价越低；每元积分平滑递增）
// ⚠️ 金额/积分以后端 pay.ts PLANS 为准，这里仅用于展示；id 与后端套餐 id 对应（1-6）
const rawPlans: Omit<RechargePlan, 'unitPrice' | 'id'>[] = [
  { price: 9.9, points: 1000 },
  { price: 29.9, points: 3200, tag: '热门' },
  { price: 68, points: 7500 },
  { price: 128, points: 15000 },
  { price: 258, points: 32000 },
  { price: 518, points: 68000, tag: '超值' },
]

// 动态计算单价（元/积分），避免手工维护不一致
const plans: RechargePlan[] = rawPlans.map((p, i) => ({
  ...p,
  id: i + 1,
  unitPrice: Number((p.price / p.points).toFixed(4)),
}))

// ============================================
// 支付流程
// ============================================
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** 关闭充值弹窗（含支付页），停止轮询并复位 */
function closeRecharge() {
  stopPolling()
  order.value = null
  qrDataUrl.value = ''
  open.value = false
}

/** 返回套餐列表页（不关单，旧待支付单会在下次下单时由后端自动关闭） */
function backToPlans() {
  stopPolling()
  order.value = null
  qrDataUrl.value = ''
}

async function buy(plan: RechargePlan) {
  if (!user.value) {
    showToast('请先登录后再充值', 'info')
    openLogin()
    return
  }
  try {
    paying.value = true
    const result = await payApi.createOrder(plan.id)
    order.value = result
    const dataUrl = await QRCode.toDataURL(result.codeUrl, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
    qrDataUrl.value = dataUrl
    startPolling(result.orderNo, result.expireAt)
  } catch (err: any) {
    showToast(err?.message || '创建订单失败，请重试', 'error')
  } finally {
    paying.value = false
  }
}

/**
 * 轮询订单状态：2s/次，直至支付成功或订单到期（后端 1 小时后自动置 closed）。
 * 成功后刷新积分并关闭弹窗。
 */
function startPolling(orderNo: string, expireAt?: string): void {
  stopPolling()
  // 支付截止时刻（毫秒）；取不到时按 60 分钟兜底
  const expireMs = expireAt ? new Date(expireAt).getTime() : Date.now() + 60 * 60 * 1000
  let tries = 0
  pollTimer = setInterval(async () => {
    tries += 1
    try {
      const st = await payApi.orderStatus(orderNo)
      if (st.status === 'paid') {
        stopPolling()
        showToast(`充值成功，+${formatNumber(st.points)} 积分`, 'success')
        await refreshUser()
        closeRecharge()
      } else if (st.status === 'closed' || Date.now() >= expireMs || tries > 1800) {
        stopPolling()
        order.value = null
        qrDataUrl.value = ''
        showToast('订单已关闭（超时未支付），请重新发起充值', 'info')
      }
    } catch {
      // 网络抖动等暂时失败：继续轮询
    }
  }, 2000)
}

/** 用户扫码完成后手动点击「我已完成支付」立即查一次 */
async function checkPaidNow() {
  if (!order.value) return
  try {
    const st = await payApi.orderStatus(order.value.orderNo)
    if (st.status === 'paid') {
      stopPolling()
      showToast(`充值成功，+${formatNumber(st.points)} 积分`, 'success')
      await refreshUser()
      closeRecharge()
    } else {
      showToast('还未检测到支付，请确认已完成付款', 'info')
    }
  } catch (err: any) {
    showToast(err?.message || '查询失败，请重试', 'error')
  }
}

onBeforeUnmount(stopPolling)
</script>

<template>
  <!-- 测试模式徽章：免登录、免Token验证、免积分扣费 -->
  <span
    v-if="SKIP_AUTH_MODE"
    class="badge badge-soft badge-success badge-sm gap-1 px-2.5 py-3 shrink-0"
    title="当前处于临时测试模式：已关闭登录弹窗、Token强校验与积分扣除"
  >
    免登·免积分
  </span>

  <!-- 积分徽章：点击弹出充值弹窗 -->
  <button v-else class="btn btn-sm badge badge-soft badge-primary" title="积分" @click.stop="open = true">
    <svg class="icon" aria-hidden="true">
      <use xlink:href="#icon-jifen"></use>
    </svg>
    {{ formatNumber(user?.points ?? 0) }}
  </button>

  <!-- 充值弹窗 -->
  <AppModal v-if="!SKIP_AUTH_MODE" :open="open" @close="closeRecharge">
    <div v-if="open" class="modal-box rounded-2xl p-0 overflow-hidden pb-4" style="min-width: 720px">
      <div class="flex items-center justify-between px-5 py-4 border-b border-base-200">
        <h3 class="font-bold text-sm">充值积分</h3>
        <button class="btn btn-sm btn-ghost btn-circle" @click="closeRecharge">✕</button>
      </div>

      <!-- 支付二维码页 -->
      <div v-if="order" class="px-4 py-6 flex flex-col items-center gap-3">
        <p class="text-sm text-base-content/70">
          订单金额 <span class="font-bold text-primary text-lg">¥{{ (order.amount / 100).toFixed(order.amount % 100 === 0 ? 0 : 2) }}</span>
          ，到账 <span class="font-bold text-primary">{{ formatNumber(order.points) }}</span> 积分
        </p>
        <img
          v-if="qrDataUrl"
          :src="qrDataUrl"
          alt="微信支付二维码"
          class="border border-base-300 rounded-xl p-2 bg-white"
          style="width: 260px; height: 260px"
        />
        <p class="text-sm text-base-content/70">请使用<strong class="text-success">微信</strong>扫一扫完成支付</p>
        <div class="flex items-center gap-2">
          <button class="btn btn-sm btn-primary" @click="checkPaidNow">我已完成支付</button>
          <button class="btn btn-sm btn-ghost" @click="backToPlans">重新选择套餐</button>
        </div>
      </div>

      <!-- 套餐选择页 -->
      <template v-else>
        <div class="px-4">
          <div class="text-sm text-base-content/60 mb-3">
            当前积分：<span class="font-bold text-primary">{{ formatNumber(user?.points ?? 0) }}</span>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div v-for="p in plans" :key="p.price"
              class="relative card border border-base-300 hover:border-primary transition-colors mb-2">
              <span v-if="p.tag" class="badge badge-xs badge-warning absolute -top-2 left-2">{{ p.tag }}</span>
              <div class="card-body p-3">
                <div class="text-xl font-bold">¥{{ p.price }}</div>
                <div class="text-xs text-base-content/60">{{ formatNumber(p.points) }} 积分</div>
                <div class="text-xs text-base-content/40">≈¥{{ p.unitPrice }}元/积分</div>
                <button class="btn btn-sm btn-primary mt-2" :disabled="paying" @click="buy(p)">
                  {{ paying ? '创建订单中…' : '购买' }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <!-- 温馨提示 -->
        <div class="px-4">
          <div role="alert" class="alert">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              class="stroke-current text-info h-6 w-6 shrink-0">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>购买的积分仅供使用AI生成功能，不可用于其他用途</span>
          </div>
        </div>
      </template>
    </div>
  </AppModal>
</template>
