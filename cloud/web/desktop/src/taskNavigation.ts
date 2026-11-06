const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function taskIdFromUrl(href: string): string | null {
  const id = new URL(href).searchParams.get('taskId');
  return id && TASK_ID.test(id) ? id : null;
}

interface TaskBrowser {
  location: { href: string };
  history: {
    state: unknown;
    pushState(state: unknown, title: string, url: string): void;
    replaceState(state: unknown, title: string, url: string): void;
  };
}

export function syncTaskUrl(id: string | null, browser: TaskBrowser = window, replace = false): void {
  const url = new URL(browser.location.href);
  if (id) url.searchParams.set('taskId', id);
  else url.searchParams.delete('taskId');
  if (url.href === browser.location.href) return;
  browser.history[replace ? 'replaceState' : 'pushState'](browser.history.state, '', url.href);
}
