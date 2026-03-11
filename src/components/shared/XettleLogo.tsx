/**
 * XettleLogo — Text-based logo: "X" underlined in Xero blue, "ettle" in foreground.
 */
import React from 'react';

interface XettleLogoProps {
  className?: string;
  height?: number;
}

export default function XettleLogo({ className = '', height = 32 }: XettleLogoProps) {
  const fontSize = height * 0.75;
  const underlineY = height * 0.82;
  const underlineWidth = fontSize * 0.58;
  const width = fontSize * 2.8;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      height={height}
      width={width}
      className={className}
      aria-label="Xettle"
      role="img"
    >
      {/* "X" in Xero blue */}
      <text
        x="0"
        y={height * 0.72}
        fontFamily="'Space Grotesk', 'Inter', system-ui, sans-serif"
        fontWeight="700"
        fontSize={fontSize}
        fill="#27AAE1"
      >
        X
      </text>
      {/* Underline under the X */}
      <line
        x1="1"
        y1={underlineY}
        x2={underlineWidth}
        y2={underlineY}
        stroke="#27AAE1"
        strokeWidth={height * 0.08}
        strokeLinecap="round"
      />
      {/* "ettle" in foreground color */}
      <text
        x={fontSize * 0.55}
        y={height * 0.72}
        fontFamily="'Space Grotesk', 'Inter', system-ui, sans-serif"
        fontWeight="600"
        fontSize={fontSize}
        className="fill-foreground"
      >
        ettle
      </text>
    </svg>
  );
}
