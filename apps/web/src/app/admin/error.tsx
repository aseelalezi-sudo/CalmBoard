"use client";

import Link from "next/link";
import { IconShield } from "@/components/icons";
import { Btn, ScreenState } from "@/components/ui";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main dir="rtl" className="grid min-h-screen place-items-center app-bg p-4">
      <ScreenState
        tone="error"
        icon={<IconShield size={20} />}
        title="تعذر تحميل لوحة الإدارة"
        description="تحقق من اتصال خدمة الإدارة وصلاحية الجلسة، ثم حاول مجدداً. لم تُعرض أي بيانات قديمة أو تجريبية."
        className="w-full max-w-lg"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Btn onClick={reset}>إعادة المحاولة</Btn>
            <Link
              href="/"
              className="inline-flex min-h-9 items-center rounded-xl border border-line px-4 text-[13px] font-medium text-ink-soft hover:bg-raised focus-ring"
            >
              العودة إلى المنصة
            </Link>
          </div>
        }
      />
    </main>
  );
}
