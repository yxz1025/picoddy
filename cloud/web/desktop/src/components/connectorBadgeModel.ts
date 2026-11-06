const KNOWN_HUES: Readonly<Record<string, number>> = {
  gitlab: 24,
  jenkins: 345,
  tapd: 218,
  dingtalk: 190,
};

/** Stable connector identity, independent of selection order and connection status. */
export function connectorBadge(connector: { id: string; displayName: string }) {
  const id = connector.id.trim().toLowerCase();
  const label = connector.displayName.trim() || connector.id.trim();
  const initial = (label.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toLocaleUpperCase();
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return { initial, hue: KNOWN_HUES[id] ?? hash % 360 };
}

const CONNECTOR_LOGOS: Readonly<Record<string, string>> = {
  gitlab: '/logos/gitlab.png',
  jenkins: '/logos/jenkins.svg',
  tapd: '/logos/tapd.ico',
  dingtalk: '/logos/dingtalk.png',
  feishu: '/logos/lark.png',
  lark: '/logos/lark.png',
  lexiang: '/logos/lexiang.png',
  'qq-email': '/logos/qq-email.png',
  'qq-email-mcp': '/logos/qq-email.png',
  'tencent-docs': '/logos/tencent-docs.png',
  'tencent-meeting': '/logos/tencent-meeting.png',
  wecom: '/logos/wecom.png',
};
export function connectorLogo(connector: { id: string; icon?: string }): string | undefined {
  return CONNECTOR_LOGOS[connector.id.trim().toLowerCase()] || connector.icon;
}
