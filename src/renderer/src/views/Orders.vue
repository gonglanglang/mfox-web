<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import QRCode from 'qrcode'
import { useRouter } from 'vue-router'
import { payApi, type RechargeOrder, type RechargeOrderResult, type OrderListResult } from '@/api/pay'
import { useAuth } from '@/composables/useAuth'
import { useToast } from '@/composables/useToast'
import AppModal from '@/components/AppModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
/* 工具函数 */
import { formatNumber } from '@/utils/index'


const router = useRouter()
const { isLoggedIn } = useAuth()
const { show: showToast } = useToast()

const PAGE_SIZE = 10

// ============================================
// 列表数据（服务端分页）
// ============================================
const loading = ref(false)
const loadError = ref('')
const orders = ref<RechargeOrder[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(PAGE_SIZE)
/** 到期自动刷新防抖 */
const refreshingExpired = ref(false)

type StatusFilter = 'all' | RechargeOrder['status']
const filter = ref<StatusFilter>('all')
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待支付' },
  { key: 'paid', label: '已到账' },
  { key: 'closed', label: '已关闭' },
]

const STATUS_META: Record<RechargeOrder['status'], { label: string; cls: string }> = {
  pending: { label: '待支付', cls: 'badge-warning' },
  paid: { label: '已到账', cls: 'badge-success' },
  closed: { label: '已关闭', cls: 'badge-ghost' },
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

/** 分页页码列表：少于 7 页全列，否则 1 … cur±1 … n 省略式 */
function pageItems(): (number | string)[] {
  const n = totalPages.value
  const c = page.value
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  const set = new Set<number>([1, n, c - 1, c, c + 1])
  const items: (number | string)[] = []
  let prev = 0
  for (const v of [...set].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b)) {
    if (v - prev > 1) items.push('…')
    items.push(v)
    prev = v
  }
  return items
}

// ============================================
// 倒计时（pending 支付截止剩余时间）
// ============================================
const nowMs = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

function remainMs(o: RechargeOrder): number {
  const target = new Date(o.expireAt).getTime()
  return Number.isNaN(target) ? 0 : Math.max(0, target - nowMs.value)
}

function remainSec(o: RechargeOrder): number {
  return Math.ceil(remainMs(o) / 1000)
}

function cdValue(o: RechargeOrder, unit: 'h' | 'm' | 's'): number {
  const s = remainSec(o)
  if (unit === 'h') return Math.floor(s / 3600)
  if (unit === 'm') return Math.floor((s % 3600) / 60)
  return s % 60
}

