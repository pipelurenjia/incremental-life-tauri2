/**
 * 编辑表单校验
 */

export function validateTaskForm(title) {
  const errors = {};
  if (!title || !title.trim()) {
    errors.title = '标题不能为空';
  } else if (title.trim().length > 200) {
    errors.title = '标题不能超过 200 个字符';
  }
  return errors;
}

