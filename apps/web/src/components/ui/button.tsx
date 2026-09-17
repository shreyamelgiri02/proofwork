import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium transition-ui select-none disabled:opacity-55 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-white hover:bg-primary-hover active:bg-primary-pressed shadow-card",
        secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-muted hover:border-subtle/50",
        outline: "border border-primary/70 bg-surface text-primary-ink hover:bg-primary-soft",
        ghost: "text-muted hover:bg-neutral-soft hover:text-ink",
        danger: "border border-danger/70 bg-surface text-danger-ink hover:bg-danger-soft",
        dangerSolid: "bg-danger-ink text-white hover:bg-[#8e1d24]",
        link: "text-primary-ink underline-offset-4 hover:underline px-0 h-auto",
        dark: "bg-ink text-white hover:bg-ink/90",
      },
      size: {
        sm: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
        md: "h-10 px-4 [&_svg]:size-4",
        lg: "h-11 px-5 text-[15px] [&_svg]:size-4",
        icon: "size-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <LoaderCircle className="animate-pw-spin" aria-hidden /> : null}
          {children}
        </>
      )}
    </Comp>
  );
});

export { buttonVariants };
