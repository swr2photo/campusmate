import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { HostedShell, HostedSteps } from '@/components/brand-shell';

const APP_LINK = 'campusmate://verify-campus-email';

export function ContinuePage() {
  return (
    <HostedShell
      eyebrow="การยืนยันตัวตน"
      title="ยืนยันอีเมล"
      description="หน้านี้รองรับลิงก์ยืนยันรุ่นเดิม อีเมลชุดใหม่จะพาไปหน้าผลการยืนยันโดยตรง"
    >
      <Card className="mt-8">
        <CardHeader>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MailCheck className="size-4" />
            <span className="text-xs font-medium tracking-wider">สถานะการยืนยัน</span>
          </div>
          <CardTitle className="text-base">กลับไปดำเนินการในแอป</CardTitle>
          <CardDescription>
            หากเพิ่งเปิดลิงก์จากเมล CampusMate แล้ว ให้เปิดแอปแล้วกดตรวจสอบสถานะ
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <HostedSteps
            items={[
              { label: 'เปิดแอป CampusMate' },
              { label: 'กดตรวจสอบสถานะในแอป' },
              { label: 'ตรวจ Inbox, Junk และ Quarantine ของ Outlook หากยังไม่มีเมล' },
            ]}
          />
          <Button asChild size="lg" className="w-full">
            <a href={APP_LINK}>เปิดแอป CampusMate</a>
          </Button>
        </CardContent>
      </Card>
    </HostedShell>
  );
}
