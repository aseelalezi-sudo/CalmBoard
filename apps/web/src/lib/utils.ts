export function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
export function uid() {
  return Math.random().toString(36).slice(2, 9);
}
export function formatDate(d: Date | string | null | undefined, locale: string = "ar") {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
export function formatRelative(d: Date | string, locale: string = "ar") {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return locale === "ar" ? "الآن" : "now";
  if (mins < 60) return locale === "ar" ? `منذ ${mins} د` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return locale === "ar" ? `منذ ${hours} س` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return locale === "ar" ? `منذ ${days} يوم` : `${days}d ago`;
}
