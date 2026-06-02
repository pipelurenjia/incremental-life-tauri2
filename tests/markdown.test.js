/**
 * markdown.js 测试 — 渲染基础 + XSS 防护
 */

import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderMarkdownInline } from '../src/markdown.js';

describe('renderMarkdown', () => {
  it('renders plain text as paragraph', () => {
    const html = renderMarkdown('Hello world');
    expect(html).toContain('<p>Hello world</p>');
  });

  it('preserves line breaks (breaks: true)', () => {
    const html = renderMarkdown('Line 1\nLine 2');
    expect(html).toContain('<br');
  });

  it('renders bold and italic', () => {
    const html = renderMarkdown('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders unordered lists', () => {
    const html = renderMarkdown('- one\n- two\n- three');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
  });

  it('renders code blocks', () => {
    const html = renderMarkdown('```\nlet x = 1\n```');
    expect(html).toContain('<code');
  });

  it('auto-linkifies URLs', () => {
    const html = renderMarkdown('See https://example.com for details');
    expect(html).toContain('https://example.com');
    expect(html).toContain('<a');
  });

  it('renders headings', () => {
    const html = renderMarkdown('# Title\n\nBody');
    expect(html).toContain('<h1>Title</h1>');
  });

  it('returns empty string for empty/null input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });

  it('escapes raw HTML to prevent XSS', () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML attributes', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('renderMarkdownInline', () => {
  it('renders inline text without wrapping <p>', () => {
    const html = renderMarkdownInline('just text');
    expect(html).not.toContain('<p>');
    expect(html.trim()).toBe('just text');
  });

  it('still applies inline formatting', () => {
    const html = renderMarkdownInline('**bold**');
    expect(html).toContain('<strong>bold</strong>');
  });
});
