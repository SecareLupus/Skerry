"use client";

import React, { useEffect } from "react";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markup"; // HTML as well

interface CodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    language: "html" | "css";
    placeholder?: string;
    style?: React.CSSProperties;
    onUploadImage?: () => Promise<string | null>;
}

export function CodeEditor({ value, onChange, language, placeholder, style, onUploadImage }: CodeEditorProps) {
    // Determine Prism language
    const prismLanguage = language === "html" ? languages.markup : languages.css;

    if (!prismLanguage) {
        return <div style={{ color: 'var(--danger)', padding: '1rem' }}>Failed to load Prism language: {language}</div>;
    }

    return (
        <div className="code-editor-wrapper" style={{ 
            position: 'relative', 
            border: '1px solid var(--border)', 
            borderRadius: '8px',
            overflow: 'hidden',
            background: 'var(--surface-alt)',
            ...style
        }}>
            <div className="code-editor-toolbar" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.25rem 0.75rem',
                borderBottom: '1px solid var(--border)',
                background: 'var(--surface)',
                fontSize: '0.75rem',
                color: 'var(--text-muted)'
            }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                    {language}
                </span>
                {onUploadImage && (
                    <button 
                        onClick={async (e) => {
                            e.preventDefault();
                            const url = await onUploadImage();
                            if (url) {
                                const imgTag = `<img src="${url}" alt="" style="max-width: 100%; height: auto;" />`;
                                onChange(value + "\n" + imgTag);
                            }
                        }}
                        style={{
                            padding: '2px 8px',
                            fontSize: '0.7rem',
                            background: 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Upload & Insert Image
                    </button>
                )}
            </div>
            <div className="code-editor-scroll-container" style={{ 
                maxHeight: '400px', 
                overflow: 'auto',
                // Enable horizontal scrolling
                whiteSpace: 'pre' 
            }}>
                <Editor
                    value={value}
                    onValueChange={onChange}
                    highlight={(code) => highlight(code, prismLanguage, language === "html" ? "markup" : "css")}
                    padding={16}
                    placeholder={placeholder}
                    style={{
                        fontFamily: '"Fira Code", "Fira Mono", "JetBrains Mono", monospace',
                        fontSize: 14,
                        minHeight: '150px',
                        outline: 'none',
                    }}
                    className="skerry-code-editor"
                />
            </div>
            <style jsx global>{`
                .skerry-code-editor {
                    min-width: 100%;
                    width: max-content;
                }
                .skerry-code-editor textarea,
                .skerry-code-editor pre {
                    outline: none !important;
                    white-space: pre !important; 
                    overflow-wrap: normal !important;
                    min-width: 100% !important;
                    width: max-content !important;
                }
                
                /* Simple Prism Theme Overrides to match Skerry */
                .token.comment, .token.prolog, .token.doctype, .token.cdata { color: var(--text-muted); opacity: 0.7; }
                .token.punctuation { color: var(--text); opacity: 0.8; }
                .token.namespace { opacity: .7; }
                .token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted { color: var(--accent); }
                .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: var(--accent-strong); }
                .token.operator, .token.entity, .token.url, .language-css .token.string, .style .token.string { color: var(--text); }
                .token.atrule, .token.attr-value, .token.keyword { color: var(--accent); font-weight: 600; }
                .token.function, .token.class-name { color: var(--accent-strong); }
                .token.regex, .token.important, .token.variable { color: #e90; }
            `}</style>
        </div>
    );
}
