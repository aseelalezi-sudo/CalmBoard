import { IconShield } from "@/components/icons";
import { ScreenState } from "@/components/ui";

export default function AdminLoading() {
  return (
    <main dir="rtl" className="grid min-h-screen place-items-center app-bg p-4">
      <ScreenState
        tone="loading"
        icon={<IconShield size={20} />}
        title="جارٍ تحميل بيانات الإدارة…"
        description="يتم الآن جلب المؤشرات التشغيلية الموثوقة."
        className="w-full max-w-lg"
      />
    </main>
  );
}
