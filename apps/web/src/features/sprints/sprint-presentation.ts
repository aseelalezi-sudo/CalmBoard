export function sprintNumberLocale(locale: string) {
  return locale === "ar" ? "ar-SA" : "en-US";
}

export function formatSprintMetric(value: number, locale: string, signed = false) {
  return new Intl.NumberFormat(sprintNumberLocale(locale), {
    signDisplay: signed ? "exceptZero" : "auto",
    maximumFractionDigits: 2,
  }).format(value);
}
