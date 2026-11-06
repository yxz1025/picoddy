// Generated widgets need scripts, but must never inherit the application's origin.
export const APP_CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const widgetCdns = 'https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com';
export const WIDGET_HOST_CSP = `default-src 'none'; sandbox allow-scripts; script-src 'unsafe-inline' 'unsafe-eval' blob: ${widgetCdns}; style-src 'unsafe-inline'; img-src 'self' data: blob: ${widgetCdns}; font-src ${widgetCdns}; connect-src ${widgetCdns}; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`;
