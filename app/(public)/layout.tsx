import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "LAF Activity Center Booking · Little Ark Foundation",
  description: "Book a time to run an activity for the children at the LAF Activity Center at National Children's Hospital.",
};

/**
 * The frame of the public booking pages (0172), in the foundation's own look rather than ArkOS's: sky background,
 * navy headings, Arial. The colours are written out and the page is always light, whatever theme a visitor's
 * device asks for, so the brand reads the same for everyone.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ colorScheme: "light", fontFamily: "Arial, Helvetica, sans-serif" }} className="flex min-h-screen flex-col bg-[#edf8ff] text-[#436077]">
      <header className="border-b border-[#c7dce9] bg-white">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4">
          <a href="https://littlearkfoundation.org" className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0068c9]">
            {/* 5023 x 926: the width and height keep the file's own proportions. */}
            <Image src="/logo/laf-horizontal.png" alt="Little Ark Foundation" width={217} height={40} priority className="h-auto w-[190px] sm:w-[217px]" />
          </a>
          <nav aria-label="Booking" className="flex items-center gap-5 text-[13px] font-bold tracking-wide text-[#0068c9] uppercase">
            <Link href="/book" className="rounded py-2 hover:text-[#082f59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0068c9]">
              Book a visit
            </Link>
            <Link href="/book/track" className="rounded py-2 hover:text-[#082f59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0068c9]">
              My booking
            </Link>
            <Link href="/book/my" className="rounded py-2 hover:text-[#082f59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0068c9]">
              Volunteers Portal
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-12">{children}</main>
      <footer className="bg-[#082f59] px-4 py-8 text-center text-white">
        <p className="text-lg font-black">Our Children. Our Future.</p>
        <p className="mt-1 text-sm text-[#c8f4ff]">
          <a href="https://littlearkfoundation.org" className="underline-offset-4 hover:underline">
            littlearkfoundation.org
          </a>
        </p>
      </footer>
    </div>
  );
}
