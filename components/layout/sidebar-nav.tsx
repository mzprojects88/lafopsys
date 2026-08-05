"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useVisibleNavItems } from "@/lib/rbac/use-role";
import { RoleSwitcher } from "@/components/layout/role-switcher";

export function AppSidebar() {
  const pathname = usePathname();
  const items = useVisibleNavItems();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-4">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-1">
          <Image
            src="/logo/laf-mark.png"
            alt="Little Ark Foundation"
            width={32}
            height={32}
            className="shrink-0"
          />
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-bold text-foreground">LAF Operating System</span>
            <span className="text-[11px] text-muted-foreground">Little Ark Foundation</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu className="px-2">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="gap-2 px-2 pb-3">
        <RoleSwitcher />
      </SidebarFooter>
    </Sidebar>
  );
}
