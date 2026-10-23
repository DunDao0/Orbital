"use client";

import { type ReactNode, useEffect, useState } from "react";

type Props = {
  title: string;
  description: string;
  children: ReactNode;
};

export default function AtlasResponsiveDrawer({ title, description, children }: Props) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 620px)");
    const applyViewport = (mobile: boolean) => setOpen(!mobile);
    const frame = window.requestAnimationFrame(() => applyViewport(media.matches));
    const onChange = (event: MediaQueryListEvent) => applyViewport(event.matches);
    media.addEventListener("change", onChange);
    return () => {
      window.cancelAnimationFrame(frame);
      media.removeEventListener("change", onChange);
    };
  }, []);

  return <details className="atlas-mobile-drawer" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>{title}</span><small>{description}</small></summary>
    <div className="atlas-mobile-drawer-content">{children}</div>
  </details>;
}
