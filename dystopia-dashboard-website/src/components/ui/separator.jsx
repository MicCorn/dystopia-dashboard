export function Separator({ className = "", orientation="horizontal" }) {
  const base = "bg-white/10";
  return <div className={`${base} ${orientation === "vertical" ? "w-px h-full" : "h-px w-full"} ${className}`} />;
}