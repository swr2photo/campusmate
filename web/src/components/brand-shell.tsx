import type { ReactNode } from 'react';
import { Check, Lock } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <img
      src="/brand-icon.png"
      alt="CampusMate"
      width={size}
      height={size}
      className="rounded-[28%] shadow-sm ring-1 ring-black/10"
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
    <div className="relative min-h-svh overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-80 bg-[radial-gradient(40rem_18rem_at_50%_-4rem,color-mix(in_oklab,var(--primary)_24%,transparent),transparent)]"
      />
      <header className="relative border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-3 px-5">
          <a href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30">
            <BrandMark size={34} />
            <span className="min-w-0">
              <span className="block text-sm font-bold tracking-tight">CampusMate</span>
              <span className="block text-xs text-muted-foreground">บัญชีและความปลอดภัย</span>
            </span>
          </a>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
            <Lock className="size-3.5" aria-hidden /> การเชื่อมต่อปลอดภัย
          </span>
        </div>
      </header>
      <main className="relative mx-auto max-w-xl px-5 pb-12 pt-10">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
        {children}
        <div className="mt-8 rounded-2xl bg-muted/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {footer || (
            <>
              หากคุณไม่ได้เป็นผู้ขอ ปิดหน้านี้ได้เลย บัญชีของคุณจะไม่ถูกเปลี่ยนแปลง
              <br />
              อีเมลอัตโนมัติจาก noreply@getcampusmate.app ทีมงานจะไม่ขอรหัสผ่านของคุณทางอีเมลหรือแชต
            </>
          )}
        </div>
        <Separator className="mt-8" />
        <nav aria-label="ลิงก์ช่วยเหลือ" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <a href="/" className="hover:text-foreground">หน้าแรก</a>
          <a href="/privacy" className="hover:text-foreground">นโยบายความเป็นส่วนตัว</a>
          <a href="/terms" className="hover:text-foreground">เงื่อนไขการให้บริการ</a>
        </nav>
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
