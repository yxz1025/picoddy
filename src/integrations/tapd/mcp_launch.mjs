import { posix, win32 } from 'node:path';

// mcp-server-tapd 8.0.81 omits company_id in its shared project lookup.
// Apply the fix in memory before importing server, including callers that
// discover a project implicitly. Never edit site-packages or persist a token.
export const TAPD_MCP_BOOTSTRAP = String.raw`
import re
from mcp_server_tapd.tapd import TAPDClient

_original_projects = TAPDClient.get_user_participant_projects

def _projects_with_company(self, data):
    params = dict(data or {})
    if self.headers.get("Authorization", "").startswith("Bearer "):
        identity = self._make_request("GET", "users/info")
        user = identity.get("data") or {}
        company_id = str(user.get("current_company_id") or "")
        if identity.get("status") != 1 or not re.fullmatch(r"[1-9][0-9]{0,31}", company_id):
            raise RuntimeError("TAPD_COMPANY_CONTEXT_MISSING")
        params["company_id"] = company_id
        if not params.get("nick"):
            params["nick"] = user.get("nick")
    return _original_projects(self, params)

TAPDClient.get_user_participant_projects = _projects_with_company
from mcp_server_tapd.server import main
main()
`;

/** Use the same private Python environment as the installed MCP executable. */
export function tapdMcpLaunch(command, args = []) {
  const windows = command.includes('\\') || /\.exe$/i.test(command);
  const path = windows ? win32 : posix;
  if (!/^mcp-server-tapd(?:\.exe)?$/i.test(path.basename(command))) {
    throw new Error('TAPD_MCP_COMMAND_UNSUPPORTED: use the installed mcp-server-tapd executable');
  }
  const interpreter = windows || process.platform === 'win32' ? 'python.exe' : 'python';
  return { command: path.join(path.dirname(command), interpreter), args: ['-c', TAPD_MCP_BOOTSTRAP, ...args] };
}
