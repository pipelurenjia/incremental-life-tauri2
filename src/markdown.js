/**
 * markdown.js — markdown-it 渲染包装
 *
 * 设计：
 *  - html: false（默认）— MD 中的原始 HTML 会被转义，天然防 XSS
 *  - linkify: true — 自动识别 URL
 *  - breaks: true — 换行变 <br>（贴近 Obsidian 的"所见即所得"换行行为）
 *
 * 所有用户输入的 description 在此处渲染后通过 v-html 插入。
 * markdown-it 默认的 html:false 已经把 <script> 等转义为 &lt;script&gt;，
 * 不会执行恶意代码。生产环境如需更严格，可叠加 DOMPurify。
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

/**
 * 把 MD 文本渲染为 HTML 字符串。
 * 输入：原始 MD 文本（任务 description）
 * 输出：HTML 字符串
 */
export function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return '';
  return md.render(text);
}

/**
 * 渲染单行（去掉末尾换行），用于 inline 场景如 task card 备注。
 */
export function renderMarkdownInline(text) {
  if (!text || typeof text !== 'string') return '';
  return md.renderInline(text);
}
