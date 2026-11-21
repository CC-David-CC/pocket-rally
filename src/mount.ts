export interface Host {
  signal: AbortSignal;
  w?: {
    title?: string;
    ownerSub?: string;
    launchContext?: {version: 1; storage: 'mirror'; path: string; owner: string};
    pocketRally?: {dirty: boolean};
  };
  ui: {
    make(tag: string, className?: string, text?: string): HTMLElement;
    textButton(label: string, action: () => void): HTMLButtonElement;
    appInput(label: string, value?: string): HTMLInputElement;
    confirm(message: string, options?: {
      title?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
      signal?: AbortSignal;
    }): Promise<boolean>;
  };
  storage: {
    signedInSubject(): string | null;
    mirrorFileContext(): Promise<{
      owner: string;
      valid(): boolean;
      path(value: string): string;
      name(value: string): string;
      files: {
        read(path: string): Promise<{data: Uint8Array; version: string; status?: string}>;
        write(path: string, data: Uint8Array, version: string | null): Promise<{version: string; status?: string}>;
        stat?(path: string): Promise<{version: string; status?: string}>;
        subscribe?(callback: () => void): () => void;
      };
    }>;
    pickFile(options: {extensions: string[]; signal?: AbortSignal}): Promise<string | null>;
    pickFolder(options: {signal?: AbortSignal}): Promise<string | null>;
  };
}

export interface MountResult {
  element: HTMLElement;
  dispose(): void;
}

export function mount(host: Host): MountResult {
  const body = host.ui.make('div', 'window-content pocket-rally-app');
  const status = host.ui.make('div', 'app-status', 'Loading Pocket Rally…');
  body.append(status);
  const controller = new AbortController();
  let disposed = false;
  let view: {element: HTMLElement; dispose(): void} | null = null;
  const abort = () => controller.abort(host.signal?.reason || 'View removed');
  host.signal?.addEventListener('abort', abort, {once: true});
  if (host.signal?.aborted) abort();
  queueMicrotask(() => {
    void import('./view/run.ts').then(async ({startView}) => {
      if (disposed || controller.signal.aborted) return;
      const candidate = await startView(host, controller.signal);
      if (disposed) {
        candidate.dispose();
        return;
      }
      view = candidate;
      body.replaceChildren(view.element);
    }).catch(error => {
      if (!disposed && body.isConnected) {
        status.textContent = 'Could not start Pocket Rally: ' +
          (error instanceof Error ? error.message : 'unknown error');
      }
    });
  });
  return {
    element: body,
    dispose() {
      if (disposed) return;
      disposed = true;
      host.signal?.removeEventListener('abort', abort);
      controller.abort('View removed');
      view?.dispose();
      view = null;
    },
  };
}
