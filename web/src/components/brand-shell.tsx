import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <img
      src="/brand-icon.png"
      alt="CampusMate"
      width={size}
      height={size}
      className="rounded-[11px] shadow-sm ring-1 ring-black/10"
    />
  );
}

export function HostedShell({
  eyebrow,
  title,
  description,
  footer,
  children,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh bg-background">
      <div className="h-1 bg-primary" />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-[4.25rem] max-w-xl items-center gap-3 px-6">
          <BrandMark />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">CampusMate</p>
            <p className="text-xs text-muted-foreground">ระบบบัญชีและความปลอดภัย</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-6 py-10">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-primary">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
        {children}
        <Separator className="mt-8" />
        <div className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {footer || (
            <>
              หากไม่ได้เป็นผู้ขอ สามารถปิดหน้านี้ได้
              <br />
              อีเมลอัตโนมัติจาก noreply@getcampusmate.app
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export function HostedSteps({
  items,
}: {
  items: { label: string; done?: boolean }[];
}) {
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              'flex size-4 items-center justify-center rounded-full border',
              item.done
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input text-transparent'
            )}
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
          <span className={item.done ? 'text-foreground' : 'text-muted-foreground'}>
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
