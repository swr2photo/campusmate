import { cn } from '@/lib/utils';

function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn('h-px w-full bg-border', className)} />;
}

export { Separator };
