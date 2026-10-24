import { useEffect, useState, type FormEvent } from 'react';
import { Check, CircleAlert, Eye, EyeOff, KeyRound, Loader2, MailCheck, PartyPopper } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HostedShell } from '@/components/brand-shell';
import { cn } from '@/lib/utils';
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_RULES,
  evaluatePasswordRules,
  getPasswordIssues,
} from '@/lib/password-policy';

// Email links from the native (Rust) backend: /auth/verify-email#token=… and
// /auth/reset-password#token=…. The token sits in the fragment so it never
// reaches a server or CDN log; it is read once and removed from the address
// bar before anything renders. Opening the link changes nothing: the user
// must press the button, so mail scanners that follow links cannot use it.
const API = String(import.meta.env.VITE_RUST_BACKEND_URL || 'https://campusmate-backend-502731779521.fly.dev').replace(/\/+$/, '');
const APP_LINK = 'campusmate://';

export type AuthAction = 'verify' | 'reset';

export function readActionToken() {
  const token = /^#token=([0-9a-f]{64})$/.exec(window.location.hash)?.[1] || '';
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  return token;
}

type Phase = 'invalid' | 'ready' | 'submitting' | 'done';

async function submitAction(action: AuthAction, body: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${API}/v1/auth/${action === 'reset' ? 'reset-password' : 'verify-email'}`, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // Challenge responses are tiny; bound the body before parsing.
    const raw = await response.text();
    const result = raw.length <= 8192 ? JSON.parse(raw || '{}') : {};
    if (response.ok && result?.ok === true) return null;
    if (response.status >= 500) return 'ระบบขัดข้องชั่วคราว กรุณาลองอีกครั้งในอีกสักครู่';
    if (response.status === 429) return 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง';
    const expired = result?.error?.details?.reason === 'INVALID_CHALLENGE';
    if (action === 'reset' && response.status === 400 && !expired) {
      return 'รหัสผ่านนี้ยังไม่ตรงตามเงื่อนไข กรุณาตั้งใหม่';
    }
    return 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่จากในแอป CampusMate';
  } catch {
    return 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
  } finally {
    clearTimeout(timer);
  }
}

function PasswordInput({ id, label, value, onChange, autoFocus = false }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
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
          autoComplete="new-password"
          autoFocus={autoFocus}
          maxLength={MAX_PASSWORD_LENGTH}
          className="pr-12"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

export function AuthActionPage({ action, token }: { action: AuthAction; token: string }) {
  const reset = action === 'reset';
  const [phase, setPhase] = useState<Phase>(token ? 'ready' : 'invalid');
  const [error, setError] = useState(token ? '' : 'ลิงก์ไม่ถูกต้องหรือไม่ครบ กรุณาเปิดลิงก์จากอีเมลล่าสุด หรือขอลิงก์ใหม่จากในแอป');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const rules = evaluatePasswordRules(password);

  useEffect(() => {
    // A second link opened in this tab carries a new token: start over with it.
    const reload = () => window.location.reload();
    window.addEventListener('hashchange', reload);
    return () => window.removeEventListener('hashchange', reload);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== 'ready') return;
    if (reset) {
      const issues = getPasswordIssues(password, { confirmPassword: confirmation });
      if (issues.length) {
        setError(issues[0]);
        return;
      }
    }
    setError('');
    setPhase('submitting');
    const failure = await submitAction(action, reset ? { token, password } : { token });
    if (failure) {
      setError(failure);
      setPhase('ready');
      return;
    }
    setPassword('');
    setConfirmation('');
    setPhase('done');
  }

  const title = reset ? 'ตั้งรหัสผ่านใหม่' : 'ยืนยันอีเมล';
  const description = phase === 'done'
    ? (reset ? 'บันทึกรหัสผ่านใหม่แล้ว กลับไปเข้าสู่ระบบในแอปด้วยรหัสใหม่ได้เลย' : 'ยืนยันอีเมลเรียบร้อย กลับไปเข้าสู่ระบบในแอป CampusMate ได้เลย')
    : reset
      ? 'ตั้งรหัสผ่านใหม่สำหรับบัญชี CampusMate ของคุณ ลิงก์นี้ใช้ได้ครั้งเดียว'
      : 'กดปุ่มด้านล่างเพื่อยืนยันว่าอีเมลนี้เป็นของคุณ ลิงก์นี้ใช้ได้ครั้งเดียว';

  return (
    <HostedShell eyebrow="บัญชี CampusMate" title={title} description={description}>
      <Card className="mt-8">
        {phase === 'done' ? (
          <CardContent className="grid justify-items-center gap-4 p-8 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-[#e8f8f1] text-[#18a878]">
              <PartyPopper className="size-8" />
            </span>
            <p className="text-lg font-bold">{reset ? 'ตั้งรหัสผ่านใหม่สำเร็จ' : 'ยืนยันอีเมลสำเร็จ'}</p>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              ปิดหน้านี้ได้เลย หรือกดปุ่มเพื่อเปิดแอป CampusMate บนโทรศัพท์เครื่องนี้
            </p>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <a href={APP_LINK}>เปิดแอป CampusMate</a>
            </Button>
          </CardContent>
        ) : (
          <>
            <CardHeader>
              <div className="flex items-center gap-2 text-muted-foreground">
                {reset ? <KeyRound className="size-4" /> : <MailCheck className="size-4" />}
                <span className="text-xs font-semibold tracking-wider">{reset ? 'รหัสผ่านใหม่' : 'ยืนยันความเป็นเจ้าของอีเมล'}</span>
              </div>
              <CardTitle className="text-lg">{reset ? 'สร้างรหัสผ่านที่ปลอดภัย' : 'อีกขั้นเดียวก็เสร็จ'}</CardTitle>
              <CardDescription>
                {reset ? 'อย่างน้อย 8 ตัว มีพิมพ์เล็ก พิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ' : 'ระบบจะยืนยันเมื่อคุณกดปุ่มเท่านั้น การเปิดลิงก์อย่างเดียวจะไม่เปลี่ยนแปลงอะไร'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-5" onSubmit={handleSubmit} aria-busy={phase === 'submitting'}>
                {error ? (
                  <Alert variant="destructive" role="alert">
                    <CircleAlert className="size-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {reset && phase !== 'invalid' ? (
                  <>
                    <PasswordInput id="password" label="รหัสผ่านใหม่" value={password} onChange={setPassword} autoFocus />
                    <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="เงื่อนไขรหัสผ่าน">
                      {PASSWORD_RULES.map((rule) => {
                        const ok = Boolean(password) && rules[rule.key];
                        return (
                          <li key={rule.key} className={cn('flex items-center gap-2 text-xs', ok ? 'text-[#0e7a57] dark:text-[#45d1a1]' : 'text-muted-foreground')}>
                            <span className={cn('flex size-4 items-center justify-center rounded-full border', ok ? 'border-transparent bg-[#18a878] text-white' : 'border-input')}>
                              {ok ? <Check className="size-3" strokeWidth={3} /> : null}
                            </span>
                            {rule.label}
                          </li>
                        );
                      })}
                    </ul>
                    <PasswordInput id="confirmation" label="ยืนยันรหัสผ่านใหม่" value={confirmation} onChange={setConfirmation} />
                  </>
                ) : null}
                <Button type="submit" size="lg" className="w-full" disabled={phase !== 'ready'}>
                  {phase === 'submitting' ? <Loader2 className="animate-spin" /> : null}
                  {phase === 'submitting' ? 'กำลังดำเนินการ…' : reset ? 'บันทึกรหัสผ่านใหม่' : 'ยืนยันอีเมล'}
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </HostedShell>
  );
}
