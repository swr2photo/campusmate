import { useEffect, useMemo, useState } from 'react';
import { applyActionCode, checkActionCode } from 'firebase/auth';
import { CircleAlert, Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { HostedShell, HostedSteps } from '@/components/brand-shell';
import { auth } from '@/lib/firebase';

const APP_LINK = 'campusmate://verify-campus-email';

function maskEmail(email: string) {
  const [local, domain] = String(email || '').split('@');
  if (!domain || local.length < 2) return email;
  return `${local.slice(0, 2)}***@${domain}`;
}

function verifyErrorMessage(code: string) {
  if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
    return 'ลิงก์นี้หมดอายุหรือถูกใช้งานไปแล้ว กรุณาขอลิงก์ใหม่จากในแอป CampusMate';
  }
  if (code === 'auth/network-request-failed') {
    return 'เชื่อมต่ออินเทอร์เน็ตไม่สำเร็จ กรุณาลองใหม่';
  }
  return 'ไม่สามารถยืนยันอีเมลได้ กรุณาขอลิงก์ใหม่จากในแอป';
}

export function EmailVerifiedPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const actionCode = params.get('oobCode') || '';
  const mode = params.get('mode') || '';
  const [status, setStatus] = useState<'loading' | 'success' | 'invalid' | 'continue'>(
    actionCode ? 'loading' : 'continue'
  );
  const [description, setDescription] = useState(
    actionCode
      ? 'กำลังตรวจสอบลิงก์จากอีเมล CampusMate'
      : 'หากเพิ่งกดลิงก์ยืนยันในเมลแล้ว ให้กลับไปที่แอปแล้วกดตรวจสอบสถานะ'
  );
  const [error, setError] = useState('');
  const [verifiedEmail, setVerifiedEmail] = useState('');
  const [operation, setOperation] = useState('');

  useEffect(() => {
    if (mode === 'resetPassword') {
      window.location.replace(`/reset.html${window.location.search}`);
      return;
    }

    if (!actionCode) {
      return;
    }

    checkActionCode(auth, actionCode)
      .then(async (info) => {
        await applyActionCode(auth, actionCode);
        const email = String(info.data.email || '');
        const previousEmail = String(info.data.previousEmail || '');
        const nextOperation = String(info.operation || '');
        const masked = email ? maskEmail(email) : '';
        setVerifiedEmail(masked);
        setOperation(nextOperation);
        if (nextOperation === 'VERIFY_AND_CHANGE_EMAIL' || mode === 'verifyAndChangeEmail') {
          setDescription(
            previousEmail
              ? `บัญชีถูกเปลี่ยนไปใช้อีเมล ${masked} แล้ว กลับไปที่แอปเพื่อใช้งานต่อ`
              : `ยืนยันอีเมล ${masked} แล้ว กลับไปที่แอป CampusMate เพื่อใช้งานต่อ`
          );
        } else if (nextOperation === 'RECOVER_EMAIL' || mode === 'recoverEmail') {
          setDescription(`อีเมลบัญชีถูกคืนเป็น ${masked || 'อีเมลเดิม'} แล้ว`);
        } else {
          setDescription(
            masked
              ? `ยืนยันอีเมล ${masked} สำเร็จแล้ว กลับไปที่แอป CampusMate เพื่อเข้าใช้งาน`
              : 'ยืนยันอีเมลสำเร็จแล้ว กลับไปที่แอป CampusMate เพื่อเข้าใช้งาน'
          );
        }
        setStatus('success');
      })
      .catch((caught) => {
        setStatus('invalid');
        setDescription('ไม่สามารถใช้ลิงก์นี้ได้');
        setError(verifyErrorMessage(String((caught as { code?: string })?.code || '')));
      });
  }, [actionCode, mode]);

  const isRecover = operation === 'RECOVER_EMAIL' || mode === 'recoverEmail';
  const card = {
    loading: {
      title: 'กำลังตรวจสอบลิงก์',
      copy: 'ระบบกำลังยืนยันรหัสอ้างอิงจากอีเมล CampusMate',
    },
    continue: {
      title: 'กลับไปดำเนินการในแอป',
      copy: 'หน้านี้เป็นหน้าผลการยืนยัน หากเพิ่งเปิดลิงก์จากเมลแล้ว ให้เปิดแอปแล้วกดตรวจสอบสถานะ',
    },
    success: {
      title: isRecover ? 'กู้คืนอีเมลแล้ว' : 'ยืนยันอีเมลแล้ว',
      copy: verifiedEmail
        ? `บัญชี ${verifiedEmail} พร้อมใช้งานต่อในแอป CampusMate`
        : 'เปิดแอปแล้วกดตรวจสอบสถานะ หากแอปไม่เปิดขึ้นเอง ให้เปิดจากหน้าจออุปกรณ์',
    },
    invalid: {
      title: 'ไม่สามารถยืนยันได้',
      copy: 'ขอลิงก์ใหม่จากหน้ายืนยันอีเมลในแอป แล้วเปิดจากกล่องจดหมายอีกครั้ง',
    },
  }[status];

  const steps =
    status === 'success'
      ? [
          { label: verifiedEmail ? `ยืนยันอีเมล ${verifiedEmail} แล้ว` : 'ยืนยันอีเมลแล้ว', done: true },
          { label: 'เปิดแอป CampusMate' },
          { label: 'กดตรวจสอบสถานะในแอป' },
        ]
      : [
          { label: 'เปิดแอป CampusMate' },
          { label: 'กดตรวจสอบสถานะ หรือขอลิงก์ยืนยันใหม่' },
          { label: 'ตรวจ Inbox, Junk และ Quarantine ของ Outlook' },
        ];

  return (
    <HostedShell
      eyebrow="การยืนยันตัวตน"
      title="ยืนยันอีเมล"
      description={description}
      footer={
        <>
          ลิงก์ยืนยันใช้ได้ครั้งเดียวและมีระยะเวลาจำกัด
          <br />
          อีเมลอัตโนมัติจาก noreply@getcampusmate.app
        </>
      }
    >
      <Card className="mt-8">
        <CardHeader>
          <div className="flex items-center gap-2 text-muted-foreground">
            {status === 'loading' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isRecover ? (
              <ShieldCheck className="size-4" />
            ) : (
              <MailCheck className="size-4" />
            )}
            <span className="text-xs font-medium tracking-wider">สถานะการยืนยัน</span>
          </div>
          <CardTitle className="text-base">{card.title}</CardTitle>
          <CardDescription>{card.copy}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {status === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              กำลังตรวจสอบลิงก์...
            </div>
          ) : status === 'invalid' ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <>
              <HostedSteps items={steps} />
              <Button asChild size="lg" className="w-full">
                <a href={APP_LINK}>เปิดแอป CampusMate</a>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </HostedShell>
  );
}
