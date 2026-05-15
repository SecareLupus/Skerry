"use client";

import React, { useCallback, useState } from "react";
import { highlight, languages } from "prismjs";
import type { Grammar } from "prismjs";

// Core language grammars — loaded eagerly so they're always available
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markup"; // HTML / XML
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-go";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-docker";

/** Map common aliases to the Prism language name. */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  html: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  yml: "yaml",
  dockerfile: "docker",
  docker: "docker",
  gql: "graphql",
  rs: "rust",
  cs: "csharp",
  cpp: "cpp",
  "c++": "cpp",
  jsx: "jsx",
  tsx: "tsx",
  md: "markdown",
  patch: "diff",
};

function resolveLanguage(className: string | undefined): string | null {
  if (!className) return null;
  const match = className.match(/language-(\S+)/);
  if (!match) return null;
  const raw = match[1]!.toLowerCase();
  const canonical = LANGUAGE_ALIASES[raw] ?? raw;
  return canonical;
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in non-HTTPS contexts; silently ignore.
    }
  }, [code]);

  // Highlight the code with Prism
  let highlightedHtml: string;
  let displayLanguage: string | null = null;

  try {
    const prismLang = resolveLanguage(language ? `language-${language}` : undefined);
    if (prismLang) {
      displayLanguage = prismLang;
      const grammar = (languages as Record<string, unknown>)[prismLang];
      if (grammar) {
        highlightedHtml = highlight(code, grammar as Grammar, prismLang);
        return (
          <div className="code-block-wrapper">
            <div className="code-block-header">
              <span className="code-block-lang">{displayLanguage}</span>
              <button
                className="code-block-copy-btn"
                onClick={handleCopy}
                aria-label={copied ? "Copied" : "Copy code"}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="code-block-pre">
              <code
                className={`language-${prismLang}`}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </pre>
          </div>
        );
      }
    }
    // No grammar found — render plain
    highlightedHtml = escapeHtml(code);
  } catch {
    highlightedHtml = escapeHtml(code);
  }

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        {displayLanguage && <span className="code-block-lang">{displayLanguage}</span>}
        <button
          className="code-block-copy-btn"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="code-block-pre">
        <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </pre>
    </div>
  );
}

/** Minimal HTML-escaping for fallback rendering. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
