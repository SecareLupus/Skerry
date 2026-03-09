"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{ padding: "16px", margin: "16px", border: "1px solid #fecaca", backgroundColor: "#fef2f2", borderRadius: "8px", color: "#991b1b" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "8px" }}>Something went wrong</h2>
          <p style={{ fontSize: "14px", marginBottom: "12px", fontFamily: "monospace" }}>
            {this.state.error.message}
          </p>
          <button
            onClick={this.handleReset}
            style={{ padding: "8px 12px", backgroundColor: "#dc2626", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "14px" }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
