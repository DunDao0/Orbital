import type { ComponentPropsWithoutRef } from "react";

type AppLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & { href: string };

/**
 * Native navigation fallback for vinext beta's broken production RSC imports.
 * Keep real hrefs and browser keyboard/modified-click behavior; do not intercept
 * clicks. URL scene state and explicitly saved local projects survive reloads.
 */
export default function AppLink({ children, href, ...props }: AppLinkProps) {
  return <a href={href} {...props}>{children}</a>;
}
