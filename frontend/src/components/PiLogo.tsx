import React from "react";

interface PiLogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const PiLogo: React.FC<PiLogoProps> = ({ size = 28, className = "", style = {} }) => {
  return (
    <img
      src="/assistant-avatar.png"
      alt="PiCoddy"
      width={size}
      height={size}
      className={`pi-a-logo ${className}`}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        borderRadius: `${size * 0.22}px`,
        flexShrink: 0,
        objectFit: "contain",
        ...style,
      }}
    />
  );
};