// ============================================
// 数据加载
// ============================================
async function loadOrders(): Promise<void> {
  if (!isLoggedIn.value) return
  loading.value = true
  loadError.value = ''
  try {
    const data: OrderListResult = await payApi.orderList({
      page: page.value,
      pageSize: pageSize.value,
      ...(filter.value === 'all' ? {} : { status: filter.value }),
    })
    // 页码越界（如取消/删除后总页数减少）自动回退到最后一页
    const tp = Math.max(1, Math.ceil(data.total / data.pageSize))
    if (!data.list.length && data.total > 0 && page.value > tp) {
      page.value = tp
      return loadOrders()
    }
    orders.value = data.list
    total.value = data.total
    pageSize.value = data.pageSize
  } catch (err: any) {
    loadError.value = err?.message || '订单加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function setFilter(key: StatusFilter): void {
  if (filter.value === key) return
  filter.value = key
  page.value = 1
  loadOrders()
}

function gotoPage(p: number): void {
  const tp = totalPages.value
  const target = Math.min(Math.max(1, p), tp)
  if (target === page.value) return
  page.value = target
  loadOrders()
}

// ============================================
// 订单详情
// ============================================
const detailOrder = ref<RechargeOrder | null>(null)

function viewDetail(o: RechargeOrder): void {
  detailOrder.value = o
}

// ============================================
// 继续支付 / 取消订单 / 支付二维码弹窗
// ============================================
const payingOrder = ref<RechargeOrderResult | null>(null)
const payQrDataUrl = ref('')
const busyOrderNo = ref('')
let payPollTimer: ReturnType<typeof setInterval> | null = null

function stopPayPolling(): void {
  if (payPollTimer) {
    clearInterval(payPollTimer)
    payPollTimer = null
  }
}

function closePayQr(): void {
  stopPayPolling()
  payingOrder.value = null
  payQrDataUrl.value = ''
  loadOrders() // 刷新列表（旧单关闭/新单/到账状态）
}

/** 订单列表「继续支付」：后端关闭原单并新建同套餐订单，返回新收款码 */
async function continuePay(o: RechargeOrder): Promise<void> {
  if (busyOrderNo.value) return
  busyOrderNo.value = o.orderNo
  try {
    const result = await payApi.continuePay(o.orderNo)
    payingOrder.value = result
    payQrDataUrl.value = await QRCode.toDataURL(result.codeUrl, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
    pollPayment()
  } catch (err: any) {
    showToast(err?.message || '发起支付失败，请重试', 'error')
    loadOrders()
  } finally {
    busyOrderNo.value = ''
  }
}

/** 轮询支付状态（2s/次），到账/超时自动收尾 */
function pollPayment(): void {
  stopPayPolling()
  const orderNo = payingOrder.value?.orderNo
  if (!orderNo) return
  const expireMs = payingOrder.value?.expireAt
    ? new Date(payingOrder.value.expireAt).getTime()
    : Date.now() + 60 * 60 * 1000
  let tries = 0
  payPollTimer = setInterval(async () => {
    tries += 1
    try {
      const st = await payApi.orderStatus(orderNo)
      if (st.status === 'paid') {
        stopPayPolling()
        showToast(`充值成功，+${formatNumber(st.points)} 积分`, 'success')
        closePayQr()
      } else if (st.status === 'closed' || Date.now() >= expireMs || tries > 1800) {
        stopPayPolling()
        showToast('订单已关闭（超时未支付），请重新发起', 'info')
        closePayQr()
      }
    } catch {
      // 网络抖动等暂时失败：继续轮询
    }
  }, 2000)
}

/** 弹窗内“我已完成支付”立即查询一次 */
async function checkPaidNow(): Promise<void> {
  if (!payingOrder.value) return
  try {
    const st = await payApi.orderStatus(payingOrder.value.orderNo)
    if (st.status === 'paid') {
      stopPayPolling()
      showToast(`充值成功，+${formatNumber(st.points)} 积分`, 'success')
      closePayQr()
    } else {
      showToast('还未检测到支付，请确认已完成付款', 'info')
    }
  } catch (err: any) {
    showToast(err?.message || '查询失败，请重试', 'error')
  }
}

/** 取消订单二次确认 */
const cancelTarget = ref<RechargeOrder | null>(null)
const cancelMessage = computed(() =>
  cancelTarget.value ? `确定要取消订单「${cancelTarget.value.orderNo}」吗？\n取消后如需支付请重新发起充值。` : '',
)

function askCancel(o: RechargeOrder): void {
  cancelTarget.value = o
}

/** 确认取消订单 */
async function doCancelOrder(): Promise<void> {
  const o = cancelTarget.value
  if (!o || busyOrderNo.value) return
  busyOrderNo.value = o.orderNo
  try {
    const { canceled } = await payApi.cancelOrder(o.orderNo)
    showToast(canceled ? '订单已取消' : '订单状态已变化，请刷新查看', canceled ? 'success' : 'info')
    cancelTarget.value = null
    loadOrders()
  } catch (err: any) {
    showToast(err?.message || '取消失败，请重试', 'error')
    cancelTarget.value = null
    loadOrders()
  } finally {
    busyOrderNo.value = ''
  }
}

// ============================================
// 工具函数
// ============================================
function fmtTime(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

function fmtMoney(fen: number): string {
  return `¥${(fen / 100).toFixed(fen % 100 === 0 ? 0 : 2)}`
}

onMounted(() => {
  loadOrders()
  // 每秒刷新倒计时；若出现到期订单则自动刷新列表（后端会把超时单置 closed）
  clockTimer = setInterval(() => {
    nowMs.value = Date.now()
    if (!refreshingExpired.value && orders.value.some((o) => o.status === 'pending' && remainSec(o) <= 0)) {
      refreshingExpired.value = true
      loadOrders().finally(() => {
        refreshingExpired.value = false
      })
    }
  }, 1000)
})

onBeforeUnmount(() => {
  stopPayPolling()
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <!-- 整页 flex 布局：头部/状态栏/分页器固定，列表占剩余空间滚动 -->
  <div class="h-dvh flex flex-col bg-base-200/30 overflow-hidden">
    <!-- 顶部导航（固定） -->
    <header class="shrink-0 h-14 border-b border-base-200 bg-base-100 flex items-center px-4">
      <button class="btn btn-ghost btn-xs btn-square shrink-0 mr-3" @click="router.back()" title="返回上一页">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span class="text-lg font-bold">订单信息</span>
    </header>

    <!-- 订单状态栏（固定）：状态过滤 + 总数 -->
    <div
      class="shrink-0 border-b border-base-200 bg-base-100/80 backdrop-blur px-4 py-2 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 flex-wrap">
        <button v-for="f in FILTERS" :key="f.key" class="btn btn-xs"
          :class="filter === f.key ? 'btn-primary' : 'btn-ghost'" @click="setFilter(f.key)">{{ f.label }}</button>
      </div>
      <span v-if="total > 0" class="text-xs text-base-content/60 shrink-0">共 {{ total }} 条</span>
    </div>

    <!-- 订单列表滚动区：flex-1 占满剩余空间，超出滚动 -->
    <main class="flex-1 min-h-0 overflow-y-auto">
      <!-- 加载中 -->
      <div v-if="loading" class="flex flex-col items-center gap-2 py-16 text-base-content/50">
        <span class="loading loading-spinner loading-lg"></span>
        <span class="text-sm">订单加载中…</span>
      </div>

      <!-- 未登录 -->
      <div v-else-if="!isLoggedIn"
        class="card bg-base-100 border border-base-200 py-16 text-center text-base-content/50">
        <p class="mb-3">请先登录后查看订单信息</p>
      </div>

      <!-- 加载失败 -->
      <div v-else-if="loadError" class="card bg-base-100 border border-base-200 py-10 text-center">
        <p class="text-base-content/60 mb-3">{{ loadError }}</p>
        <button class="btn btn-sm btn-primary mx-auto" @click="loadOrders">重新加载</button>
      </div>

      <!-- 空态 -->
      <div v-else-if="!orders.length"
        class="card bg-base-100 border border-base-200 py-16 text-center text-base-content/50">
        <svg class="h-12 w-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
        <p>{{ filter === 'all' ? '还没有充值订单' : '该状态下暂无订单' }}</p>
        <p v-if="filter === 'all'" class="text-xs mt-1">点击右上角积分，充值后即可在AI功能中使用</p>
      </div>

      <!-- 订单列表（表格） -->
      <div v-else class="w-full max-w-5xl mx-auto px-4 py-2">
        <div class="overflow-x-auto rounded-2xl border border-base-200 bg-base-100">
          <table class="table table-sm">
            <thead>
              <tr class="text-xs text-base-content/60">
                <th>订单号</th>
                <th>金额</th>
                <th>积分</th>
                <th>状态</th>
                <th>下单时间</th>
                <th>支付剩余</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in orders" :key="o.orderNo" class="hover">
                <td class="font-mono text-xs cursor-pointer text-primary hover:underline" @click="viewDetail(o)">
                  {{ o.orderNo }}
                </td>
                <td class="font-bold">{{ fmtMoney(o.amount) }}</td>
                <td class="text-success font-medium">+{{ formatNumber(o.points) }}</td>
                <td><span class="badge badge-sm" :class="STATUS_META[o.status].cls">{{ STATUS_META[o.status].label }}</span></td>
                <td class="text-xs text-base-content/60">{{ fmtTime(o.createdAt) }}</td>
                <td>
                  <span v-if="o.status === 'pending'" class="countdown font-mono text-xs text-warning">
                    <span :style="`--value:${cdValue(o, 'h')};--digits:2;`" aria-live="polite"></span>:
                    <span :style="`--value:${cdValue(o, 'm')};--digits:2;`" aria-live="polite"></span>:
                    <span :style="`--value:${cdValue(o, 's')};--digits:2;`" aria-live="polite"></span>
                  </span>
                  <span v-else class="text-xs text-base-content/40">—</span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-2">
                    <button class="btn btn-xs btn-ghost" @click="viewDetail(o)">详情</button>
                    <template v-if="o.status === 'pending'">
                      <button class="btn btn-xs btn-ghost" :disabled="!!busyOrderNo" @click="askCancel(o)">
                        {{ busyOrderNo === o.orderNo ? '处理中…' : '取消' }}
                      </button>
                      <button class="btn btn-xs btn-primary" :disabled="!!busyOrderNo" @click="continuePay(o)">
                        {{ busyOrderNo === o.orderNo ? '处理中…' : '继续支付' }}
                      </button>
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>

    <!-- 分页器（固定底部） -->
    <footer class="shrink-0 border-t border-base-200 bg-base-100 px-4 py-2.5 flex items-center justify-center gap-3">
      <!-- <span class="text-sm text-base-content/60">共 {{ total }} 条 / 第 {{ page }} 页</span> -->
      <div class="flex items-center gap-1">
        <button class="btn btn-sm" :disabled="page <= 1 || loading" @click="gotoPage(page - 1)">上一页</button>
        <template v-for="(it, i) in pageItems()" :key="`${it}-${i}`">
          <button v-if="typeof it === 'number'" class="btn btn-sm" :class="it === page ? 'btn-primary' : 'btn-ghost'"
            :disabled="loading" @click="gotoPage(it)">{{ it }}</button>
          <span v-else class="px-1 text-base-content/40 text-xs">…</span>
        </template>
        <button class="btn btn-sm" :disabled="page >= totalPages || loading" @click="gotoPage(page + 1)">下一页</button>
      </div>
    </footer>

    <!-- 订单详情弹窗 -->
    <AppModal :open="!!detailOrder" @close="detailOrder = null">
      <div v-if="detailOrder" class="modal-box rounded-2xl">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-base">订单详情</h3>
          <span class="badge" :class="STATUS_META[detailOrder.status].cls">{{ STATUS_META[detailOrder.status].label
            }}</span>
        </div>

        <dl class="mt-4 space-y-2 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-base-content/50 shrink-0">套餐积分</dt>
            <dd class="text-success font-medium">{{ formatNumber(detailOrder.points) }} 积分</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-base-content/50 shrink-0">实付金额</dt>
            <dd class="font-bold">{{ fmtMoney(detailOrder.amount) }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-base-content/50 shrink-0">订单号</dt>
            <dd class="text-right break-all">{{ detailOrder.orderNo }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-base-content/50 shrink-0">下单时间</dt>
            <dd class="text-right">{{ fmtTime(detailOrder.createdAt) }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-base-content/50 shrink-0">支付时间</dt>
            <dd class="text-right">{{ fmtTime(detailOrder.paidAt) }}</dd>
          </div>
          <div v-if="detailOrder.status === 'pending'" class="flex justify-between gap-4">
            <dt class="text-base-content/50 shrink-0">支付截止</dt>
            <dd class="text-right text-warning">{{ fmtTime(detailOrder.expireAt) }}</dd>
          </div>
          <div v-if="detailOrder.transactionId" class="flex justify-between gap-4">
            <dt class="text-base-content/50 shrink-0">微信交易号</dt>
            <dd class="text-right break-all">{{ detailOrder.transactionId }}</dd>
          </div>
        </dl>

        <div class="modal-action">
          <button class="btn btn-sm btn-primary" @click="detailOrder = null">知道了</button>
        </div>
      </div>
    </AppModal>

    <!-- 继续支付二维码弹窗 -->
    <AppModal :open="!!payingOrder" @close="closePayQr">
      <div v-if="payingOrder" class="modal-box rounded-2xl px-6 py-5 flex flex-col items-center gap-3">
        <h3 class="font-bold text-base self-start">扫码支付</h3>
        <p class="text-sm text-base-content/70">
          应付 <span class="font-bold text-primary text-lg">{{ fmtMoney(payingOrder.amount) }}</span>
          ，到账 <span class="text-success font-bold">{{ formatNumber(payingOrder.points) }}</span> 积分
        </p>
        <img v-if="payQrDataUrl" :src="payQrDataUrl" alt="微信支付二维码"
          class="border border-base-300 rounded-xl p-2 bg-white" style="width: 260px; height: 260px" />
        <p class="text-sm text-base-content/70">请使用<strong class="text-success">微信</strong>扫一扫完成支付</p>
        <p v-if="payingOrder.expireAt" class="text-xs text-base-content/50">
          请在 {{ fmtTime(payingOrder.expireAt) }} 前完成支付
        </p>
        <div class="flex items-center gap-2">
          <button class="btn btn-sm btn-primary" @click="checkPaidNow">我已完成支付</button>
          <button class="btn btn-sm btn-ghost" @click="closePayQr">关闭</button>
        </div>
      </div>
    </AppModal>

    <!-- 取消订单二次确认 -->
    <ConfirmModal
      :open="!!cancelTarget"
      title="取消订单"
      :message="cancelMessage"
      confirm-text="确认取消"
      cancel-text="再想想"
      danger
      :loading="busyOrderNo === cancelTarget?.orderNo"
      @confirm="doCancelOrder"
      @cancel="cancelTarget = null"
    />
  </div>
</template>
