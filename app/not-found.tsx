import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Any unknown address, and every page of a module hidden on this deployment
 * (middleware rewrites those to a route that does not exist). */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={56} height={60} priority className="h-14 w-auto" />
      <div className="flex flex-col gap-2">
        <p className="text-title-sm font-bold text-foreground">404</p>
        <h1 className="text-xl font-semibold text-foreground">This page isn&apos;t here</h1>
        <p className="max-w-[40ch] text-theme-sm text-muted-foreground">The address may be mistyped, or the page isn&apos;t open on this system.</p>
      </div>
      <Button asChild size="lg">
        <Link href="/dashboard">Back to the dashboard</Link>
      </Button>
    </main>
  );
}
