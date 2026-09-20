import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '../lesson/blocks/CodeBlock';

/**
 * A tutor answer, rendered from Markdown.
 *
 * Every element is mapped onto the theme tokens rather than left to browser
 * defaults, because this app carries no typography plugin and an unstyled <ul>
 * inside a themed panel looks like a bug. The roles used here are the same ones the
 * lesson blocks use, so an answer sits beside the lesson without looking foreign.
 *
 * Fenced code goes through the lesson's own CodeBlock — the reader gets the same
 * language label and copy button they already know, and a tutor snippet is styled
 * identically to the lesson snippet it is explaining.
 *
 * Memoized on `content`. During streaming this re-renders on every token, and
 * re-parsing Markdown dozens of times a second for an answer that only grows at the
 * end is the one place this panel could feel slow.
 */
const components = {
  p: ({ children }) => <p className="my-2 text-sm leading-6 text-body first:mt-0 last:mb-0">{children}</p>,

  // No h1: the system prompt forbids a top-level heading, and one would out-shout
  // the lesson title next to it. Anything the model emits is demoted.
  h1: ({ children }) => <p className="mb-1 mt-3 text-sm font-semibold text-ink">{children}</p>,
  h2: ({ children }) => <p className="mb-1 mt-3 text-sm font-semibold text-ink">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-3 text-sm font-semibold text-ink">{children}</p>,

  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm leading-6 text-body">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-body">{children}</ol>,
  li: ({ children }) => <li className="marker:text-faint">{children}</li>,

  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,

  a: ({ children, href }) => (
    // Answers are model-generated, so any link in one is unverified. rel prevents it
    // from reaching back into this window.
    <a href={href} target="_blank" rel="noopener noreferrer nofollow"
       className="text-primary-text underline underline-offset-2 hover:text-primary-hover">
      {children}
    </a>
  ),

  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-line-strong pl-3 text-sm italic text-muted">{children}</blockquote>
  ),

  hr: () => <hr className="my-3 border-line" />,

  /**
   * Inline code only.
   *
   * react-markdown used to pass an `inline` flag here and no longer does — it was
   * removed in v9, so branching on it silently sends every inline `code` down the
   * fenced-block path and renders a word mid-sentence as a full code figure.
   *
   * The reliable split is structural rather than a flag: a fenced block is always
   * wrapped in <pre>, so `pre` below handles those and never renders its children.
   * Anything that reaches `code` is therefore inline by construction — including a
   * fence with no language, which a className sniff would misclassify.
   */
  code: ({ children }) => (
    <code className="rounded bg-subtle px-1 py-0.5 font-mono text-[0.8125rem] text-ink">
      {children}
    </code>
  ),

  /**
   * Fenced code.
   *
   * Renders CodeBlock INSTEAD of its children rather than around them: CodeBlock
   * emits its own <figure><pre>, and nesting that inside this <pre> would be invalid
   * markup and a doubled frame.
   */
  pre: ({ children }) => {
    const code = Array.isArray(children) ? children[0] : children;
    const className = code?.props?.className ?? '';
    const language = /language-([\w-]+)/.exec(className)?.[1] ?? 'plaintext';
    const text = String(code?.props?.children ?? '').replace(/\n$/, '');
    return <CodeBlock block={{ language, text }} />;
  },

  // Tables come from remark-gfm. Scrolls inside its own container so a wide table
  // never widens the panel.
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-line px-2 py-1 font-semibold text-ink">{children}</th>,
  td: ({ children }) => <td className="border-b border-line px-2 py-1 text-body">{children}</td>,
};

export const MarkdownAnswer = memo(({ content }) => (
  <Markdown remarkPlugins={[remarkGfm]} components={components}>
    {content}
  </Markdown>
));
