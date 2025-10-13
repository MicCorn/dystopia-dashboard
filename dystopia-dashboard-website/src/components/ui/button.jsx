export function Button({ className = "", children, onClick, variant = "default", size="md", ...rest }) {
  const base = "inline-flex items-center justify-center rounded-md border border-white/10 px-3 py-2 text-sm";
  const styles = {
    default: "bg-white/10 hover:bg-white/20",
    secondary: "bg-white/5 hover:bg-white/15",
    ghost: "bg-transparent hover:bg-white/10",
  };
  const sizes = { sm: "px-2 py-1 text-xs", md: "", lg: "px-4 py-3 text-base" };
  return (
    <button onClick={onClick} className={`${base} ${styles[variant]} ${sizes[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}