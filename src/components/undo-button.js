/**
 * 撤销按钮辅助
 */

export function canUndo(stack) {
  return stack && stack.length > 0;
}
