import { useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CalendarHeart,
  ChevronDown,
  CloudSun,
  Coffee,
  Dumbbell,
  EyeOff,
  Flag,
  GraduationCap,
  Heart,
  LockKeyhole,
  MapPinned,
  Menu,
  MessageCircleHeart,
  PartyPopper,
  ScanFace,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { BrandMark } from '@/components/brand-shell';
import { Mascot } from '@/components/mascot';
import { cn } from '@/lib/utils';

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.campusmate.app';

const NAV = [
  { href: '#features', label: 'ฟีเจอร์' },
  { href: '#safety', label: 'ความปลอดภัย' },
  { href: '#how', label: 'เริ่มใช้งาน' },
  { href: '#faq', label: 'คำถามที่พบบ่อย' },
];

const FEATURES = [
  {
    icon: Users,
    title: 'เจอเพื่อนที่ชอบอะไรเหมือนกัน',
    body: 'เลือกกิจกรรมที่สนใจ แล้วดูเพื่อนจากคณะและชั้นปีที่ใกล้เคียงกัน พร้อมคะแนนความเข้ากันที่คำนวณจากโปรไฟล์จริง',
  },
  {
    icon: MapPinned,
    title: 'นัดเจอในแคมปัส',
    body: 'แผนที่ ม.อ. หาดใหญ่พร้อมจุดนัดยอดนิยม หอสมุด โรงอาหาร คาเฟ่ สนามกีฬา นัดกันง่ายโดยไม่ต้องแชร์พิกัดจริง',
  },
  {
    icon: PartyPopper,
    title: 'ตี้กิจกรรม',
    body: 'ตั้งตี้ติวสอบ กินข้าว ออกกำลังกาย หรือเที่ยว กำหนดเวลาและจำนวนคน เพื่อนที่สนใจกดเข้าร่วมได้ทันที',
  },
  {
    icon: MessageCircleHeart,
    title: 'แชตเข้ารหัส',
    body: 'คุยกันได้หลังจับคู่หรือเข้าตี้เดียวกันเท่านั้น ข้อความในแชตคู่ถูกเข้ารหัสบนเครื่องก่อนส่ง ส่งรูป เพลง และนัดหมายได้ในห้องเดียว',
  },
  {
    icon: ScanFace,
    title: 'ยืนยันรูปโปรไฟล์',
    body: 'ตรวจใบหน้าแบบมีชีวิตเทียบกับรูปโปรไฟล์ เพื่อให้ป้ายยืนยันหมายถึงคนในรูปคือเจ้าของบัญชีจริง',
  },
  {
    icon: CloudSun,
    title: 'แคมปัสที่มีชีวิต',
    body: 'มาสคอตแต่งตัวตามสภาพอากาศจริงที่ ม.อ. และแนะนำจุดนัดที่เหมาะกับวันนั้น ฝนตกก็หาที่นั่งในร่มให้',
  },
];

const SAFETY = [
  { icon: GraduationCap, title: 'เฉพาะนักศึกษา ม.อ.', body: 'สมัครใหม่ได้ด้วยอีเมล @psu.ac.th ที่ยืนยันแล้วเท่านั้น' },
  { icon: EyeOff, title: 'ไม่เปิดเผยพิกัดจริง', body: 'คนอื่นเห็นแค่ระยะทางโดยประมาณ พิกัดจริงไม่ถูกแสดงบนโปรไฟล์' },
  { icon: Flag, title: 'บล็อกและรายงานได้ทุกหน้า', body: 'ทีมงานตรวจสอบทุกรายงานและระงับบัญชีที่ละเมิดกฎได้' },
  { icon: LockKeyhole, title: 'ควบคุมข้อมูลของคุณเอง', body: 'ปิดการแสดงโปรไฟล์ในหน้าค้นหา หรือลบบัญชีถาวรได้เองในแอป' },
];

const STEPS = [
  { title: 'สมัครด้วยอีเมล ม.อ.', body: 'ใช้ Google หรือรหัสนักศึกษา ระบบเติม @psu.ac.th ให้อัตโนมัติ' },
  { title: 'ตั้งโปรไฟล์ใน 4 ขั้น', body: 'คณะ ชั้นปี รูปภาพ กิจกรรมที่ชอบ และเพลงโปรด (ถ้าอยากใส่)' },
  { title: 'กดถูกใจหรือเข้าตี้', body: 'เมื่อถูกใจกันทั้งสองฝ่ายหรืออยู่ตี้เดียวกัน ห้องแชตจะเปิดให้ทันที' },
];

const FAQ = [
  {
    q: 'ใครใช้ CampusMate ได้บ้าง?',
    a: 'นักศึกษามหาวิทยาลัยสงขลานครินทร์ที่มีอีเมล @psu.ac.th และมีอายุตั้งแต่ 18 ปีขึ้นไป บัญชี Gmail ที่เคยสมัครไว้ก่อนหน้ายังเข้าสู่ระบบได้ตามเดิม',
  },
  {
    q: 'ใช้งานฟรีไหม?',
    a: 'ฟีเจอร์หลักทั้งหาเพื่อน แชต และตี้กิจกรรมใช้ได้ฟรี สมาชิก Plus เป็นตัวเลือกเสริมสำหรับฟีเจอร์เพิ่มเติม',
  },
  {
    q: 'ลืมรหัสผ่านต้องทำอย่างไร?',
    a: 'ในหน้าเข้าสู่ระบบของแอปกด "ลืมรหัสผ่าน?" ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลของคุณ ลิงก์ใช้ได้ครั้งเดียวและมีเวลาหมดอายุ',
  },
  {
    q: 'ป้ายยืนยันตัวตนหมายถึงอะไร?',
    a: 'หมายถึงเจ้าของบัญชีผ่านการตรวจใบหน้าแบบมีชีวิตและตรงกับรูปโปรไฟล์ ไม่ใช่การยืนยันเอกสารราชการ ภาพจากการตรวจถูกลบตามระยะเวลาในนโยบายความเป็นส่วนตัว',
  },
  {
    q: 'ลบบัญชีได้ไหม?',
    a: 'ได้ ไปที่ โปรไฟล์ > การตั้งค่า > ลบบัญชี ระบบจะยืนยันด้วยรหัสทางอีเมลก่อนลบข้อมูลตามนโยบายความเป็นส่วนตัว',
  },
];

function PlayButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center justify-center gap-3 rounded-full bg-foreground font-semibold text-background shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40',
        compact ? 'h-10 px-4 text-sm' : 'h-14 px-6 text-base',
        className
      )}
    >
      <svg aria-hidden viewBox="0 0 24 24" className={compact ? 'size-4' : 'size-5'} fill="currentColor">
        <path d="M3.6 1.8 13.8 12 3.6 22.2c-.4-.2-.6-.7-.6-1.2V3c0-.5.2-1 .6-1.2Zm11.5 11.5 2.6 2.6-11.4 6.5 8.8-9.1Zm0-2.6L6.3 1.6l11.4 6.5-2.6 2.6Zm3.9.3 2.6 1.5c.8.5.8 1.6 0 2l-2.6 1.5-2.9-2.5 2.9-2.5Z" />
      </svg>
      <span className="leading-tight">
        {compact ? 'ดาวน์โหลด' : (
          <>
            <span className="block text-[11px] font-medium opacity-70">ดาวน์โหลดได้ที่</span>
            Google Play
          </>
        )}
      </span>
    </a>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5">
        <a href="#top" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40">
          <BrandMark size={34} />
          <span className="text-lg font-bold tracking-tight">CampusMate</span>
        </a>
        <nav aria-label="เมนูหลัก" className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
              {item.label}
            </a>
          ))}
          <PlayButton compact className="ml-2" />
        </nav>
        <button
          type="button"
          className="ml-auto inline-flex size-11 items-center justify-center rounded-full hover:bg-muted md:hidden"
          aria-label={open ? 'ปิดเมนู' : 'เปิดเมนู'}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="เมนูหลัก" className="border-t border-border/60 px-5 pb-5 pt-2 md:hidden">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-3 text-base font-medium hover:bg-muted">
              {item.label}
            </a>
          ))}
          <PlayButton className="mt-3 w-full" />
        </nav>
      ) : null}
    </header>
  );
}

