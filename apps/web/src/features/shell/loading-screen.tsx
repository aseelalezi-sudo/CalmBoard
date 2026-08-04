import { LogoMark } from "@/components/icons";

export function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="app-bg grid min-h-screen place-items-center">
      <div className="text-center">
        <div className="relative mx-auto grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 animate-spin-slow rounded-2xl border-2 border-transparent border-t-cyan-400" />
          <LogoMark size={34} />
        </div>
        <p className="mt-5 text-[13px] text-zinc-500">{message}</p>
      </div>
    </div>
  );
}
