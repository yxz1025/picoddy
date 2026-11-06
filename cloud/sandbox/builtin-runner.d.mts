export function executeBuiltinRequest(request: Record<string, unknown>, dependencies?: { fetch?: (url: string, options: any) => Promise<Response> }): Promise<any>;
