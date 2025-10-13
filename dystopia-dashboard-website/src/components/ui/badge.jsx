export function Badge({ className = "", children, ...rest }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs border ${className}`} {...rest}>
      {children}
    </span>
  );
}