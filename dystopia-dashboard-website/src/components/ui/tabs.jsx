import React, { useEffect, useState } from "react";

export function Tabs({ defaultValue, value: controlled, onValueChange, children, className = "" }) {
  const [value, setValue] = useState(controlled ?? defaultValue);

  // Keep internal state in sync if a controlled value is provided
  useEffect(() => {
    if (controlled !== undefined) setValue(controlled);
  }, [controlled]);

  const set = (v) => {
    if (controlled === undefined) setValue(v);
    onValueChange?.(v);
  };

  return (
    <div className={className}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        if (child.type?.displayName === "TabsList") {
          return React.cloneElement(child, { __setValue: set, __active: value });
        }
        if (child.type?.displayName === "TabsContent") {
          return React.cloneElement(child, { __active: value });
        }
        return child;
      })}
    </div>
  );
}

export function TabsList({ children, className = "", __setValue, __active }) {
  const enhanced = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    if (child.type?.displayName === "TabsTrigger") {
      return React.cloneElement(child, { __setValue, __active });
    }
    return child;
  });
  return <div className={`flex gap-2 rounded-xl p-1 ${className}`}>{enhanced}</div>;
}
TabsList.displayName = "TabsList";

export function TabsTrigger({ value, children, __setValue, __active }) {
  const isActive = value === __active;
  return (
    <button
      type="button"
      onClick={() => __setValue?.(value)}
      className={`px-3 py-1.5 text-sm rounded-lg border border-white/10 ${
        isActive ? "bg-white/20 text-white" : "bg-white/5 hover:bg-white/10 text-white/70"
      }`}
    >
      {children}
    </button>
  );
}
TabsTrigger.displayName = "TabsTrigger";

export function TabsContent({ value, __active, className = "", children }) {
  if (value !== __active) return null;
  return <div className={className}>{children}</div>;
}
TabsContent.displayName = "TabsContent";