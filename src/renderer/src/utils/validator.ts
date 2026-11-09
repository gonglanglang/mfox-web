// 全局校验函数
export interface ValidationRule {
  key: string;                    // 要校验的 props 字段名
  message: string;                // 校验失败时的提示语
  validator?: (value: any) => boolean; // 自定义校验逻辑，不传则使用默认非空校验
}

interface ValidationResult {
  valid: boolean;
  message: string;
}

/**
 * 默认校验：非 undefined、非 null、非空字符串（可 trim 判断）
 */
const defaultValidator = (v: any): boolean => {
  const value = typeof v === 'string' ? v?.trim() : v
  // 1. 先排除 null / undefined
  if (value === undefined || value === null) return false;

  // 2. 字符串：去除首尾空格后判断长度
  if (typeof value === 'string') {
    return value?.trim().length > 0;
  }

  // 3. 数组：判断长度
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  // 4. 其他类型（数字、布尔、对象等）：只要值存在就算通过
  //    （注意：0 和 false 也会返回 true，如果你希望它们返回 false，可以按需调整）
  return true;
};

/**
 * 通用校验函数
 * @param props 待校验的对象（如组件的 props）
 * @param rules 校验规则数组
 * @returns { valid: boolean, message?: string }
 */
export function validateProps<T extends Record<string, any>>(
  props: T,
  rules: ValidationRule[]
): ValidationResult {
  for (const rule of rules) {
    const value = props[rule.key];
    const isValid = rule.validator 
      ? rule.validator(value) 
      : defaultValidator(value);
    if (!isValid) {
      return { valid: false, message: rule.message || '校验失败' };
    }
  }
  return { valid: true, message: '校验通过' };
}
