interface AppleIconProps {
  className?: string;
}

/** Apple logo, per Apple branding guidelines for Sign in with Apple buttons. */
export function AppleIcon({ className = "w-5 h-5" }: AppleIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M17.05 12.04c-.03-3.14 2.56-4.65 2.68-4.73-1.46-2.14-3.74-2.43-4.55-2.46-1.94-.2-3.78 1.14-4.77 1.14-.99 0-2.51-1.11-4.13-1.08-2.13.03-4.09 1.24-5.18 3.14-2.21 3.83-.57 9.5 1.59 12.6 1.05 1.52 2.3 3.23 3.94 3.17 1.58-.06 2.18-1.02 4.09-1.02 1.91 0 2.45 1.02 4.13.99 1.7-.03 2.78-1.55 3.82-3.08 1.2-1.77 1.7-3.48 1.73-3.57-.04-.02-3.32-1.27-3.35-5.1zM13.96 3.7c.87-1.06 1.46-2.53 1.3-3.99-1.25.05-2.78.83-3.68 1.89-.81.94-1.51 2.43-1.32 3.87 1.4.11 2.83-.71 3.7-1.77z" />
    </svg>
  );
}
