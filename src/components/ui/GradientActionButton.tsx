import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingText?: string;
};

export function GradientActionButton({
  loading,
  loadingText,
  className,
  children,
  style,
  ...rest
}: Props) {
  const base =
    "relative z-10 w-full h-11 rounded-2xl text-white font-semibold border-0 disabled:opacity-60 disabled:cursor-not-allowed transition-transform duration-200 ease-out hover:scale-[1.03] active:scale-95 shadow-[0_20px_60px_-15px_rgba(255,15,0,0.35)] hover:shadow-[0_25px_80px_-20px_rgba(255,15,0,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-400";
  const classes = className ? `${base} ${className}` : base;
  const gradient = { background: "linear-gradient(to right, #EAB308, #FF0F00)" };
  return (
    <button
      {...rest}
      className={classes}
      style={{ ...gradient, ...(style || {}) }}
      aria-busy={loading ? "true" : undefined}
    >
      {loading ? loadingText ?? children : children}
    </button>
  );
}