/** Illustrated phone: the discovery screen with the mascot, never a real person. */
function PhoneMock() {
  return (
    <div className="relative mx-auto w-[min(300px,78vw)]" aria-hidden>
      <div className="absolute -inset-10 -z-10 rounded-full bg-primary/20 blur-3xl" />
      <div className="rounded-[2.6rem] border border-black/10 bg-[#0f1726] p-2.5 shadow-2xl shadow-primary/30">
        <div className="overflow-hidden rounded-[2.1rem] bg-[#f7f7f8] text-[#25272b]">
          <div className="flex items-center justify-between px-5 pb-1 pt-3 text-[11px] font-semibold">
            <span>9:41</span>
            <span className="h-4 w-16 rounded-full bg-black/80" />
            <span>100%</span>
          </div>
          <div className="px-4 pb-4">
            <p className="mt-2 text-lg font-bold">หาเพื่อน</p>
            <div className="mt-2 flex items-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-br from-[#252b52] to-[#11152c] p-3 text-white">
              <Mascot size={44} mood="calm" />
              <div className="min-w-0 text-[11px] leading-snug">
                <p className="font-semibold">ท้องฟ้ายามค่ำที่ ม.อ. · 25°</p>
                <p className="opacity-80">มาดูกันว่าวันนี้ใครว่างบ้าง</p>
              </div>
            </div>
            <div className="mt-3 rounded-3xl bg-white p-3 shadow-md shadow-black/5">
              <div className="relative flex h-44 items-end justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#d7e9ff] via-[#eaf3ff] to-[#fff1c2]">
                <Mascot size={118} className="mb-1" />
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-[#18a878]">
                  <BadgeCheck className="size-3" /> ยืนยันแล้ว
                </span>
                <span className="absolute right-2 top-2 rounded-full bg-[#2869c7] px-2 py-1 text-[10px] font-semibold text-white">เข้ากันสูง</span>
              </div>
              <p className="mt-2 text-sm font-bold">เพื่อนคณะวิทย์ · ปี 2</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold">
                <span className="inline-flex items-center gap-1 rounded-full bg-[#eef2f7] px-2 py-1"><BookOpen className="size-3" />ติวสอบ</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#eef2f7] px-2 py-1"><Coffee className="size-3" />คาเฟ่</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#eef2f7] px-2 py-1"><Dumbbell className="size-3" />ฟิตเนส</span>
              </div>
              <div className="mt-3 flex justify-center gap-4">
                <span className="flex size-11 items-center justify-center rounded-full bg-[#f0f1f3]"><X className="size-5 text-[#676c74]" /></span>
                <span className="flex size-11 items-center justify-center rounded-full bg-[#2869c7]"><Heart className="size-5 fill-white text-white" /></span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="animate-float absolute -left-10 top-[52%] hidden rounded-2xl border border-border bg-card px-3 py-2 text-xs font-semibold shadow-xl sm:flex sm:items-center sm:gap-2">
        <LockKeyhole className="size-4 text-primary" /> แชตเข้ารหัส
      </div>
      <div className="animate-float-delayed absolute -right-8 bottom-16 hidden rounded-2xl border border-border bg-card px-3 py-2 text-xs font-semibold shadow-xl sm:flex sm:items-center sm:gap-2">
        <CalendarHeart className="size-4 text-[#f47c6b]" /> นัดติวพรุ่งนี้ 10:00
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {body ? <p className="mt-4 text-base leading-relaxed text-muted-foreground">{body}</p> : null}
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-2xl border border-border bg-card px-5 py-1 open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-base font-semibold [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronDown className="size-5 shrink-0 text-muted-foreground transition group-open:rotate-180" />
      </summary>
      <p className="pb-5 text-sm leading-relaxed text-muted-foreground">{a}</p>
    </details>
  );
}

export function LandingPage() {
  return (
    <div id="top" className="min-h-svh bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        ข้ามไปเนื้อหาหลัก
      </a>
      <SiteHeader />
      <main id="main">
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_80%_-10%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent),radial-gradient(40rem_24rem_at_0%_20%,color-mix(in_oklab,#ffd27a_30%,transparent),transparent)]" />
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-14 lg:grid-cols-[1.1fr_0.9fr] lg:pt-20">
            <div className="text-center lg:text-left">
              <p className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1.5 text-sm font-semibold text-primary">
                <Sparkles className="size-4" /> สำหรับนักศึกษา ม.อ. หาดใหญ่
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-[1.15] tracking-tight sm:text-5xl lg:text-6xl">
                <span className="inline-block">หาเพื่อนใหม่</span><span className="inline-block">ในรั้ว ม.อ.</span>
                <span className="block bg-gradient-to-r from-primary to-[#5aaeff] bg-clip-text text-transparent">
                  <span className="inline-block">ปลอดภัย</span><span className="inline-block">และเป็นกันเอง</span>
                </span>
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground lg:mx-0">
                CampusMate ช่วยให้คุณเจอเพื่อนที่ชอบเรื่องเดียวกัน ทั้งติวหนังสือ กินข้าว ออกกำลังกาย หรือหาเพื่อนไปคาเฟ่ ด้วยบัญชีอีเมลมหาวิทยาลัยที่ยืนยันแล้วเท่านั้น
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <PlayButton />
                <a href="#features" className="inline-flex h-14 items-center gap-2 rounded-full px-5 text-base font-semibold text-foreground transition hover:bg-muted">
                  ดูว่าทำอะไรได้บ้าง <ArrowRight className="size-4" />
                </a>
              </div>
              <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground lg:justify-start">
                <li className="flex items-center gap-1.5"><ShieldCheck className="size-4 text-[#18a878]" /> เฉพาะอีเมล @psu.ac.th</li>
                <li className="flex items-center gap-1.5"><LockKeyhole className="size-4 text-[#18a878]" /> แชตเข้ารหัส</li>
                <li className="flex items-center gap-1.5"><EyeOff className="size-4 text-[#18a878]" /> ไม่แชร์พิกัดจริง</li>
              </ul>
            </div>
            <PhoneMock />
          </div>
        </section>

        <section id="features" className="scroll-mt-20 border-t border-border/60 bg-card/50 py-20">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHeading eyebrow="ฟีเจอร์" title="ทุกอย่างที่ต้องใช้ในการหาเพื่อนในมหาวิทยาลัย" body="ออกแบบมาเพื่อชีวิตในแคมปัส ตั้งแต่เจอกันครั้งแรกจนถึงนัดเจอจริง" />
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <article key={title} className="rounded-3xl border border-border bg-card p-6 transition hover:-translate-y-1 hover:shadow-lg">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="size-6" />
                  </span>
                  <h3 className="mt-5 text-lg font-bold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="safety" className="scroll-mt-20 py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-primary">ความปลอดภัย</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">ปลอดภัยตั้งแต่การออกแบบ</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                เราเก็บข้อมูลเท่าที่จำเป็น ปฏิบัติตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 และให้คุณควบคุมว่าใครเห็นอะไรได้ทุกเมื่อ
              </p>
              <a href="/privacy" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
                อ่านนโยบายความเป็นส่วนตัว <ArrowRight className="size-4" />
              </a>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {SAFETY.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-3xl border border-border bg-card p-5">
                  <Icon className="size-6 text-[#18a878]" />
                  <h3 className="mt-3 font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-20 border-y border-border/60 bg-card/50 py-20">
          <div className="mx-auto max-w-5xl px-5">
            <SectionHeading eyebrow="เริ่มใช้งาน" title="เริ่มได้ใน 3 ขั้นตอน" />
            <ol className="mt-12 grid gap-5 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative rounded-3xl border border-border bg-card p-6">
                  <span className="flex size-10 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">{index + 1}</span>
                  <h3 className="mt-4 text-lg font-bold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 py-20">
          <div className="mx-auto max-w-3xl px-5">
            <SectionHeading eyebrow="คำถามที่พบบ่อย" title="มีคำถาม? เรามีคำตอบ" />
            <div className="mt-10 grid gap-3">
              {FAQ.map((item) => <FaqItem key={item.q} {...item} />)}
            </div>
          </div>
        </section>

        <section className="px-5 pb-20">
          <div className="relative mx-auto flex max-w-5xl flex-col items-center overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#1f4fa0] via-primary to-[#5aaeff] px-6 py-14 text-center text-white sm:px-12">
            <Mascot size={92} className="drop-shadow-xl" />
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">เพื่อนใหม่รออยู่ในแคมปัส</h2>
            <p className="mt-3 max-w-lg text-base text-white/85">ดาวน์โหลด CampusMate แล้วสมัครด้วยอีเมล ม.อ. ของคุณ</p>
            <PlayButton className="mt-7 bg-white text-[#10203a]" />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-card/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <BrandMark size={30} />
          <div>
            <p className="font-bold">CampusMate</p>
            <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} CampusMate</p>
          </div>
        </div>
        <nav aria-label="ลิงก์ท้ายเว็บ" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <a href="/privacy" className="hover:text-foreground">นโยบายความเป็นส่วนตัว</a>
          <a href="/terms" className="hover:text-foreground">เงื่อนไขการให้บริการ</a>
          <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Google Play</a>
        </nav>
      </div>
    </footer>
  );
}
