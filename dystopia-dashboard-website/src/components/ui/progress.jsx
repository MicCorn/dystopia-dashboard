export function Progress({ value = 0, className = "" }) {
  return (
    <div className={`w-full h-2 rounded-full bg-white/10 overflow-hidden ${className}`}>
      <div className="h-full bg-emerald-400" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}