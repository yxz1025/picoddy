import { createServer } from 'node:http';
import { openSitePreview, serveSitePreview } from '../../preview/node/site.ts';
let origin: Promise<string> | undefined;
/** Dedicated loopback origin: saved HTML never shares the desktop API origin. */
export async function browserPreviewUrl(file: string): Promise<string> {
    const path = await openSitePreview(file);
    origin ??= new Promise((resolve, reject) => {
        const server = createServer(async (req, res) => {
            try {
                const url = new URL(req.url || '/', 'http://127.0.0.1');
                const response = url.pathname.startsWith('/api/preview/site/')
                    ? await serveSitePreview(url, req.method)
                    : new Response('Not found', { status: 404 });
                res.statusCode = response.status;
                response.headers.forEach((v, k) => res.setHeader(k, v));
                res.setHeader('Content-Security-Policy', "connect-src 'self' https:; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'");
                res.end(Buffer.from(await response.arrayBuffer()));
            }
            catch {
                res.writeHead(500);
                res.end('Preview failed');
            }
        });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (address && typeof address !== 'string')
                resolve(`http://127.0.0.1:${address.port}`);
        });
        server.unref();
    }).catch(error => { origin = undefined; throw error; });
    return `${await origin}${path}`;
}
