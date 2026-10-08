import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import {
  confirmPasswordReset,
  signInWithEmailAndPassword,
  signOut,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HostedShell } from '@/components/brand-shell';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_REUSED_MESSAGE,
  PASSWORD_RULES,
  evaluatePasswordRules,
  getPasswordIssues,
} from '@/lib/password-policy';

const NOT_CURRENT_CODES = new Set([
  'auth/invalid-credential',
  'auth/wrong-password',
  'auth/invalid-login-credentials',
  'auth/user-not-found',
  'auth/invalid-email',
]);

function maskEmail(email: string) {
  const [local, domain] = String(email || '').split('@');
  if (!domain || local.length < 2) return email;
  return `${local.slice(0, 2)}***@${domain}`;
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete = 'new-password',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          maxLength={MAX_PASSWORD_LENGTH}
          placeholder={placeholder}
          className="pr-11"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 text-muted-foreground"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
    </div>
  );
}

async function isCurrentPassword(email: string, password: string) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    await signOut(auth);
    return true;
  } catch (error) {
    const code = String((error as { code?: string })?.code || '');
    if (NOT_CURRENT_CODES.has(code)) return false;
    throw error;
  }
}

function resetErrorMessage(code: string) {
  if (code === 'auth/too-many-requests') {
    return 'มีการพยายามตั้งรหัสผ่านบ่อยเกินไป กรุณารอสักครู่แล้วใช้ลิงก์นี้อีกครั้ง';
  }
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
    return 'รหัสผ่านนี้ยังไม่ปลอดภัยพอ กรุณาตั้งรหัสตามเงื่อนไขด้านล่าง';
  }
  if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
    return 'ลิงก์นี้หมดอายุหรือถูกใช้งานไปแล้ว กรุณาขอลิงก์ใหม่จากในแอป';
  }
  if (code === 'auth/network-request-failed') {
    return 'เชื่อมต่ออินเทอร์เน็ตไม่สำเร็จ กรุณาลองใหม่';
  }
  return 'ไม่สามารถเปลี่ยนรหัสผ่านได้ กรุณาขอลิงก์ใหม่จากในแอป';
}

export function ResetPage() {
  const actionCode = useMemo(() => new URLSearchParams(window.location.search).get('oobCode') || '', []);
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid' | 'success'>(
    actionCode ? 'loading' : 'invalid'
  );
  const [accountEmail, setAccountEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const rules = evaluatePasswordRules(password, { email: accountEmail });

  useEffect(() => {
    if (!actionCode) {
      setStatus('invalid');
      setError('ไม่พบรหัสอ้างอิงสำหรับตั้งรหัสผ่านใหม่ กรุณากดลิงก์จากอีเมลใหม่อีกครั้ง');
      return;
    }
    verifyPasswordResetCode(auth, actionCode)
      .then((email) => {
        setAccountEmail(email);
        setStatus('ready');
      })
      .catch(() => {
        setStatus('invalid');
        setError('ลิงก์นี้หมดอายุหรือถูกใช้งานไปแล้ว กรุณาขอลิงก์ใหม่จากในแอป CampusMate');
      });
  }, [actionCode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const issues = getPasswordIssues(password, { email: accountEmail, confirmPassword });
    if (issues.length) {
      setError(issues[0]);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const reused = await isCurrentPassword(accountEmail, password);
      if (reused) {
        setError(PASSWORD_REUSED_MESSAGE);
        return;
      }
      await confirmPasswordReset(auth, actionCode, password);
      setStatus('success');
    } catch (caught) {
      setError(resetErrorMessage(String((caught as { code?: string })?.code || '')));
    } finally {
      setSubmitting(false);
    }
  }

  const description = status === 'ready'
    ? `กำหนดรหัสผ่านใหม่สำหรับบัญชี ${maskEmail(accountEmail)} รหัสใหม่ต้องไม่ซ้ำรหัสเดิม`
    : status === 'success'
      ? 'เปลี่ยนรหัสผ่านสำเร็จแล้ว สามารถกลับไปเข้าสู่ระบบในแอปได้ทันที'
      : status === 'loading'
        ? 'กำลังตรวจสอบลิงก์จากอีเมล CampusMate'
        : 'ไม่สามารถใช้ลิงก์นี้ได้';

  return (
    <HostedShell
      eyebrow="ความปลอดภัยของบัญชี"
      title="ตั้งรหัสผ่านใหม่"
      description={description}
      footer={
        <>
          ลิงก์นี้ใช้ได้ครั้งเดียวและมีระยะเวลาจำกัด หากไม่ได้เป็นผู้ขอ สามารถปิดหน้านี้ได้
          <br />
          อีเมลอัตโนมัติจาก noreply@getcampusmate.app
        </>
      }
    >
      <Card className="mt-8">
        {status === 'success' ? (
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
              <ShieldCheck className="size-6" />
            </div>
            <CardTitle>บันทึกรหัสผ่านแล้ว</CardTitle>
            <CardDescription>
              เปิดแอป CampusMate แล้วเข้าสู่ระบบด้วยรหัสผ่านใหม่ ลิงก์นี้ใช้ไม่ได้ซ้ำอีก
            </CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <div className="flex items-center gap-2 text-muted-foreground">
                <LockKeyhole className="size-4" />
                <span className="text-xs font-medium tracking-wider">เงื่อนไขรหัสผ่าน</span>
              </div>
              <CardTitle className="text-base">สร้างรหัสผ่านที่ปลอดภัย</CardTitle>
              <CardDescription>
                ใช้พิมพ์เล็ก พิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ ห้ามมีช่องว่าง และห้ามใช้ส่วนหนึ่งของอีเมล
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                <form className="grid gap-5" onSubmit={handleSubmit} noValidate>
                  <PasswordField
                    id="newPassword"
                    label="รหัสผ่านใหม่"
                    value={password}
                    onChange={setPassword}
                    placeholder="ตั้งรหัสใหม่ที่ไม่ซ้ำรหัสเดิม"
                  />
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {PASSWORD_RULES.map((rule) => {
                      const ok = rules[rule.key];
                      return (
                        <li key={rule.key} className="flex items-center gap-2 text-sm">
                          <span
                            className={cn(
                              'flex size-4 items-center justify-center rounded-full border',
                              ok
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-input text-transparent'
                            )}
                          >
                            <Check className="size-3" strokeWidth={3} />
                          </span>
                          <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>
                            {rule.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <PasswordField
                    id="confirmPassword"
                    label="ยืนยันรหัสผ่านใหม่"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="กรอกรหัสผ่านอีกครั้ง"
                  />
                  {error ? (
                    <Alert variant="destructive">
                      <CircleAlert />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="animate-spin" />
                        กำลังบันทึก...
                      </>
                    ) : (
                      'บันทึกรหัสผ่านใหม่'
                    )}
                  </Button>
                </form>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </HostedShell>
  );
}
