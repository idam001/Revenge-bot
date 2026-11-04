import React from "react";

export function SparkIcon({
  className = "",
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l1.6 6.1L19 5l-3.1 5.4L22 12l-6.1 1.6L19 19l-5.4-3.1L12 22l-1.6-6.1L5 19l3.1-5.4L2 12l6.1-1.6L5 5l5.4 3.1z" />
    </svg>
  );
}
