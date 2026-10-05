type Context = { registerTool: (tool: any) => unknown; unregisterTool: (name: string) => unknown };
const pending = new WeakMap<object, Promise<unknown>>();
// Serialize registration lifetimes so a late old cleanup cannot remove a new page's tool.
export function registerPageTools(context: Context, tools: any[], report: (status: string) => void) {
  let closed = false; let finish: () => void; const lifetime = new Promise<void>(resolve => { finish = resolve; });
  const ready = (pending.get(context) || Promise.resolve()).catch(() => {}).then(async () => {
    const registered: string[] = [];
    try {
      if (closed) return;
      for (const tool of tools) {
        if (closed) break;
        await context.registerTool(tool); registered.push(tool.name);
      }
      if (!closed) { report('Two native tools registered. Await browser discovery and invocation.'); await lifetime; }
    } catch (error) { if (!closed) report(`Registration failed: ${error.message}`); }
    finally { for (const name of registered) { try { await context.unregisterTool(name); } catch { if (!closed) report('Native tool cleanup failed; reload this page before retrying.'); } } }
  });
  pending.set(context, ready);
  return { ready, close: () => { closed = true; finish!(); } };
}
