// Explicit temporary-sandbox probe. Never adds a connector to a business account.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { probeConnectorInSandbox } from '../src/platform/connector-sandbox.ts';
import { createSandbox, reconcileRunSandboxes } from '../src/platform/sandbox.ts';

const tools = await probeConnectorInSandbox(loadConfig(), randomUUID(), {
  transport: 'stdio', command: 'node',
  args: ['/opt/picoddy/node_modules/pi-web-access/dist/mcp-cli.js'],
});
assert.deepEqual(tools.map(tool => tool.name).sort(), ['fetch_content', 'get_search_content', 'source_check', 'web_search']);
console.log(JSON.stringify({ connectorProbe: 'passed', tools: tools.map(tool => tool.name), sandboxCleanedUp: true }));

const config = loadConfig();
const id = randomUUID();
let sandbox;
try {
  sandbox = await createSandbox(config, id, AbortSignal.timeout(60_000));
  await sandbox.write('/workspace/.oauth-live.mjs', Buffer.from(`
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { parseOAuthRequest, executeOAuthRequest } from '/opt/picoddy/oauth-runner.mjs';
const origin = 'http://127.0.0.1:3401';
let challenge, exchanges=0, refreshes=0;
const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url.startsWith('/.well-known/oauth-protected-resource')) return res.end(JSON.stringify({resource:origin+'/mcp',authorization_servers:[origin],scopes_supported:['tools:read']}));
  if(req.url.startsWith('/.well-known/')) return res.end(JSON.stringify({issuer:origin,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256']}));
  if(req.url==='/token') {
    let body='';for await(const part of req)body+=part;
    const input=new URLSearchParams(body);
    if(input.get('grant_type')==='authorization_code') {
      assert.equal(input.get('code'),'fixture-code');
      assert.equal(createHash('sha256').update(input.get('code_verifier')).digest('base64url'),challenge);exchanges++;
    } else {assert.equal(input.get('grant_type'),'refresh_token');assert.equal(input.get('refresh_token'),'fixture-refresh');refreshes++;}
    return res.end(JSON.stringify({access_token:'fixture-access-'+refreshes,refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:3600}));
  }
  res.writeHead(401,{'www-authenticate':'Bearer resource_metadata="'+origin+'/.well-known/oauth-protected-resource/mcp"'});res.end('{}');
});
await new Promise(resolve=>server.listen(3401,'127.0.0.1',resolve));
try {
  const base={serverUrl:origin+'/mcp',redirectUrl:'http://localhost:8080/api/mcp/oauth/callback',allowInsecureLoopback:true,clientId:'fixture-client',scope:'tools:read',state:'fixture-state'};
  const started=await executeOAuthRequest(parseOAuthRequest({...base,operation:'begin'}));
  const url=new URL(started.authorizationUrl);
  assert.equal(url.searchParams.get('state'),'fixture-state');assert.equal(url.searchParams.get('code_challenge_method'),'S256');challenge=url.searchParams.get('code_challenge');assert.ok(challenge);
  const exchanged=await executeOAuthRequest(parseOAuthRequest({...base,operation:'exchange',authorizationCode:'fixture-code',providerState:started.state}));
  assert.ok(exchanged.state.tokens.access_token);
  const refreshed=await executeOAuthRequest(parseOAuthRequest({...base,operation:'refresh',providerState:exchanged.state}));
  assert.equal(exchanges,1);assert.equal(refreshes,1);assert.equal(refreshed.state.tokens.access_token,'fixture-access-1');
  console.log(JSON.stringify({oauthSandbox:'passed',pkce:true,exchange:true,refresh:true}));
} finally {server.close();}
`));
  const result = await sandbox.exec('node /workspace/.oauth-live.mjs', AbortSignal.timeout(60_000));
  assert.equal(result.exitCode, 0, result.stderr);
  console.log(result.stdout.trim());
} finally {
  await sandbox?.destroy();
  await reconcileRunSandboxes(config, id);
}
