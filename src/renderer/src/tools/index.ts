/**
 * 延迟指定时间后执行函数，返回 Promise
 * @param fn    - 要执行的函数
 * @param time  - 延迟毫秒数
 * @returns     执行结果
 * @example
 * const result = await asyncTask(() => fetch('/api'), 2000)
 */
export function asyncTask<T = void>(fn: () => T, time: number = 1200): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(fn())
    }, time)
  })
}