interface ConnectorActionLoaderProps {
  size?: number;
  label?: string;
}

export default function ConnectorActionLoader({
  size = 20,
  label = "正在安装连接器",
}: ConnectorActionLoaderProps) {
  return (
    <svg
      className="connector-action-loader"
      width={size}
      height={size}
      viewBox="0 0 50 50"
      role="img"
      aria-label={label}
      aria-busy="true"
    >
      <circle
        className="connector-action-loader__track"
        cx="25"
        cy="25"
        r="20"
        strokeWidth="4"
      />
      <circle
        className="connector-action-loader__progress"
        cx="25"
        cy="25"
        r="20"
        strokeWidth="4"
        strokeDasharray="125"
      />
    </svg>
  );
}
