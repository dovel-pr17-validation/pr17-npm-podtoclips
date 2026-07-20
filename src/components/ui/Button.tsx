import { cva, type VariantProps } from 'class-variance-authority';
import React from 'react';
import { cn } from '../../lib/cn';

export const buttonVariants = cva('ee-button', {
  variants: {
    variant: {
      primary: 'ee-button-primary',
      secondary: 'ee-button-secondary',
      ghost: 'ee-button-ghost',
      dark: 'ee-button-dark',
    },
    size: {
      default: 'ee-button-md',
      large: 'ee-button-lg',
      small: 'ee-button-sm',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'default',
  },
});

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));

Button.displayName = 'Button';
