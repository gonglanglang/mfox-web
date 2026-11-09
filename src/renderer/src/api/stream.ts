import { get } from './request'
import { streamSSE } from './sse'

/** 获取微信登录二维码 */
type WechatQrResponse = { qrcodeUrl: string; scene_str: string };
export async function fetchWechatQr(): Promise<WechatQrResponse> {
  const res = await get<WechatQrResponse>(`/auth/wechat/code`);
  return res;
}

/** 轮询微信登录状态 */
type WechatStatusResponse = {
  status: "pending" | "ok" | "expired";
  token?: string;
};
export async function checkWechatStatus(
  sceneStr: string,
): Promise<WechatStatusResponse> {
  const res = await get<WechatStatusResponse>(
    `/auth/wechat/status?scene_str=${encodeURIComponent(sceneStr)}`,
  );
  console.log("查询状态", res);
  return res;
}

interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (err: Error) => void;
}

interface PolishResult {
  taskId: string;
  abort: () => void;
}

/**
 * SSE 流式请求 — AI 润色（task 模式）
 * 对应后端 POST /api/agent/:type/stream（type = polish）
 */
export function streamPolish(
  content: string, // 待润色的内容
  genre: string, // 小说题材
  audience: string, // 目标读者（后端字段 targetAudience）
  pov: string, // 小说视角
  model: string, // 模型
  callbacks: StreamCallbacks, // 回调函数
): PolishResult {
  const base = import.meta.env.VITE_API_BASE_URL || "/api";
  const url = `${base}/agent/polish/stream`;
  let fullText = "";
  let taskId = "";

  // 保存任务 ID 到 localStorage（legacy 恢复用；当前恢复主要依赖后端任务列表）
  const saveTask = (id: string) => {
    taskId = id;
    const tasks = JSON.parse(localStorage.getItem("_recovery_tasks") || "[]");
    tasks.push({
      taskId: id,
      route: window.location.hash || "#/",
      type: "polish",
    });
    localStorage.setItem("_recovery_tasks", JSON.stringify(tasks));
  };

  const removeTask = () => {
    const tasks = JSON.parse(localStorage.getItem("_recovery_tasks") || "[]");
    const filtered = tasks.filter((t: any) => t.taskId !== taskId);
    localStorage.setItem("_recovery_tasks", JSON.stringify(filtered));
  };
  console.log("model", model)
  const sse = streamSSE(url, {
    method: "POST",
    headers: {
      'aiModel': model, // 选择的模型
    },
    body: { content, genre, pov, audience },
    onMessage(data) {
      if (data === "[DONE]") {
        removeTask();
        callbacks.onDone(fullText);
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "task" && parsed.taskId) {
          saveTask(parsed.taskId);
          return;
        }
        const chunk = parsed?.token || "";
        if (chunk) {
          fullText += chunk;
          callbacks.onToken(chunk);
        }
      } catch {
        fullText += data;
        callbacks.onToken(data);
      }
    },
    onError(err) {
      console.log("连接错误", err);
      callbacks.onError(err);
    },
  });

  return { taskId, abort: sse.abort };
}

// ============================================
// AI 小说生成工作流（SSE → 步骤事件）
// ============================================
export function streamAiNovel(
  model: string, // 模型
  params: {
    description: string; // 作品简介
    length: string; // 长度
    audience: string; // 目标受众
    pov: string; // 视角
    genre: string; // 题材风格
    stepsConfig: string; // 步骤配置
    workId?: number; // 已有作品ID（续写/新卷章模式：跳过创建作品步骤）
    volumeId?: number; // 已有卷ID（生成下一章模式：跳过创建卷，直接在该卷下建章）
    previousChapterId?: number; // 上一章章节ID（内部查询其内容作为续写上下文）
    previousVolumeId?: number; // 上一章所在卷ID
  },
  callbacks: {
    onStepStart: (step: string) => void;
    onStepDone: (step: string, output: any) => void;
    onChunk: (text: string) => void;
    onDone: (steps: any[]) => void;
    onError: (err: Error) => void;
  },
) {
  const base = import.meta.env.VITE_API_BASE_URL || "/api";
  const url = `${base}/agent/ainovel/workflows`;
  const steps: any[] = [];

  const sse = streamSSE(url, {
    method: "POST",
    body: {
      ...params,
      type: 'aiNovel', // 任务类型
    },
    headers: {
      'aiModel': model, // 选择的模型
    },
    onMessage(data) {
      if (data === "[DONE]") {
        callbacks.onDone(steps);
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "task" || parsed.type === "workflow-start") return;
        if (parsed.type === "workflow-finish") {
          if (parsed.payload?.workflowStatus === "failed") {
            callbacks.onError(
              new Error(
                parsed.payload?.metadata?.errorMessage || "工作流执行失败",
              ),
            );
          }
          return;
        }

        if (parsed.type === "workflow-step-start") {
          const name = parsed.payload?.stepName || parsed.payload?.id || "";
          steps.push({ name, status: "running", output: null });
          callbacks.onStepStart(name);
        } else if (parsed.type === "workflow-step-result") {
          const name = parsed.payload?.stepName || parsed.payload?.id || "";
          const output = parsed.payload?.output || {};
          const s = steps.find((st: any) => st.name === name);
          if (s) {
            s.status = "done";
            s.output = output;
          }
          callbacks.onStepDone(name, output);
        } else if (parsed.chunk) {
          // 步骤 3 的流式 token
          callbacks.onChunk?.(parsed.chunk);
        }
      } catch {
        /* skip non-JSON */
      }
    },
    onError(err) {
      callbacks.onError(err);
    },
  });

  return { abort: sse.abort };
}
