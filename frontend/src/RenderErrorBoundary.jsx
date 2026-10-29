import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default class RenderErrorBoundary extends React.Component {
  state = { error: null, componentStack: "" };

  static getDerivedStateFromError(error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error, info) {
    const componentStack = info?.componentStack || "Component stack unavailable.";
    console.error(`[SocialCastly] Render failure in ${this.props.scope || "UI section"}`, error, componentStack);
    this.setState({ componentStack });
  }

  reset = () => this.setState({ error: null, componentStack: "" });

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    const compact = this.props.compact === true;
    return <section role="alert" className={`rounded-2xl border border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-100 ${compact ? "p-4" : "mx-auto my-8 max-w-3xl p-6 sm:p-8"}`}>
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200"><AlertTriangle size={18} /></span><div className="min-w-0 flex-1"><h2 className=" text-sm font-extrabold">{this.props.scope || "This section"} hit a display error</h2><p className="mt-1 break-words text-xs leading-5">{error.message || String(error)}</p></div></div>
      {componentStack && <details className="mt-3 rounded-xl border border-rose-200/80 bg-white/60 p-3 text-[10px] dark:border-rose-900/50 dark:bg-slate-950/40"><summary className="cursor-pointer font-bold">Show component stack</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono leading-4">{componentStack}</pre></details>}
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={this.reset} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-3 py-2 text-[10px] font-bold text-white"><RotateCcw size={12} />Try rendering again</button><button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-rose-200 px-3 py-2 text-[10px] font-bold dark:border-rose-800">Reload app</button></div>
    </section>;
  }
}
