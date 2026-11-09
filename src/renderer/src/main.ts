import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

import router from './router'
import { initAuth } from './composables/useAuth'

import './assets/icon/iconfont.js' // 引入阿里图标字体
import './assets/icon/iconfont-logo.js' // 引入logo图标字体


const app = createApp(App)

app.use(createPinia())
app.use(router)

// 恢复登录态
initAuth()

app.mount('#app')
